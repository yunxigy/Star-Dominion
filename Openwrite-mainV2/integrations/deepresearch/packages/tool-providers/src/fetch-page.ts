import type { FetchProvider } from "@deepresearch/contracts";
import { abortError, createProxyFetch, envProxy, fetchWithDispatcher, formatFetchError, macosSystemProxy, sleep, throwIfAborted } from "@deepresearch/net-utils";
import { execFile } from "node:child_process";
import { lookup } from "node:dns/promises";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface FetchHostAddress {
  address: string;
  family: number;
}

export interface PdfOcrContext {
  url: string;
  maxPages: number;
  languages: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export type PdfOcrImplementation = (bytes: Uint8Array, context: PdfOcrContext) => Promise<string>;

/** direct: origin only; jina: reader only; fallback: origin first, reader on failure. */
export type FetchPageMode = "direct" | "jina" | "fallback";

export interface FetchPageProviderOptions {
  timeoutMs?: number;
  maxChars?: number;
  /** Trusted transport override; the caller is responsible for connection-level DNS safety. */
  fetchImpl?: typeof fetch;
  /** Jina Reader API key. Only ever sent to the reader endpoint, never to origin sites. */
  apiKey?: string;
  proxy?: string;
  retry?: number;
  /** @deprecated Prefer `mode`. `true` maps to "jina". */
  useJinaReader?: boolean;
  mode?: FetchPageMode;
  readerEndpoint?: string;
  maxPdfBytes?: number;
  /** Maximum decoded bytes buffered for HTML, plain text, or reader output. */
  maxTextBytes?: number;
  /** Opt-in OCR fallback for PDFs with no useful embedded text layer. */
  ocrScannedPdfs?: boolean;
  ocrLanguages?: string;
  maxOcrPages?: number;
  ocrTimeoutMs?: number;
  pdftoppmPath?: string;
  tesseractPath?: string;
  pdfOcrImpl?: PdfOcrImplementation;
  maxRedirects?: number;
  /** Explicit escape hatch for trusted intranet-only deployments. */
  allowPrivateNetwork?: boolean;
  resolveHost?: (hostname: string) => Promise<FetchHostAddress[]>;
}

export class FetchPageProvider implements FetchProvider {
  readonly name: string;
  private readonly timeoutMs: number;
  private readonly maxChars: number;
  private readonly fetchImpl?: typeof fetch;
  private readonly apiKey?: string;
  private readonly proxy?: string;
  private readonly retry: number;
  private readonly mode: FetchPageMode;
  private readonly readerEndpoint: string;
  private readonly maxPdfBytes: number;
  private readonly maxTextBytes: number;
  private readonly pdfOcr?: PdfOcrImplementation;
  private readonly ocrLanguages: string;
  private readonly maxOcrPages: number;
  private readonly ocrTimeoutMs: number;
  private readonly maxRedirects: number;
  private readonly allowPrivateNetwork: boolean;
  private readonly resolveHost: (hostname: string) => Promise<FetchHostAddress[]>;

  constructor(opts: FetchPageProviderOptions = {}) {
    this.mode = opts.mode ?? (opts.useJinaReader ? "jina" : "direct");
    this.name = this.mode === "jina" ? "jina-reader-fetch" : this.mode === "fallback" ? "fetch-page+jina-fallback" : "fetch-page";
    this.timeoutMs = opts.timeoutMs ?? 15000;
    this.maxChars = opts.maxChars ?? 120000;
    this.fetchImpl = opts.fetchImpl;
    this.apiKey = opts.apiKey;
    this.proxy = opts.proxy ?? envProxy();
    this.retry = opts.retry ?? 1;
    this.readerEndpoint = opts.readerEndpoint ?? "https://r.jina.ai";
    this.maxPdfBytes = boundedPositiveInteger(opts.maxPdfBytes, "maxPdfBytes", 50_000_000, 200_000_000);
    this.maxTextBytes = boundedPositiveInteger(opts.maxTextBytes, "maxTextBytes", 10_000_000, 50_000_000);
    this.ocrLanguages = validateOcrLanguages(opts.ocrLanguages ?? "eng");
    this.maxOcrPages = boundedPositiveInteger(opts.maxOcrPages, "maxOcrPages", 12, 50);
    this.ocrTimeoutMs = boundedPositiveInteger(opts.ocrTimeoutMs, "ocrTimeoutMs", 120_000, 600_000);
    this.pdfOcr = opts.pdfOcrImpl ?? (opts.ocrScannedPdfs
      ? createCommandPdfOcr(opts.pdftoppmPath ?? "pdftoppm", opts.tesseractPath ?? "tesseract")
      : undefined);
    this.maxRedirects = boundedNonnegativeInteger(opts.maxRedirects, "maxRedirects", 5, 10);
    this.allowPrivateNetwork = opts.allowPrivateNetwork ?? false;
    this.resolveHost = opts.resolveHost ?? resolveHostAddresses;
  }

  async fetchPage(url: string, opts: { timeoutMs?: number; maxChars?: number; focusTerms?: string[]; signal?: AbortSignal } = {}): Promise<{ url: string; title: string; content: string; description?: string }> {
    if (this.mode === "jina") return this.fetchVia(url, opts, "jina");
    if (this.mode === "direct") return this.fetchVia(url, opts, "direct");
    // fallback: origin first, Jina Reader when the origin fetch fails.
    let directError: unknown;
    try {
      return await this.fetchVia(url, opts, "direct");
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      directError = err;
    }
    try {
      return await this.fetchVia(url, opts, "jina");
    } catch (readerError) {
      if (opts.signal?.aborted) throw abortError(opts.signal, "fetch_page aborted");
      const directMessage = directError instanceof Error ? directError.message : String(directError);
      const readerMessage = readerError instanceof Error ? readerError.message : String(readerError);
      throw new Error(`${directMessage}; jina reader fallback also failed: ${readerMessage}`);
    }
  }

  private async fetchVia(url: string, opts: { timeoutMs?: number; maxChars?: number; focusTerms?: string[]; signal?: AbortSignal }, via: "direct" | "jina"): Promise<{ url: string; title: string; content: string; description?: string }> {
    const viaJina = via === "jina";
    throwIfAborted(opts.signal, "fetch_page aborted");
    await this.assertSafeUrl(url, { skipResolve: viaJina });
    const fetchUrl = viaJina ? readerUrl(this.readerEndpoint, url) : url;
    await this.assertSafeUrl(fetchUrl);
    const fetchFn = await this.getFetch();
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.retry + 1; attempt++) {
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      if (opts.signal?.aborted) controller.abort();
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? this.timeoutMs);
      try {
        const response = await this.fetchWithSafeRedirects(fetchFn, fetchUrl, controller.signal, viaJina).catch((err: unknown) => {
          throw new Error(`fetch_page request failed for ${fetchUrl} after ${opts.timeoutMs ?? this.timeoutMs}ms (attempt ${attempt}/${this.retry + 1}): ${formatFetchError(err)}`);
        });
        if (!response.ok) {
          const body = await readBoundedResponseText(response, 4_096).catch(() => "");
          throw new Error(`fetch_page HTTP ${response.status} (attempt ${attempt}/${this.retry + 1}): ${body.slice(0, 200)}`);
        }
        const responseUrl = response.url || (viaJina ? url : fetchUrl);
        const maxChars = opts.maxChars ?? this.maxChars;
        let parsed: ParsedPage;
        if (viaJina) {
          parsed = parseReaderText(await readBoundedResponseText(response, this.maxTextBytes), url, responseUrl);
        } else if (isPdfResponse(response, url)) {
          const contentLength = Number(response.headers.get("content-length") ?? 0);
          if (contentLength > this.maxPdfBytes) {
            throw new Error(`fetch_page PDF exceeds ${this.maxPdfBytes} byte limit: ${contentLength}`);
          }
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.byteLength > this.maxPdfBytes) {
            throw new Error(`fetch_page PDF exceeds ${this.maxPdfBytes} byte limit: ${bytes.byteLength}`);
          }
          parsed = await parsePdfText(bytes, responseUrl, maxChars, opts.focusTerms, this.pdfOcr ? {
            implementation: this.pdfOcr,
            maxPages: this.maxOcrPages,
            languages: this.ocrLanguages,
            timeoutMs: this.ocrTimeoutMs,
            signal: controller.signal,
          } : undefined);
        } else {
          parsed = parseHtmlText(await readBoundedResponseText(response, this.maxTextBytes), responseUrl);
        }
        return {
          url: parsed.url,
          title: parsed.title,
          content: fitContentWithDocumentLinks(prioritizeFocusedContent(parsed.content, opts.focusTerms, maxChars), parsed.documentLinks, maxChars),
          description: parsed.description,
        };
      } catch (err) {
        if (opts.signal?.aborted) throw abortError(opts.signal, "fetch_page aborted");
        lastError = err;
        if (attempt > this.retry || isPermanentFetchError(err)) break;
        await sleep(500 * attempt);
      } finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async fetchWithSafeRedirects(fetchFn: typeof fetch, initialUrl: string, signal: AbortSignal, viaJina: boolean): Promise<Response> {
    let currentUrl = initialUrl;
    for (let redirects = 0; ; redirects += 1) {
      await this.assertSafeUrl(currentUrl);
      const response = await fetchFn(currentUrl, {
        headers: this.headers(viaJina),
        redirect: "manual",
        signal,
      });
      if (!isRedirectStatus(response.status)) {
        if (response.url) await this.assertSafeUrl(response.url);
        return response;
      }
      const location = response.headers.get("location");
      if (!location) return response;
      if (redirects >= this.maxRedirects) {
        throw new Error(`fetch_page exceeded ${this.maxRedirects} redirects`);
      }
      currentUrl = new URL(location, currentUrl).toString();
      await this.assertSafeUrl(currentUrl);
    }
  }

  private async assertSafeUrl(value: string, opts: { skipResolve?: boolean } = {}): Promise<void> {
    const parsed = validateFetchUrl(value);
    if (this.allowPrivateNetwork) return;
    const hostname = normalizeHostname(parsed.hostname);
    if (isLocalHostname(hostname) || isNonPublicIp(hostname)) {
      throw new Error(`fetch_page blocked non-public network target: ${hostname}`);
    }
    // Reader-mode origin URLs are fetched by the reader service, not by us:
    // a locally unresolvable host can still be perfectly readable for it.
    if (isIP(hostname) || opts.skipResolve) return;
    await this.resolvePublicHost(hostname);
  }

  private async resolvePublicHost(hostname: string): Promise<FetchHostAddress[]> {
    let addresses: FetchHostAddress[];
    try {
      addresses = await this.resolveHost(hostname);
    } catch (err) {
      throw new Error(`fetch_page could not safely resolve ${hostname}: ${formatFetchError(err)}`);
    }
    if (!addresses.length) throw new Error(`fetch_page could not safely resolve ${hostname}: no addresses`);
    const unsafe = addresses.find((item) => !isIP(item.address) || isNonPublicIp(item.address));
    if (unsafe) throw new Error(`fetch_page blocked ${hostname} because it resolves to non-public address ${unsafe.address}`);
    return addresses;
  }

  private headers(viaJina: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: viaJina ? "text/plain, text/markdown;q=0.9, */*;q=0.1" : "text/html, application/pdf;q=0.95, text/plain;q=0.9, */*;q=0.1",
    };
    // The reader API key is a credential for the reader endpoint only; sending
    // it to arbitrary origin sites would leak it to every fetched page.
    if (viaJina && this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    return headers;
  }

  private async getFetch(): Promise<typeof fetch> {
    if (this.fetchImpl) return this.fetchImpl;
    const proxy = this.proxy ?? macosSystemProxy();
    const undici = await import("undici");
    if (proxy) return createProxyFetch(proxy);
    if (this.allowPrivateNetwork) return undici.fetch as unknown as typeof fetch;
    const dispatcher = new undici.Agent().compose(undici.interceptors.dns({
      maxTTL: 10_000,
      lookup: (origin, _options, callback) => {
        const hostname = normalizeHostname(origin.hostname);
        void this.resolvePublicHost(hostname).then((addresses) => {
          callback(null, addresses.map((item) => ({
            address: item.address,
            family: isIP(item.address) as 4 | 6,
            ttl: 10_000,
          })));
        }).catch((error: unknown) => {
          callback(error instanceof Error ? error : new Error(String(error)), []);
        });
      },
    }));
    return fetchWithDispatcher(dispatcher);
  }
}

/**
 * Permanent failures (4xx other than 408/429, TLS certificate mismatches, DNS
 * NXDOMAIN, SSRF/URL-policy rejections) cannot be fixed by retrying within the
 * same run; only transient conditions (timeouts, 5xx, connection resets) are
 * worth another attempt.
 */
function isPermanentFetchError(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  const http = /\bHTTP (\d{3})\b/.exec(text)?.[1];
  if (http) {
    const code = Number(http);
    return code >= 400 && code < 500 && code !== 408 && code !== 429;
  }
  return /certificate|altnames|ENOTFOUND|EAI_AGAIN|could not safely resolve|non-public network target|does not allow credentials/i.test(text);
}

async function readBoundedResponseText(response: Response, maxBytes: number): Promise<string> {
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`fetch_page text response exceeds ${maxBytes} byte limit: ${contentLength}`);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`fetch_page text response exceeds ${maxBytes} byte limit while reading`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

interface ParsedPage {
  url: string;
  title: string;
  content: string;
  description?: string;
  documentLinks?: DocumentLink[];
}

interface DocumentLink {
  url: string;
  label: string;
}

export function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;|&#160;|&#x0*a0;/gi, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/\s+/g, " ")
    .trim();
}

function parseHtmlText(raw: string, url: string): ParsedPage {
  return {
    url,
    title: extractTitle(raw) ?? url,
    content: stripHtml(raw),
    description: extractMetaDescription(raw),
    documentLinks: extractHtmlDocumentLinks(raw, url),
  };
}

function parseReaderText(raw: string, originalUrl: string, responseUrl: string): ParsedPage {
  const content = raw.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return {
    url: extractReaderField(content, "URL Source") ?? extractReaderField(content, "Source URL") ?? originalUrl,
    title: extractReaderField(content, "Title") ?? extractMarkdownHeading(content) ?? responseUrl,
    content,
    description: extractReaderField(content, "Description"),
    documentLinks: extractMarkdownDocumentLinks(content, originalUrl),
  };
}

interface PdfOcrOptions {
  implementation: PdfOcrImplementation;
  maxPages: number;
  languages: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

async function parsePdfText(bytes: Uint8Array, url: string, maxChars: number, focusTerms?: string[], ocr?: PdfOcrOptions): Promise<ParsedPage> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // PDF.js may transfer and detach its input buffer. Preserve a bounded copy
  // before parsing when the same document may need an OCR fallback.
  const ocrBytes = ocr ? bytes.slice() : undefined;
  const loadingTask = pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    useSystemFonts: true,
    // Keep malformed-font/PDF parser warnings out of the CLI stream. Fetch
    // failures still propagate through the normal provider error path.
    verbosity: 0,
  });
  const pdf = await loadingTask.promise;
  try {
    const metadata = await pdf.getMetadata().catch(() => undefined);
    const info = object(metadata?.info);
    const title = stringValue(info.Title) ?? filenameFromUrl(url) ?? url;
    const description = stringValue(info.Subject);
    const pages: string[] = [];
    let contentChars = 0;
    const extractionCharLimit = focusTerms?.length
      ? 1_000_000
      : Math.min(1_000_000, Math.max(maxChars, maxChars * 4));
    for (let pageNumber = 1; pageNumber <= pdf.numPages && contentChars < extractionCharLimit; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const text = await page.getTextContent();
      const pageText = text.items
        .map((item) => ("str" in item && typeof item.str === "string" ? item.str : ""))
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (!pageText) continue;
      const marked = `--- PDF page ${pageNumber} ---\n${pageText}`;
      pages.push(marked);
      contentChars += marked.length + 2;
    }
    let fullText = pages.join("\n\n");
    if (ocr && pdfNeedsOcr(fullText, pdf.numPages)) {
      throwIfAborted(ocr.signal, "fetch_page aborted");
      const ocrText = (await ocr.implementation(ocrBytes!, {
        url,
        maxPages: Math.min(pdf.numPages, ocr.maxPages),
        languages: ocr.languages,
        timeoutMs: ocr.timeoutMs,
        signal: ocr.signal,
      })).replace(/\r\n/g, "\n").trim();
      if (ocrText) fullText = `--- OCR text from scanned PDF ---\n${ocrText}`;
    }
    const highlights = selectPdfHighlights(fullText);
    return {
      url,
      title,
      description,
      content: highlights ? `${highlights}\n\n${fullText}` : fullText,
    };
  } finally {
    await pdf.destroy();
  }
}

function pdfNeedsOcr(content: string, pageCount: number): boolean {
  const substantive = content
    .replace(/^--- PDF page \d+ ---$/gmu, "")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
  return substantive.length < Math.min(800, Math.max(80, pageCount * 30));
}

function validateOcrLanguages(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_+-]{1,80}$/u.test(normalized)) {
    throw new Error("ocrLanguages must contain only language identifiers joined by +");
  }
  return normalized;
}

function boundedPositiveInteger(value: number | undefined, name: string, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

function boundedNonnegativeInteger(value: number | undefined, name: string, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${name} must be an integer between 0 and ${maximum}`);
  }
  return value;
}

function createCommandPdfOcr(pdftoppmPath: string, tesseractPath: string): PdfOcrImplementation {
  return async (bytes, context) => {
    const dir = await mkdtemp(join(tmpdir(), "deepresearch-pdf-ocr-"));
    const inputPath = join(dir, "input.pdf");
    const outputPrefix = join(dir, "page");
    const deadline = Date.now() + context.timeoutMs;
    try {
      await writeFile(inputPath, bytes);
      await runOcrCommand(pdftoppmPath, [
        "-f", "1",
        "-l", String(context.maxPages),
        "-r", "150",
        "-png",
        inputPath,
        outputPrefix,
      ], deadline, context.signal, 1_000_000);
      const images = (await readdir(dir))
        .filter((name) => /^page-\d+\.png$/u.test(name))
        .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
      const pages: string[] = [];
      for (let index = 0; index < images.length; index += 1) {
        throwIfAborted(context.signal, "fetch_page aborted");
        const text = (await runOcrCommand(tesseractPath, [
          join(dir, images[index]!),
          "stdout",
          "-l", context.languages,
          "--psm", "3",
        ], deadline, context.signal, 10_000_000)).trim();
        if (text) pages.push(`--- OCR page ${index + 1} ---\n${text}`);
      }
      return pages.join("\n\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

function runOcrCommand(
  executable: string,
  args: string[],
  deadline: number,
  signal: AbortSignal | undefined,
  maxBuffer: number,
): Promise<string> {
  const timeout = Math.max(1, deadline - Date.now());
  if (timeout <= 1) return Promise.reject(new Error("PDF OCR exceeded its total timeout"));
  return new Promise((resolve, reject) => {
    execFile(executable, args, { encoding: "utf8", timeout, maxBuffer, signal }, (error, stdout) => {
      if (error) {
        reject(new Error(`PDF OCR command failed (${executable}): ${formatFetchError(error)}`));
        return;
      }
      resolve(stdout);
    });
  });
}

export function selectPdfHighlights(content: string): string | undefined {
  if (content.length <= 12_000) return undefined;
  const patterns = [
    /executive\s+summary/gi,
    /key\s+findings?/gi,
    /market\s+shares?/gi,
    /switching\s+barriers?/gi,
    /data\s+egress\s+fees?/gi,
    /network\s+effects?/gi,
    /economies\s+of\s+scale/gi,
    /(?:software\s+)?licen[cs]ing/gi,
    /interoperability/gi,
    /fastest[- ]growing\s+(?:core\s+)?skills?/gi,
    /(?:top\s+10|ten)\s+(?:fastest[- ]growing|growing)\s+skills?/gi,
    /growing\s+skills?/gi,
    /(?:conclusions?|recommendations?)\b/gi,
  ];
  const windows: Array<{ start: number; end: number }> = [];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const index = match.index ?? 0;
      const start = Math.max(0, index - 500);
      const end = Math.min(content.length, index + 2_000);
      if (windows.some((window) => start <= window.end && end >= window.start)) continue;
      windows.push({ start, end });
      if (windows.length >= 3) break;
    }
    if (windows.length >= 3) break;
  }
  if (!windows.length) return undefined;
  const passages = windows
    .sort((a, b) => a.start - b.start)
    .map((window, index) => `Passage ${index + 1}:\n${content.slice(window.start, window.end).trim()}`)
    .join("\n\n");
  return `--- PDF automatically selected passages ---\n${passages}`.slice(0, 8_000);
}

function isPdfResponse(response: Response, requestedUrl: string): boolean {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  return contentType.includes("application/pdf")
    || looksLikePdfUrl(response.url)
    || looksLikePdfUrl(requestedUrl);
}

function extractHtmlDocumentLinks(html: string, baseUrl: string): DocumentLink[] {
  const links: DocumentLink[] = [];
  const anchorPattern = /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const href = decodeHtmlAttribute(match[2] ?? "");
    const label = stripHtml(match[3] ?? "") || "Document";
    pushDocumentLink(links, href, label, baseUrl);
  }
  return links.slice(0, 12);
}

function extractMarkdownDocumentLinks(markdown: string, baseUrl: string): DocumentLink[] {
  const links: DocumentLink[] = [];
  const markdownLink = /\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]+)\)/gi;
  for (const match of markdown.matchAll(markdownLink)) {
    pushDocumentLink(links, match[2] ?? "", match[1] ?? "Document", baseUrl);
  }
  const barePdf = /https?:\/\/[^\s<>"']+?\.pdf(?:\?[^\s<>"']*)?/gi;
  for (const match of markdown.matchAll(barePdf)) {
    pushDocumentLink(links, match[0], filenameFromUrl(match[0]) ?? "PDF document", baseUrl);
  }
  return links.slice(0, 12);
}

function pushDocumentLink(links: DocumentLink[], href: string, label: string, baseUrl: string): void {
  let resolved: URL;
  try {
    resolved = new URL(href, baseUrl);
  } catch {
    return;
  }
  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return;
  if (!looksLikeDocumentLink(resolved, label)) return;
  resolved.hash = "";
  const url = resolved.toString();
  if (links.some((item) => item.url === url)) return;
  links.push({ url, label: label.replace(/\s+/g, " ").trim().slice(0, 160) || "Document" });
}

function looksLikeDocumentLink(url: URL, label: string): boolean {
  const target = `${url.pathname}${url.search}`;
  if (/\.pdf(?:$|[?#&])/i.test(target) || /(?:^|[?&])(?:format|type|file)=[^&]*pdf/i.test(url.search)) return true;
  const documentLabel = /\bpdf\b|download\s+(?:the\s+)?(?:full\s+)?(?:report|paper|publication)|full\s+(?:report|paper)|下载|报告全文/i.test(label);
  return documentLabel && /download|document|attachment|publication|report|resource|media/i.test(target);
}

export function prioritizeFocusedContent(content: string, focusTerms: string[] | undefined, maxChars: number): string {
  if (content.length <= maxChars || !focusTerms?.length) return content;
  const terms = focusedSearchTerms(focusTerms);
  if (!terms.length) return content;
  const segmentSize = 4_000;
  const segments: Array<{ start: number; end: number; score: number }> = [];
  const lower = content.toLowerCase();
  const starts = new Set<number>();
  for (const term of terms) {
    let offset = 0;
    // Later operative clauses and annexes may be preceded by dozens of
    // cross-references or table-of-contents hits in a long legal instrument.
    for (let matches = 0; matches < 200; matches += 1) {
      const index = lower.indexOf(term, offset);
      if (index < 0) break;
      starts.add(Math.max(0, index - 800));
      offset = index + term.length;
    }
    let reverseOffset = lower.length;
    for (let matches = 0; matches < 20; matches += 1) {
      const index = lower.lastIndexOf(term, reverseOffset);
      if (index < 0) break;
      starts.add(Math.max(0, index - 800));
      reverseOffset = index - 1;
    }
  }
  for (const start of starts) {
    const end = Math.min(content.length, start + segmentSize);
    const text = lower.slice(start, end);
    let score = 0;
    for (const term of terms) {
      if (!text.includes(term)) continue;
      score += /^\d+$/u.test(term) || /^article\s+\d+/u.test(term)
        ? 7
        : term.length >= 10 ? 5 : term.length >= 5 ? 3 : 1;
    }
    // Long statutes and standards often mention every article once in an
    // early table of contents. Prefer operative passages that also contain
    // concrete thresholds, dates, or mandatory language over those shallow
    // index hits.
    const thresholdCount = (text.match(/\b\d+(?:\.\d+)?\s*(?:%|per\s+cent|percent)\b/gu) ?? []).length;
    const yearCount = (text.match(/\b(?:19|20)\d{2}\b/gu) ?? []).length;
    const obligationCount = (text.match(/\b(?:shall|must|no\s+later\s+than|by\s+31\s+december|at\s+least)\b/gu) ?? []).length;
    score += Math.min(thresholdCount, 10) * 4 + Math.min(yearCount, 8) + Math.min(obligationCount, 8);
    if (score > 0) segments.push({ start, end, score });
  }
  if (!segments.length) return content;
  const leadingChars = Math.min(1_200, Math.floor(maxChars / 5));
  const available = Math.max(0, maxChars - leadingChars - 200);
  const segmentLimit = Math.max(1, Math.floor(available / (segmentSize + 80)));
  const tailAnchorCandidates = terms
    .filter((term) => term.length >= 5 || /^article\s+\d+|^annex\s+/u.test(term))
    .flatMap((term) => {
      const index = lower.lastIndexOf(term);
      if (index < 0) return [];
      const start = Math.max(0, index - 800);
      return segments.filter((segment) => segment.start === start);
    });
  const tailAnchors = Array.from(new Map(tailAnchorCandidates.map((segment) => [segment.start, segment])).values())
    .sort((left, right) => right.score - left.score || right.start - left.start)
    .slice(0, Math.min(4, segmentLimit));
  const tailStarts = new Set(tailAnchors.map((segment) => segment.start));
  const selected = [
    ...tailAnchors,
    ...segments
      .filter((segment) => !tailStarts.has(segment.start))
      .sort((left, right) => right.score - left.score || left.start - right.start),
  ]
    .slice(0, segmentLimit)
    .sort((left, right) => left.start - right.start);
  const passages = selected.map((segment, index) => (
    `--- Focused source passage ${index + 1} (characters ${segment.start}-${segment.end}) ---\n${content.slice(segment.start, segment.end).trim()}`
  )).join("\n\n");
  const leading = content.slice(0, leadingChars).trim();
  return `${leading}\n\n${passages}`.slice(0, maxChars);
}

function focusedSearchTerms(values: string[]): string[] {
  const ignored = new Set(["about", "according", "complete", "compare", "evidence", "extract", "fetch", "find", "from", "official", "regulation", "report", "research", "source", "text", "the", "this", "using", "verify", "with"]);
  const out: string[] = [];
  for (const value of values) {
    const lower = value.toLowerCase();
    out.push(...(lower.match(/\barticle\s+\d+[a-z]?\b/giu) ?? []));
    out.push(...(lower.match(/\bannex\s+[ivxlcdm]+(?:\s+part\s+[a-z0-9]+)?\b/giu) ?? []));
    out.push(...(lower.match(/\b\d{2,4}\b/gu) ?? []));
    const words = (lower.match(/[a-z][a-z0-9/-]{2,}/gu) ?? []).filter((token) => !ignored.has(token));
    for (let size = Math.min(4, words.length); size >= 2; size -= 1) {
      for (let index = 0; index + size <= words.length && index < 12; index += 1) {
        out.push(words.slice(index, index + size).join(" "));
      }
    }
    for (const token of lower.match(/[\p{L}\p{N}]{3,}/gu) ?? []) {
      if (!ignored.has(token)) out.push(token);
    }
    for (const match of lower.matchAll(/[\p{Script=Han}]{2,}/gu)) {
      const chars = Array.from(match[0]);
      for (let index = 0; index < chars.length - 1; index += 1) out.push(`${chars[index]}${chars[index + 1]}`);
    }
  }
  return Array.from(new Set(out)).slice(0, 256);
}

function fitContentWithDocumentLinks(content: string, links: DocumentLink[] | undefined, maxChars: number): string {
  if (!links?.length) return content.slice(0, maxChars);
  const appendix = `\n\nDocument links discovered on this page:\n${links.map((link) => `- ${link.label}: ${link.url}`).join("\n")}`;
  if (appendix.length >= maxChars) return appendix.slice(0, maxChars);
  return `${content.slice(0, maxChars - appendix.length)}${appendix}`;
}

function decodeHtmlAttribute(value: string): string {
  return value.replace(/&amp;/gi, "&").replace(/&#39;/g, "'").replace(/&quot;/gi, "\"");
}

function looksLikePdfUrl(value: string): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return /\.pdf$/i.test(parsed.pathname) || /(?:^|[?&])(?:format|type|file)=[^&]*pdf/i.test(parsed.search);
  } catch {
    return false;
  }
}

function filenameFromUrl(value: string): string | undefined {
  try {
    const part = new URL(value).pathname.split("/").filter(Boolean).at(-1);
    return part ? decodeURIComponent(part) : undefined;
  } catch {
    return undefined;
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? stripHtml(match[1]) : undefined;
}

function extractMetaDescription(html: string): string | undefined {
  const match = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i);
  return match?.[1] ? stripHtml(match[1]) : undefined;
}

function extractReaderField(text: string, field: string): string | undefined {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`^${escaped}:\\s*(.+)$`, "mi"));
  return match?.[1]?.trim() || undefined;
}

function extractMarkdownHeading(text: string): string | undefined {
  const match = text.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || undefined;
}

function readerUrl(endpoint: string, target: string): string {
  return `${endpoint.replace(/\/$/, "")}/${target}`;
}

function validateFetchUrl(url: string): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`fetch_page only supports http(s) URLs: ${url}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error("fetch_page does not allow credentials in URLs");
  }
  return parsed;
}

async function resolveHostAddresses(hostname: string): Promise<FetchHostAddress[]> {
  return await lookup(hostname, { all: true, verbatim: true });
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || hostname.endsWith(".internal")
    || hostname.endsWith(".home.arpa");
}

function isNonPublicIp(value: string): boolean {
  const ip = normalizeHostname(value);
  const family = isIP(ip);
  if (family === 4) return isNonPublicIpv4(ip);
  if (family !== 6) return false;
  const normalized = ip.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (/^(?:fc|fd)/.test(normalized)) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  if (/^ff/.test(normalized)) return true;
  if (/^2001:db8(?::|$)/.test(normalized)) return true;
  const mapped = ipv4FromMappedIpv6(normalized);
  return mapped ? isNonPublicIpv4(mapped) : false;
}

function isNonPublicIpv4(value: string): boolean {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && parts[2] === 2)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && parts[2] === 100)
    || (a === 203 && b === 0 && parts[2] === 113)
    || a >= 224;
}

function ipv4FromMappedIpv6(value: string): string | undefined {
  if (!value.startsWith("::ffff:")) return undefined;
  const suffix = value.slice("::ffff:".length);
  if (isIP(suffix) === 4) return suffix;
  const groups = suffix.split(":");
  if (groups.length !== 2 || groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return undefined;
  const high = Number.parseInt(groups[0]!, 16);
  const low = Number.parseInt(groups[1]!, 16);
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}
