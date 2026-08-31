import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FetchPageProvider, UserFileProvider, stripHtml, normalizeSearchHit } from "../index.js";
import { selectPdfHighlights } from "../fetch-page.js";

describe("tool-providers", () => {
  const dirs: string[] = [];
  const resolvePublicHost = async () => [{ address: "93.184.216.34", family: 4 }];
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  it("exports normalized search utilities", () => {
    expect(normalizeSearchHit({ url: "https://example.com/a#x", title: "<b>A</b>", snippet: "S" })).toMatchObject({
      url: "https://example.com/a",
      title: "A",
    });
  });

  it("fetches and strips page content", async () => {
    const provider = new FetchPageProvider({
      resolveHost: resolvePublicHost,
      fetchImpl: async () => new Response("<html><head><title>Hello</title><meta name=\"description\" content=\"Desc\"></head><body><script>x</script><h1>Title</h1></body></html>", {
        status: 200,
      }),
    });
    await expect(provider.fetchPage("https://example.test")).resolves.toMatchObject({
      title: "Hello",
      description: "Desc",
      content: "Hello Title",
    });
  });

  it("moves task-focused evidence from the tail of a long HTML document into retained context", async () => {
    const provider = new FetchPageProvider({
      resolveHost: resolvePublicHost,
      fetchImpl: async () => new Response(`<html><body>${"Background filler. ".repeat(120)}<h2>Article 59</h2><p>Portable battery collection target is 63 percent.</p>${"Later filler. ".repeat(300)}</body></html>`),
    });
    const page = await provider.fetchPage("https://example.test/long-law", {
      maxChars: 2_000,
      focusTerms: ["Article 59 portable battery collection target"],
    });
    expect(page.content).toContain("Focused source passage");
    expect(page.content).toContain("Portable battery collection target is 63 percent");
  });

  it("rejects text responses whose declared size exceeds the buffer limit", async () => {
    const provider = new FetchPageProvider({
      resolveHost: resolvePublicHost,
      retry: 0,
      maxTextBytes: 32,
      fetchImpl: async () => new Response("small", {
        status: 200,
        headers: { "content-length": "1024", "content-type": "text/html" },
      }),
    });
    await expect(provider.fetchPage("https://example.test/oversized")).rejects.toThrow(/exceeds 32 byte limit: 1024/);
  });

  it("stops buffering a streamed text response when its actual size exceeds the limit", async () => {
    const provider = new FetchPageProvider({
      resolveHost: resolvePublicHost,
      retry: 0,
      maxTextBytes: 32,
      fetchImpl: async () => new Response("x".repeat(64), {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    });
    await expect(provider.fetchPage("https://example.test/streamed-oversized")).rejects.toThrow(/exceeds 32 byte limit while reading/);
  });

  it("preserves official PDF and download links from fetched HTML", async () => {
    const provider = new FetchPageProvider({
      resolveHost: resolvePublicHost,
      fetchImpl: async () => new Response(`
        <html><head><title>Official report</title></head><body>
          <a href="/files/report.pdf?download=1">Download full report (PDF)</a>
          <a href="/about">About us</a>
        </body></html>
      `, { status: 200, headers: { "content-type": "text/html" } }),
    });
    const page = await provider.fetchPage("https://official.example/reports/landing");
    expect(page.content).toContain("Document links discovered on this page:");
    expect(page.content).toContain("https://official.example/files/report.pdf?download=1");
    expect(page.content).not.toContain("https://official.example/about");
  });

  it("extracts readable text from a directly fetched PDF", async () => {
    const provider = new FetchPageProvider({
      resolveHost: resolvePublicHost,
      fetchImpl: async () => new Response(minimalPdf("Official report PDF text for extraction test."), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }),
    });
    await expect(provider.fetchPage("https://official.example/report.pdf")).resolves.toMatchObject({
      title: "report.pdf",
      content: expect.stringContaining("Official report PDF text for extraction test."),
    });
  });

  it("falls back to bounded OCR when a PDF has no useful text layer", async () => {
    let observedContext: { maxPages: number; languages: string } | undefined;
    let observedPdfBytes = 0;
    const provider = new FetchPageProvider({
      resolveHost: resolvePublicHost,
      maxOcrPages: 4,
      ocrLanguages: "eng+snum",
      pdfOcrImpl: async (bytes, context) => {
        observedPdfBytes = bytes.byteLength;
        observedContext = context;
        return "--- OCR page 1 ---\nScanned report finding: verified result.";
      },
      fetchImpl: async () => new Response(minimalPdf(""), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }),
    });
    const page = await provider.fetchPage("https://official.example/scanned.pdf");
    expect(page.content).toContain("OCR text from scanned PDF");
    expect(page.content).toContain("Scanned report finding: verified result.");
    expect(observedPdfBytes).toBeGreaterThan(100);
    expect(observedContext).toMatchObject({ maxPages: 1, languages: "eng+snum" });
  });

  it("rejects unsafe OCR language arguments before invoking external commands", () => {
    expect(() => new FetchPageProvider({ ocrScannedPdfs: true, ocrLanguages: "eng; rm -rf /" })).toThrow(/ocrLanguages/);
  });

  it("rejects invalid resource-limit configuration instead of disabling the guard through NaN", () => {
    expect(() => new FetchPageProvider({ maxTextBytes: Number.NaN })).toThrow(/maxTextBytes/);
    expect(() => new FetchPageProvider({ maxPdfBytes: 500_000_000 })).toThrow(/maxPdfBytes/);
    expect(() => new FetchPageProvider({ maxRedirects: Number.NaN })).toThrow(/maxRedirects/);
  });

  it("moves ranked PDF findings into the retained leading context", async () => {
    const target = "The top 10 growing skills are creative thinking, analytical thinking, and technological literacy.";
    const content = `${"Background material. ".repeat(800)} ${target}`;
    const highlights = selectPdfHighlights(content);
    expect(highlights).toMatch(/^--- PDF automatically selected passages ---/);
    expect(highlights?.indexOf(target)).toBeGreaterThan(0);
    expect(highlights?.indexOf(target)).toBeLessThan(8_000);
  });

  it("moves late market-share and competition findings into PDF highlights", () => {
    const target = "Market shares in the relevant jurisdiction were AWS 46%, Azure 18%, and Google Cloud 7%.";
    const content = `${"Unrelated introductory material. ".repeat(700)} ${target}`;
    const highlights = selectPdfHighlights(content);
    expect(highlights).toContain(target);
  });

  it("fetches pages through Jina Reader mode", async () => {
    const requested: string[] = [];
    const provider = new FetchPageProvider({
      useJinaReader: true,
      apiKey: "test-key",
      resolveHost: resolvePublicHost,
      fetchImpl: async (url, init) => {
        requested.push(String(url));
        expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
        return new Response("Title: Reader title\nURL Source: https://example.test/doc\nDescription: Reader desc\n\n# Reader title\n\nReader markdown body.", {
          status: 200,
        });
      },
    });
    await expect(provider.fetchPage("https://example.test/doc")).resolves.toMatchObject({
      url: "https://example.test/doc",
      title: "Reader title",
      description: "Reader desc",
      content: expect.stringContaining("Reader markdown body"),
    });
    expect(requested[0]).toBe("https://r.jina.ai/https://example.test/doc");
  });

  it("passes abort signals to fetch_page", async () => {
    const controller = new AbortController();
    controller.abort("stop");
    await expect(new FetchPageProvider().fetchPage("https://example.test", { signal: controller.signal })).rejects.toThrow("stop");
  });

  it.each([
    "http://localhost/admin",
    "http://127.0.0.1/secrets",
    "http://169.254.169.254/latest/meta-data",
    "http://10.0.0.8/internal",
    "http://[::1]/internal",
    "http://[::ffff:127.0.0.1]/internal",
  ])("blocks non-public fetch targets: %s", async (url) => {
    const provider = new FetchPageProvider({ fetchImpl: async () => new Response("must not run") });
    await expect(provider.fetchPage(url)).rejects.toThrow(/blocked non-public network target/);
  });

  it("blocks a public hostname that resolves to a private address", async () => {
    const provider = new FetchPageProvider({
      resolveHost: async () => [{ address: "10.10.0.7", family: 4 }],
      fetchImpl: async () => new Response("must not run"),
    });
    await expect(provider.fetchPage("https://research.example.test/report")).rejects.toThrow(/resolves to non-public address 10\.10\.0\.7/);
  });

  it("revalidates DNS at the actual direct connection boundary", async () => {
    let resolutions = 0;
    const provider = new FetchPageProvider({
      proxy: "",
      retry: 0,
      resolveHost: async () => {
        resolutions += 1;
        return resolutions <= 3
          ? [{ address: "93.184.216.34", family: 4 }]
          : [{ address: "127.0.0.1", family: 4 }];
      },
    });
    await expect(provider.fetchPage("http://dns-rebinding.example/report")).rejects.toThrow(/resolves to non-public address 127\.0\.0\.1/);
    expect(resolutions).toBeGreaterThanOrEqual(4);
  });

  it("validates every redirect target before following it", async () => {
    let requests = 0;
    const provider = new FetchPageProvider({
      resolveHost: resolvePublicHost,
      retry: 0,
      fetchImpl: async () => {
        requests += 1;
        return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } });
      },
    });
    await expect(provider.fetchPage("https://public.example.test/start")).rejects.toThrow(/blocked non-public network target/);
    expect(requests).toBe(1);
  });

  it("rejects credentials embedded in fetch URLs", async () => {
    const provider = new FetchPageProvider({ resolveHost: resolvePublicHost, fetchImpl: async () => new Response("must not run") });
    await expect(provider.fetchPage("https://user:pass@example.test/report")).rejects.toThrow(/does not allow credentials/);
  });

  it("reads user files with metadata", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dr-user-file-"));
    dirs.push(dir);
    const path = join(dir, "note.txt");
    await writeFile(path, "hello world", "utf8");
    await expect(new UserFileProvider().readFile({ fileId: "F_1", path })).resolves.toEqual({
      fileId: "F_1",
      filename: "note.txt",
      mimeType: "text/plain",
      content: "hello world",
    });
  });

  it("strips script and style blocks", () => {
    expect(stripHtml("<style>x</style><p>A &amp; B</p><script>y</script>")).toBe("A & B");
  });

  it("falls back to the Jina reader when the direct fetch fails, sending the API key only to the reader", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const provider = new FetchPageProvider({
      mode: "fallback",
      apiKey: "jina_test_key",
      retry: 0,
      resolveHost: resolvePublicHost,
      fetchImpl: async (input, init) => {
        const url = String(input);
        calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
        if (url.startsWith("https://r.jina.ai/")) {
          return new Response("Title: Recovered Title\n\nURL Source: https://example.test/blocked\n\nMarkdown Content:\nRecovered reader content.", { status: 200 });
        }
        return new Response("Forbidden", { status: 403 });
      },
    });

    const page = await provider.fetchPage("https://example.test/blocked");

    expect(page.title).toBe("Recovered Title");
    expect(page.content).toContain("Recovered reader content");
    expect(calls.map((call) => call.url)).toEqual([
      "https://example.test/blocked",
      "https://r.jina.ai/https://example.test/blocked",
    ]);
    expect(calls[0]!.headers.Authorization).toBeUndefined();
    expect(calls[1]!.headers.Authorization).toBe("Bearer jina_test_key");
  });

  it("does not call the reader when the direct fetch succeeds in fallback mode", async () => {
    const urls: string[] = [];
    const provider = new FetchPageProvider({
      mode: "fallback",
      retry: 0,
      resolveHost: resolvePublicHost,
      fetchImpl: async (input) => {
        urls.push(String(input));
        return new Response("<html><head><title>Direct</title></head><body>Direct content.</body></html>", { status: 200 });
      },
    });

    await expect(provider.fetchPage("https://example.test/easy")).resolves.toMatchObject({ title: "Direct" });
    expect(urls).toEqual(["https://example.test/easy"]);
  });

  it("reports the direct failure when both direct and reader fetches fail", async () => {
    const provider = new FetchPageProvider({
      mode: "fallback",
      retry: 0,
      resolveHost: resolvePublicHost,
      fetchImpl: async (input) => new Response("nope", { status: String(input).startsWith("https://r.jina.ai/") ? 503 : 403 }),
    });

    await expect(provider.fetchPage("https://example.test/hard")).rejects.toThrow(/HTTP 403.*jina reader fallback also failed.*HTTP 503/s);
  });

  it("never sends the reader API key to origin sites in direct mode", async () => {
    const seen: (Record<string, string> | undefined)[] = [];
    const provider = new FetchPageProvider({
      mode: "direct",
      apiKey: "jina_test_key",
      resolveHost: resolvePublicHost,
      fetchImpl: async (_input, init) => {
        seen.push(init?.headers as Record<string, string> | undefined);
        return new Response("<html><head><title>Origin</title></head><body>Origin content.</body></html>", { status: 200 });
      },
    });

    await expect(provider.fetchPage("https://example.test/page")).resolves.toMatchObject({ title: "Origin" });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.Authorization).toBeUndefined();
  });

  it("reader fallback does not require the origin host to resolve locally", async () => {
    const provider = new FetchPageProvider({
      mode: "fallback",
      retry: 0,
      resolveHost: async (hostname) => {
        if (hostname === "dead.example.test") throw new Error("getaddrinfo ENOTFOUND dead.example.test");
        return [{ address: "93.184.216.34", family: 4 }];
      },
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.startsWith("https://r.jina.ai/")) {
          return new Response("Title: Reader Saved\n\nURL Source: https://dead.example.test/x\n\nReader body.", { status: 200 });
        }
        throw new Error("direct fetch must not be attempted for a DNS-dead origin");
      },
    });

    await expect(provider.fetchPage("https://dead.example.test/x")).resolves.toMatchObject({ title: "Reader Saved" });
  });

  it("does not retry permanent failures like HTTP 403 or TLS certificate errors", async () => {
    let calls = 0;
    const forbidden = new FetchPageProvider({
      retry: 2,
      resolveHost: resolvePublicHost,
      fetchImpl: async () => {
        calls += 1;
        return new Response("Forbidden", { status: 403 });
      },
    });
    await expect(forbidden.fetchPage("https://example.test/a")).rejects.toThrow(/HTTP 403/);
    expect(calls).toBe(1);

    let tlsCalls = 0;
    const tlsBroken = new FetchPageProvider({
      retry: 2,
      resolveHost: resolvePublicHost,
      fetchImpl: async () => {
        tlsCalls += 1;
        throw new TypeError("fetch failed", { cause: new Error("Hostname/IP does not match certificate's altnames") });
      },
    });
    await expect(tlsBroken.fetchPage("https://example.test/b")).rejects.toThrow(/altnames/);
    expect(tlsCalls).toBe(1);
  });

  it("still retries transient failures like HTTP 500", async () => {
    let calls = 0;
    const provider = new FetchPageProvider({
      retry: 2,
      resolveHost: resolvePublicHost,
      fetchImpl: async () => {
        calls += 1;
        return new Response("boom", { status: 500 });
      },
    });
    await expect(provider.fetchPage("https://example.test/c")).rejects.toThrow(/HTTP 500/);
    expect(calls).toBe(3);
  });
});

function minimalPdf(text: string): Uint8Array {
  const stream = `BT /F1 18 Tf 72 720 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((objectBody, index) => {
    offsets.push(new TextEncoder().encode(body).length);
    body += `${index + 1} 0 obj\n${objectBody}\nendobj\n`;
  });
  const xrefOffset = new TextEncoder().encode(body).length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}
