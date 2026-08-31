// DuckDuckGo search provider。
// 用 HTML 版（https://html.duckduckgo.com/html/）—— 无需 API key、无需 JS 渲染。
// 返回 topK 条 SearchHit；失败时 throw。
//
// 注意事项：
//   - 某些代理（特别是反爬严格的）会拦截裸 fetch；必须带完整浏览器 header
//     （Accept / Accept-Language / Sec-Fetch-* / Referer）才能拿到真结果，
//     否则会被替换成 nginx anti-bot 主页（HTTP 202 + DuckDuckGo 主页 HTML）
//   - DDG 偶尔会返回 CAPTCHA 页；解析出 0 条时调用方拿到空数组即可
//   - 高频请求会被限流（建议 ≥ 1s 间隔）
//
// 抓 HTML 不需要任何外部依赖（Node 18+ 内置 fetch + undici dispatcher for proxy）

import type { SearchProvider, SearchHit } from "./types.js";
import type { ProxyAgent } from "undici";

export interface DuckDuckGoSearchOptions {
  /** 请求超时（ms），默认 15000 */
  timeoutMs?: number;
  /** User-Agent，默认 chrome 桌面 */
  userAgent?: string;
  /** 走 HTTP/HTTPS 代理。例：{ url: "http://127.0.0.1:7892" } */
  proxy?: { url: string };
  /** region 偏好，如 "us-en" / "cn-zh" */
  kl?: string;
}

export class DuckDuckGoSearchProvider implements SearchProvider {
  readonly name = "duckduckgo-html";
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly proxyUrl: string | undefined;
  private readonly kl: string | undefined;

  constructor(opts: DuckDuckGoSearchOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? 15000;
    this.userAgent = opts.userAgent ??
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
    this.proxyUrl = opts.proxy?.url;
    this.kl = opts.kl;
  }

  /** 多个端点按顺序试；任一成功就返回；全失败 throw 最后一次错误 */
  private static readonly ENDPOINTS = [
    "https://html.duckduckgo.com/html/",
    "https://lite.duckduckgo.com/lite/",
    "https://duckduckgo.com/html/",
  ];

  async search(query: string, topK: number): Promise<SearchHit[]> {
    if (!query) throw new Error("query is required");
    if (topK <= 0) return [];

    const headers: Record<string, string> = {
      "User-Agent": this.userAgent,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      "Accept-Encoding": "identity",
      Referer: "https://duckduckgo.com/",
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-User": "?1",
      DNT: "1",
      "Upgrade-Insecure-Requests": "1",
    };

    let lastErr: unknown = null;
    for (const ep of DuckDuckGoSearchProvider.ENDPOINTS) {
      const url = new URL(ep);
      const body = new URLSearchParams();
      body.set("q", query);
      if (this.kl) body.set("kl", this.kl);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        // 只有 DuckDuckGo 显式配置代理时才动态加载 undici；静态 import undici 会关闭
        // Node 的 env proxy 支持，影响 Brave/Jina/OpenAI 等其他 provider。
        const undici = this.proxyUrl ? await import("undici") : undefined;
        const dispatcher = this.proxyUrl && undici ? new undici.ProxyAgent({ uri: this.proxyUrl }) : undefined;
        const fetchFn: typeof fetch = dispatcher ? (undici!.fetch as unknown as typeof fetch) : globalThis.fetch;
        const resp = await fetchFn(url.toString(), {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: body.toString(),
          signal: controller.signal,
          redirect: "follow",
          ...(dispatcher ? ({ dispatcher } as unknown as RequestInit) : {}),
        });
        if (!resp.ok) {
          lastErr = new Error(`DuckDuckGo ${ep} HTTP ${resp.status}`);
          continue;
        }
        const html = await resp.text();
        const hits = parseDuckDuckGoHtml(html, topK);
        if (hits.length > 0) return hits;
        lastErr = new Error(`DuckDuckGo ${ep} returned 0 results (likely CAPTCHA)`);
      } catch (e) {
        lastErr = e;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr ?? new Error("DuckDuckGo all endpoints failed");
  }
}

/**
 * 走代理或直连发 HTTP GET。返回 body 字符串。
 * 走代理：CONNECT 隧道 + https.request via proxy
 * 直连：globalThis.fetch
 */
function fetchWithOptionalProxy(
  urlStr: string,
  headers: Record<string, string>,
  timeoutMs: number,
  proxyUrl: string | undefined,
): Promise<string> {
  if (proxyUrl) {
    return fetchViaHttpProxy(urlStr, headers, timeoutMs, proxyUrl);
  }
  // 直连：Node 24 内置 fetch
  return globalThis.fetch(urlStr, { method: "GET", headers, redirect: "follow" }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  });
}

function fetchViaHttpProxy(
  urlStr: string,
  headers: Record<string, string>,
  timeoutMs: number,
  proxyUrl: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const target = new URL(urlStr);
    const proxy = new URL(proxyUrl);
    const mod = proxy.protocol === "https:" ? require("https") : require("http");
    // CONNECT 隧道
    const connectReq = mod.request({
      host: proxy.hostname,
      port: proxy.port,
      method: "CONNECT",
      path: `${target.hostname}:${target.port || 443}`,
      headers: { Host: `${target.hostname}:${target.port || 443}` },
    });
    let timer: NodeJS.Timeout | undefined = setTimeout(() => {
      connectReq.destroy(new Error(`connect timeout ${timeoutMs}ms`));
    }, timeoutMs);
    connectReq.on("connect", (res: import("http").IncomingMessage, socket: import("net").Socket) => {
      clearTimeout(timer);
      if (res.statusCode !== 200) {
        reject(new Error(`proxy CONNECT ${res.statusCode}`));
        return;
      }
      // 通过隧道发 https
      const tls = require("tls");
      const tlsSocket = tls.connect({
        host: target.hostname,
        port: target.port || 443,
        socket,
        servername: target.hostname,
      });
      timer = setTimeout(() => {
        tlsSocket.destroy(new Error(`tls timeout ${timeoutMs}ms`));
      }, timeoutMs);
      const req = tlsSocket.write(`GET ${target.pathname}${target.search} HTTP/1.1\r\n` +
        Object.entries({ Host: target.host, ...headers }).map(([k, v]) => `${k}: ${v}`).join("\r\n") +
        `\r\n\r\n`);
      void req;
      let buf = "";
      let headerEnd = -1;
      tlsSocket.on("data", (chunk: Buffer) => {
        buf += chunk.toString("utf8");
        if (headerEnd < 0) {
          const idx = buf.indexOf("\r\n\r\n");
          if (idx >= 0) {
            headerEnd = idx;
            const statusLine = buf.slice(0, buf.indexOf("\r\n"));
            const m = statusLine.match(/HTTP\/\d\.\d (\d+)/);
            if (!m || m[1] !== "200") {
              tlsSocket.destroy();
              clearTimeout(timer);
              reject(new Error(`HTTP ${m?.[1] ?? "?"} via proxy`));
              return;
            }
          }
        }
        if (headerEnd >= 0) {
          // 解析 chunked / content-length
          const headersBlock = buf.slice(0, headerEnd);
          const body = buf.slice(headerEnd + 4);
          if (/Transfer-Encoding:\s*chunked/i.test(headersBlock)) {
            const decoded = decodeChunked(body);
            tlsSocket.destroy();
            clearTimeout(timer);
            resolve(decoded);
          } else if (/Content-Length:\s*(\d+)/i.test(headersBlock)) {
            const m = headersBlock.match(/Content-Length:\s*(\d+)/i);
            const expected = Number(m?.[1] ?? 0);
            if (body.length >= expected) {
              tlsSocket.destroy();
              clearTimeout(timer);
              resolve(body.slice(0, expected));
            }
          } else {
            // 没长度标记 → 等到 socket 关闭
          }
        }
      });
      tlsSocket.on("end", () => {
        if (headerEnd < 0) {
          clearTimeout(timer);
          reject(new Error("socket ended before headers"));
        } else {
          const headersBlock = buf.slice(0, headerEnd);
          if (!/Transfer-Encoding:\s*chunked/i.test(headersBlock) && !/Content-Length:/i.test(headersBlock)) {
            clearTimeout(timer);
            resolve(buf.slice(headerEnd + 4));
          }
        }
      });
      tlsSocket.on("error", (e: Error) => {
        clearTimeout(timer);
        reject(e);
      });
    });
    connectReq.on("error", (e: Error) => {
      clearTimeout(timer);
      reject(e);
    });
    connectReq.end();
  });
}

function decodeChunked(buf: string): string {
  let out = "";
  let rest = buf;
  while (rest.length > 0) {
    const idx = rest.indexOf("\r\n");
    if (idx < 0) break;
    const sizeLine = rest.slice(0, idx);
    const size = parseInt(sizeLine, 16);
    if (isNaN(size) || size === 0) break;
    const start = idx + 2;
    out += rest.slice(start, start + size);
    rest = rest.slice(start + size + 2); // skip trailing \r\n
  }
  return out;
}

/**
 * 解析 DDG HTML 提取 result__a / result__snippet。
 * 抓取规则（看真实 HTML）：
 *   - 每个结果在 <div class="result ..."> 块里
 *   - title: <a class="result__a" href="...">TITLE</a>
 *   - snippet: <a class="result__snippet">SNIPPET</a>
 *   - 真实 URL 在 redirect 参数：uddg=ENCODED
 *
 * HTML 实体解码基础：&amp; &lt; &gt; &quot; &#39; &nbsp;
 */
export function parseDuckDuckGoHtml(html: string, topK: number): SearchHit[] {
  const out: SearchHit[] = [];

  const titleRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

  const titles: Array<{ url: string; title: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = titleRe.exec(html)) !== null) {
    const url = m[1];
    const titleHtml = m[2];
    if (!url || titleHtml === undefined) continue;
    let realUrl = url;
    if (url.includes("duckduckgo.com/l/")) {
      try {
        const u = new URL(url.startsWith("//") ? `https:${url}` : url);
        const uddg = u.searchParams.get("uddg");
        if (uddg) realUrl = decodeURIComponent(uddg);
      } catch { /* keep as-is */ }
    }
    titles.push({ url: realUrl, title: decodeHtml(stripTags(titleHtml)) });
    if (titles.length >= topK) break;
  }

  const snippets: string[] = [];
  while ((m = snippetRe.exec(html)) !== null) {
    snippets.push(decodeHtml(stripTags(m[1] ?? "")));
  }

  for (let i = 0; i < titles.length; i++) {
    out.push({
      url: titles[i]!.url,
      title: titles[i]!.title,
      snippet: snippets[i] ?? "",
    });
  }
  return out;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim();
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}
