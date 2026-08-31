import { describe, it, expect } from "vitest";
import { MockSearchProvider } from "../providers/mock.js";
import { parseDuckDuckGoHtml } from "../providers/duckduckgo.js";
import { BingSearchProvider, officialEuropeanLawHits, parseBingHtml } from "../providers/bing.js";
import { BraveSearchProvider } from "../providers/brave.js";
import { BochaSearchProvider } from "../providers/bocha.js";
import { JinaSearchProvider } from "../providers/jina.js";
import { ArxivSearchProvider, parseArxivAtom } from "../providers/arxiv.js";
import { CompositeSearchProvider } from "../providers/composite.js";
import { FallbackSearchProvider } from "../providers/fallback.js";
import { canonicalizeUrl, normalizeSearchHit } from "../providers/normalizer.js";
import { isAllowedByPolicy } from "../providers/policy.js";

describe("MockSearchProvider", () => {
  it("基本调用：返回 topK 条结果", async () => {
    const p = new MockSearchProvider();
    const r = await p.search("DPO PPO", 3);
    expect(r).toHaveLength(3);
    expect(r[0]!.url).toMatch(/^https:\/\/example\.test\//);
    expect(r[0]!.title).toMatch(/DPO PPO/);
  });

  it("topK=0 → 空数组", async () => {
    const r = await new MockSearchProvider().search("x", 0);
    expect(r).toEqual([]);
  });

  it("空 query → 空数组", async () => {
    const r = await new MockSearchProvider().search("", 5);
    expect(r).toEqual([]);
  });

  it("相同 query 不同实例 → 稳定结果（不依赖 seed）", async () => {
    const r1 = await new MockSearchProvider({ seed: 1 }).search("q", 2);
    const r2 = await new MockSearchProvider({ seed: 99 }).search("q", 2);
    expect(r1).toEqual(r2);
  });
});

describe("parseDuckDuckGoHtml", () => {
  it("抓 1 条 result", () => {
    const html = `
<div class="result">
  <a class="result__a" href="https://arxiv.org/abs/2305.18290">DPO Paper</a>
  <a class="result__snippet">Direct Preference Optimization paper</a>
</div>`;
    const r = parseDuckDuckGoHtml(html, 5);
    expect(r).toEqual([
      { url: "https://arxiv.org/abs/2305.18290", title: "DPO Paper", snippet: "Direct Preference Optimization paper" },
    ]);
  });

  it("解 redirect uddg 参数拿真 URL", () => {
    const html = `
<a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Farxiv.org%2Fabs%2F2305.18290&kl=us-en">DPO Paper</a>
<a class="result__snippet">snippet</a>`;
    const r = parseDuckDuckGoHtml(html, 5);
    expect(r[0]!.url).toBe("https://arxiv.org/abs/2305.18290");
  });

  it("HTML 实体解码", () => {
    const html = `<a class="result__a" href="https://x.com">A &amp; B &lt;tag&gt; "quote"</a><a class="result__snippet">snippet</a>`;
    const r = parseDuckDuckGoHtml(html, 5);
    expect(r[0]!.title).toBe('A & B <tag> "quote"');
  });

  it("多结果 + topK 限制", () => {
    const html = Array.from({ length: 10 })
      .map((_, i) => `<a class="result__a" href="https://x.com/${i}">T${i}</a><a class="result__snippet">S${i}</a>`)
      .join("");
    const r = parseDuckDuckGoHtml(html, 3);
    expect(r).toHaveLength(3);
    expect(r[0]!.title).toBe("T0");
    expect(r[2]!.title).toBe("T2");
  });

  it("空 HTML → 空数组", () => {
    expect(parseDuckDuckGoHtml("", 5)).toEqual([]);
    expect(parseDuckDuckGoHtml("no result blocks here", 5)).toEqual([]);
  });
});

describe("parseBingHtml", () => {
  it("parses b_algo result blocks", () => {
    const html = `
<li class="b_algo"><h2><a href="https://example.com/a">A &amp; B</a></h2><div class="b_caption"><p>Snippet <strong>one</strong></p></div></li>
<li class="b_algo"><h2><a href="https://example.com/b">B</a></h2><p>Snippet two</p></li>`;
    expect(parseBingHtml(html, 1)).toEqual([
      { url: "https://example.com/a", title: "A & B", snippet: "Snippet one" },
    ]);
  });

  it("drops unrelated trending results before they can contaminate research evidence", async () => {
    const html = `
<li class="b_algo"><h2><a href="https://example.com/fashion">Celebrity runway fashion</a></h2><p>Latest couture news.</p></li>
<li class="b_algo"><h2><a href="https://nist.gov/ai-rmf">NIST AI Risk Management Framework</a></h2><p>Official AI RMF guidance.</p></li>`;
    const provider = new BingSearchProvider({ fetchImpl: async () => new Response(html) });
    await expect(provider.search("NIST AI risk management framework", 5)).resolves.toEqual([
      expect.objectContaining({ url: "https://nist.gov/ai-rmf" }),
    ]);
  });

  it("does not mistake Chinese research-instruction words for topic relevance", async () => {
    const html = `
<li class="b_algo"><h2><a href="https://wenku.baidu.com/generic">探究的意思解释</a></h2><p>探究是一种研究和分析问题的方法。</p></li>
<li class="b_algo"><h2><a href="https://example.com/mystery-craft">悬疑小说剧情设计指南</a></h2><p>用线索、误导和人物动机构建悬疑剧情。</p></li>`;
    const provider = new BingSearchProvider({ fetchImpl: async () => new Response(html) });
    await expect(provider.search("探究并解释悬疑小说剧情设计的基本原则和核心要素", 5)).resolves.toEqual([
      expect.objectContaining({ url: "https://example.com/mystery-craft" }),
    ]);
  });

  it("rejects an oversized Bing response while streaming", async () => {
    const provider = new BingSearchProvider({
      maxResponseBytes: 32,
      fetchImpl: async () => new Response("x".repeat(64)),
    });
    await expect(provider.search("AI risk", 5)).rejects.toThrow(/exceeds 32 byte limit while reading/);
  });

  it("resolves formal EU legislation identifiers directly to EUR-Lex without web-search ambiguity", async () => {
    expect(officialEuropeanLawHits("Regulation (EU) 2023/1542 Article 59")).toEqual([
      expect.objectContaining({
        url: "https://eur-lex.europa.eu/eli/reg/2023/1542/oj",
      }),
    ]);
    expect(officialEuropeanLawHits("CELEX: 32023R1542")).toHaveLength(1);
    expect(officialEuropeanLawHits("EUR-Lex 32023R1542 lithium recovery target")).toEqual([
      expect.objectContaining({
        url: "https://eur-lex.europa.eu/eli/reg/2023/1542/oj",
      }),
    ]);
    let networkCalled = false;
    const provider = new BingSearchProvider({ fetchImpl: async () => {
      networkCalled = true;
      return new Response("");
    } });
    await expect(provider.search("Regulation (EU) 2023/1542 official text", 5)).resolves.toEqual([
      expect.objectContaining({ url: "https://eur-lex.europa.eu/eli/reg/2023/1542/oj" }),
    ]);
    expect(networkCalled).toBe(false);
  });
});

describe("BraveSearchProvider", () => {
  it("calls Brave API and normalizes web results", async () => {
    let requestedUrl = "";
    let token = "";
    const provider = new BraveSearchProvider({
      apiKey: "test-token",
      fetchImpl: async (url, init) => {
        requestedUrl = String(url);
        token = String((init?.headers as Record<string, string>)["X-Subscription-Token"]);
        return new Response(JSON.stringify({
          web: {
            results: [
              { title: "Result <b>One</b>", url: "https://example.com/1", description: "Snippet <em>one</em>" },
              { title: "Result Two", url: "https://example.com/2", description: "Snippet two" },
            ],
          },
        }));
      },
    });

    await expect(provider.search("ai software", 1)).resolves.toEqual([
      { title: "Result One", url: "https://example.com/1", snippet: "Snippet one" },
    ]);
    expect(requestedUrl).toContain("q=ai+software");
    expect(token).toBe("test-token");
  });

  it("retries transient network errors and preserves the final cause", async () => {
    let calls = 0;
    const provider = new BraveSearchProvider({
      apiKey: "test-token",
      retry: 1,
      fetchImpl: async () => {
        calls += 1;
        const error = new TypeError("fetch failed") as TypeError & { cause?: unknown };
        error.cause = Object.assign(new Error("socket reset"), { code: "ECONNRESET", syscall: "read", hostname: "api.search.brave.com" });
        throw error;
      },
    });

    await expect(provider.search("ai", 1)).rejects.toThrow(
      "Brave Search fetch failed: TypeError: fetch failed; cause=ECONNRESET read api.search.brave.com socket reset",
    );
    expect(calls).toBe(2);
  });

  it("propagates cancellation into an active Brave request", async () => {
    const controller = new AbortController();
    const provider = new BraveSearchProvider({
      apiKey: "test-token",
      retry: 0,
      fetchImpl: async (_url, init) => await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      }),
    });
    const pending = provider.search("ai", 1, { signal: controller.signal });
    controller.abort("cancelled by test");

    await expect(pending).rejects.toThrow("cancelled by test");
  });
});

describe("BochaSearchProvider", () => {
  it("calls Bocha API and normalizes web page results", async () => {
    let requestedUrl = "";
    let method = "";
    let auth = "";
    let body: any;
    const provider = new BochaSearchProvider({
      apiKey: "test-token",
      fetchImpl: async (url, init) => {
        requestedUrl = String(url);
        method = init?.method ?? "";
        auth = String((init?.headers as Record<string, string>).Authorization);
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({
          code: 200,
          data: {
            webPages: {
              value: [
                { name: "Result <b>One</b>", url: "https://example.com/1", summary: "Summary <em>one</em>" },
                { name: "Result Two", url: "https://example.com/2", snippet: "Snippet two" },
              ],
            },
          },
        }));
      },
    });

    await expect(provider.search("马克思主义", 1)).resolves.toEqual([
      { title: "Result One", url: "https://example.com/1", snippet: "Summary one" },
    ]);
    expect(requestedUrl).toBe("https://api.bochaai.com/v1/web-search");
    expect(method).toBe("POST");
    expect(auth).toBe("Bearer test-token");
    expect(body).toMatchObject({ query: "马克思主义", freshness: "noLimit", summary: true, count: 10 });
  });

  it("supports flat result arrays returned by compatible Bocha responses", async () => {
    const provider = new BochaSearchProvider({
      apiKey: "test-token",
      fetchImpl: async () => new Response(JSON.stringify({
        code: 0,
        data: {
          results: [
            { title: "Flat result", url: "https://example.com/flat", description: "Flat description" },
          ],
        },
      })),
    });

    await expect(provider.search("flat", 3)).resolves.toEqual([
      { title: "Flat result", url: "https://example.com/flat", snippet: "Flat description" },
    ]);
  });

  it("serializes concurrent searches that share one Bocha provider", async () => {
    let active = 0;
    let maxActive = 0;
    const provider = new BochaSearchProvider({
      apiKey: "serial-test-token",
      retry: 0,
      minIntervalMs: 0,
      fetchImpl: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return new Response(JSON.stringify({
          code: 200,
          data: { webPages: { value: [{ name: "Result", url: "https://example.com/result" }] } },
        }));
      },
    });

    await Promise.all(Array.from({ length: 6 }, (_, index) => provider.search(`query-${index}`, 1)));

    expect(maxActive).toBe(1);
  });

  it("retries HTTP 429 and succeeds without synchronized immediate retry", async () => {
    let calls = 0;
    const provider = new BochaSearchProvider({
      apiKey: "rate-limit-test-token",
      retry: 1,
      minIntervalMs: 0,
      retryBaseDelayMs: 0,
      maxRetryDelayMs: 0,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          return new Response(JSON.stringify({ code: 429, message: "request limit" }), {
            status: 429,
            headers: { "retry-after": "0" },
          });
        }
        return new Response(JSON.stringify({
          code: 200,
          data: { webPages: { value: [{ name: "Recovered", url: "https://example.com/recovered" }] } },
        }));
      },
    });

    await expect(provider.search("recover", 1)).resolves.toEqual([
      { title: "Recovered", url: "https://example.com/recovered", snippet: "" },
    ]);
    expect(calls).toBe(2);
  });
});

describe("JinaSearchProvider", () => {
  it("clamps num to Jina API maximum", async () => {
    let requestedUrl = "";
    const provider = new JinaSearchProvider({
      apiKey: "test-token",
      maxNum: 100,
      fetchImpl: async (url) => {
        requestedUrl = String(url);
        return new Response(JSON.stringify({
          data: Array.from({ length: 20 }, (_, index) => ({
            title: `Result ${index + 1}`,
            url: `https://example.com/${index + 1}`,
            description: `Snippet ${index + 1}`,
          })),
        }));
      },
    });

    await expect(provider.search("marxism", 40)).resolves.toHaveLength(20);
    expect(new URL(requestedUrl).searchParams.get("num")).toBe("20");
  });

  it("treats Jina 422 no-search-results as an empty result set", async () => {
    const provider = new JinaSearchProvider({
      apiKey: "test-token",
      retry: 3,
      fetchImpl: async () => new Response(JSON.stringify({
        data: null,
        code: 422,
        name: "AssertionFailureError",
        status: 42206,
        message: "No search results found",
      }), { status: 422 }),
    });

    await expect(provider.search("query with no matches", 5)).resolves.toEqual([]);
  });
});

describe("parseArxivAtom", () => {
  it("parses arXiv Atom entries", () => {
    const xml = `
<feed><entry>
  <id>http://arxiv.org/abs/2501.00001v1</id>
  <title>AI and Social Relationships</title>
  <published>2025-01-01T00:00:00Z</published>
  <author><name>Alice Smith</name></author>
  <summary>We study AI companions and interpersonal relationships.</summary>
</entry></feed>`;
    expect(parseArxivAtom(xml, 1)).toEqual([
      {
        url: "https://arxiv.org/abs/2501.00001v1",
        title: "AI and Social Relationships",
        snippet: "Published: 2025-01-01. Authors: Alice Smith. We study AI companions and interpersonal relationships.",
      },
    ]);
  });

  it("propagates caller cancellation into the arXiv request", async () => {
    const controller = new AbortController();
    const provider = new ArxivSearchProvider({
      timeoutMs: 60_000,
      fetchImpl: async (_url, init) => await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      }),
    });
    const pending = provider.search('all:"self-testing"', 3, { signal: controller.signal });
    controller.abort("cancel arxiv test");

    await expect(pending).rejects.toThrow("cancel arxiv test");
  });
});

describe("CompositeSearchProvider", () => {
  it("merges providers and deduplicates URLs", async () => {
    const provider = new CompositeSearchProvider({
      providers: [
        { name: "a", search: async () => [{ url: "https://example.com/a#x", title: "A", snippet: "" }] },
        { name: "b", search: async () => [{ url: "https://example.com/a", title: "A2", snippet: "" }, { url: "https://example.com/b", title: "B", snippet: "" }] },
      ],
    });
    await expect(provider.search("q", 5)).resolves.toEqual([
      { url: "https://example.com/a", title: "A", snippet: "" },
      { url: "https://example.com/b", title: "B", snippet: "" },
    ]);
  });

  it("interleaves providers instead of letting the first provider fill topK", async () => {
    const provider = new CompositeSearchProvider({
      providers: [
        { name: "a", search: async () => [{ url: "https://example.com/a1", title: "A1", snippet: "" }, { url: "https://example.com/a2", title: "A2", snippet: "" }] },
        { name: "b", search: async () => [{ url: "https://example.com/b1", title: "B1", snippet: "" }, { url: "https://example.com/b2", title: "B2", snippet: "" }] },
      ],
    });
    await expect(provider.search("q", 3)).resolves.toEqual([
      { url: "https://example.com/a1", title: "A1", snippet: "" },
      { url: "https://example.com/b1", title: "B1", snippet: "" },
      { url: "https://example.com/a2", title: "A2", snippet: "" },
    ]);
  });

  it("filters blocked hosts through source policy", async () => {
    const provider = new CompositeSearchProvider({
      providers: [
        { name: "a", search: async () => [
          { url: "https://wikipedia.org/wiki/X", title: "Blocked", snippet: "" },
          { url: "https://example.com/x", title: "Allowed", snippet: "" },
        ] },
      ],
      policy: { blockedHosts: ["wikipedia.org"] },
    });
    await expect(provider.search("q", 5)).resolves.toEqual([
      { url: "https://example.com/x", title: "Allowed", snippet: "" },
    ]);
  });
});

describe("FallbackSearchProvider", () => {
  it("uses the next provider after an error", async () => {
    const provider = new FallbackSearchProvider({
      providers: [
        { name: "primary", search: async () => { throw new Error("primary unavailable"); } },
        { name: "secondary", search: async () => [{ url: "https://example.com/result", title: "Result", snippet: "ok" }] },
      ],
    });

    await expect(provider.search("q", 5)).resolves.toEqual([
      { url: "https://example.com/result", title: "Result", snippet: "ok" },
    ]);
  });

  it("uses the next provider after an empty result", async () => {
    const provider = new FallbackSearchProvider({
      providers: [
        { name: "empty", search: async () => [] },
        { name: "secondary", search: async () => [{ url: "https://example.com/result", title: "Result", snippet: "ok" }] },
      ],
    });

    await expect(provider.search("q", 5)).resolves.toHaveLength(1);
  });

  it("uses the next provider when the first non-empty results are rejected", async () => {
    const calls: string[] = [];
    const provider = new FallbackSearchProvider({
      providers: [
        { name: "portal", search: async () => [{ url: "https://downloads.example/app", title: "Official download", snippet: "" }] },
        { name: "authority", search: async () => [{ url: "https://docs.example.org/app", title: "App documentation", snippet: "" }] },
      ],
      acceptResults: ({ providerName, results }) => {
        calls.push(providerName);
        return results.some((result) => new URL(result.url).hostname.startsWith("docs."));
      },
    });

    await expect(provider.search("app official documentation", 5)).resolves.toEqual([
      { url: "https://docs.example.org/app", title: "App documentation", snippet: "" },
    ]);
    expect(calls).toEqual(["portal", "authority"]);
  });

  it("returns the last non-empty result set when every provider result is rejected", async () => {
    const provider = new FallbackSearchProvider({
      providers: [
        { name: "first", search: async () => [{ url: "https://example.com/first", title: "First", snippet: "" }] },
        { name: "last", search: async () => [{ url: "https://example.com/last", title: "Last", snippet: "" }] },
      ],
      acceptResults: () => false,
    });

    await expect(provider.search("q", 5)).resolves.toEqual([
      { url: "https://example.com/last", title: "Last", snippet: "" },
    ]);
  });

  it("reports every provider when all providers fail", async () => {
    const provider = new FallbackSearchProvider({
      providers: [
        { name: "primary", search: async () => { throw new Error("timeout"); } },
        { name: "secondary", search: async () => { throw new Error("rate limited"); } },
      ],
    });

    await expect(provider.search("q", 5)).rejects.toThrow("primary: timeout | secondary: rate limited");
  });

  it("stops fallback immediately when the caller aborts", async () => {
    const controller = new AbortController();
    let secondaryCalls = 0;
    const provider = new FallbackSearchProvider({
      providers: [
        {
          name: "primary",
          search: async (_query, _topK, opts) => {
            controller.abort("cancel benchmark");
            if (opts?.signal?.aborted) throw new Error("provider observed abort");
            return [];
          },
        },
        { name: "secondary", search: async () => { secondaryCalls += 1; return []; } },
      ],
    });

    await expect(provider.search("q", 5, { signal: controller.signal })).rejects.toThrow("cancel benchmark");
    expect(secondaryCalls).toBe(0);
  });
});

describe("search normalization and policy", () => {
  it("canonicalizes URLs and strips tracking params", () => {
    expect(canonicalizeUrl("HTTPS://Example.COM/a/?utm_source=x&b=1#frag")).toBe("https://example.com/a?b=1");
  });

  it("cleans HTML text and infers source tier", () => {
    const normalized = normalizeSearchHit({
      url: "https://arxiv.org/abs/1234.5678?utm_campaign=x",
      title: "<b>Paper</b> &amp; Result",
      snippet: "A  <em>snippet</em>",
    });
    expect(normalized).toMatchObject({
      url: "https://arxiv.org/abs/1234.5678",
      title: "Paper & Result",
      snippet: "A snippet",
      sourceTier: "primary",
    });
    expect(normalized?.contentHash).toMatch(/^sha256:/);
  });

  it("rejects invalid URLs and blocked hosts", () => {
    expect(isAllowedByPolicy({ url: "not a url", title: "", snippet: "" })).toBe(false);
    expect(isAllowedByPolicy(
      { url: "https://sub.example.com/x", title: "", snippet: "" },
      { blockedHosts: ["example.com"] },
    )).toBe(false);
  });
});
