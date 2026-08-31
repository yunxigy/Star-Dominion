import { ReadableStream } from "node:stream/web";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FetchPageProvider } from "../index.js";

/**
 * SSRF / DNS-rebinding guard tests for FetchPageProvider. Everything runs
 * offline: fetches are injected fakes, DNS answers come from fake resolveHost
 * callbacks, and the undici module is mocked so the connection-time DNS
 * pinning interceptor can be exercised without opening sockets.
 */

const PUBLIC_ADDRESS = "93.184.216.34";
const resolvePublic = async () => [{ address: PUBLIC_ADDRESS, family: 4 }];
const htmlResponse = () => new Response("<html><body>ok</body></html>", {
  status: 200,
  headers: { "content-type": "text/html" },
});

const undiciState = vi.hoisted(() => ({
  fetch: vi.fn(),
  dnsConfig: undefined as {
    maxTTL: number;
    lookup: (
      origin: { hostname: string },
      options: unknown,
      callback: (error: Error | null, addresses: Array<{ address: string; family: number; ttl: number }>) => void,
    ) => void;
  } | undefined,
  composedDispatcher: undefined as object | undefined,
  dnsInterceptor: { kind: "dns-interceptor" },
}));

vi.mock("undici", () => ({
  Agent: class {
    compose(interceptor: object): object {
      undiciState.composedDispatcher = { interceptor };
      return undiciState.composedDispatcher;
    }
  },
  ProxyAgent: class {
    constructor(readonly options: unknown) {}
  },
  interceptors: {
    dns: (config: NonNullable<typeof undiciState.dnsConfig>): object => {
      undiciState.dnsConfig = config;
      return undiciState.dnsInterceptor;
    },
  },
  fetch: undiciState.fetch,
}));

describe("fetch-page SSRF and DNS-rebinding guards", () => {
  beforeEach(() => {
    undiciState.fetch.mockReset();
    undiciState.fetch.mockImplementation(async () => htmlResponse());
    undiciState.dnsConfig = undefined;
    undiciState.composedDispatcher = undefined;
  });

  describe("non-public target blocking", () => {
    it.each([
      // RFC1918 and other private/reserved IPv4 ranges.
      "http://172.16.0.1/internal",
      "http://172.31.255.255/internal",
      "http://192.168.1.1/internal",
      "http://127.255.0.1/loopback",
      "http://0.0.0.0/",
      "http://100.64.0.1/cgnat",
      "http://169.254.0.1/link-local",
      "http://192.0.0.8/reserved",
      "http://192.0.2.1/documentation",
      "http://198.18.0.1/benchmark",
      "http://198.51.100.1/documentation",
      "http://203.0.113.1/documentation",
      "http://224.0.0.1/multicast",
      // IPv6 unspecified, link-local, ULA, multicast, documentation.
      "http://[::]/",
      "http://[fe80::1]/link-local",
      "http://[fd00::1]/ula",
      "http://[ff02::1]/multicast",
      "http://[2001:db8::1]/documentation",
      // Local hostnames.
      "http://foo.localhost/",
      "http://printer.local/",
      "http://nas.internal/",
      "http://gw.home.arpa/",
    ])("blocks %s before any fetch happens", async (url) => {
      const fetchImpl = vi.fn(async () => htmlResponse());
      const provider = new FetchPageProvider({ fetchImpl });
      await expect(provider.fetchPage(url)).rejects.toThrow(/blocked non-public network target/);
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it.each([
      ["http://93.184.216.34/", "public IPv4 literal"],
      ["http://172.15.0.1/", "IPv4 just outside 172.16/12"],
      ["http://[::ffff:5db8:d822]/", "IPv4-mapped IPv6 form of 93.184.216.34"],
    ])("allows %s (%s)", async (url) => {
      const resolveHost = vi.fn(resolvePublic);
      const fetchImpl = vi.fn(async () => htmlResponse());
      const provider = new FetchPageProvider({ resolveHost, fetchImpl });
      await expect(provider.fetchPage(url)).resolves.toMatchObject({ content: "ok" });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      // IP literals never go through DNS at all.
      expect(resolveHost).not.toHaveBeenCalled();
    });

    it("fetches a public hostname once DNS answers with a public address", async () => {
      const resolveHost = vi.fn(resolvePublic);
      const provider = new FetchPageProvider({ resolveHost, fetchImpl: async () => htmlResponse() });
      await expect(provider.fetchPage("https://example.test/report")).resolves.toMatchObject({ content: "ok" });
      expect(resolveHost).toHaveBeenCalledWith("example.test");
    });
  });

  describe("allowPrivateNetwork escape hatch", () => {
    it("allows private IP literals without consulting DNS", async () => {
      const resolveHost = vi.fn(resolvePublic);
      const fetchImpl = vi.fn(async () => htmlResponse());
      const provider = new FetchPageProvider({ allowPrivateNetwork: true, resolveHost, fetchImpl });
      await expect(provider.fetchPage("http://192.168.1.1/intranet")).resolves.toMatchObject({ content: "ok" });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(resolveHost).not.toHaveBeenCalled();
    });

    it("allows hostnames that resolve to private addresses", async () => {
      const resolveHost = vi.fn(async () => [{ address: "10.0.0.9", family: 4 }]);
      const provider = new FetchPageProvider({ allowPrivateNetwork: true, resolveHost, fetchImpl: async () => htmlResponse() });
      await expect(provider.fetchPage("https://intranet.example/wiki")).resolves.toMatchObject({ content: "ok" });
      expect(resolveHost).not.toHaveBeenCalled();
    });

    it("still enforces URL scheme validation", async () => {
      const provider = new FetchPageProvider({ allowPrivateNetwork: true, fetchImpl: async () => htmlResponse() });
      await expect(provider.fetchPage("file:///etc/passwd")).rejects.toThrow(/only supports http/);
    });
  });

  describe("resolvePublicHost DNS answer validation", () => {
    it("rejects an empty DNS answer", async () => {
      const provider = new FetchPageProvider({ resolveHost: async () => [], fetchImpl: async () => htmlResponse() });
      await expect(provider.fetchPage("https://empty.example/")).rejects.toThrow(/could not safely resolve empty\.example: no addresses/);
    });

    it("rejects DNS answers that are not IP addresses", async () => {
      const provider = new FetchPageProvider({
        resolveHost: async () => [{ address: "not-an-ip", family: 4 }],
        fetchImpl: async () => htmlResponse(),
      });
      await expect(provider.fetchPage("https://weird.example/")).rejects.toThrow(/resolves to non-public address not-an-ip/);
    });

    it("rejects DNS answers containing a private IPv6 address", async () => {
      const provider = new FetchPageProvider({
        resolveHost: async () => [{ address: "fd00::1", family: 6 }],
        fetchImpl: async () => htmlResponse(),
      });
      await expect(provider.fetchPage("https://v6.example/")).rejects.toThrow(/resolves to non-public address fd00::1/);
    });

    it("rejects DNS answers containing the cloud metadata address", async () => {
      const provider = new FetchPageProvider({
        resolveHost: async () => [{ address: "169.254.169.254", family: 4 }],
        fetchImpl: async () => htmlResponse(),
      });
      await expect(provider.fetchPage("https://metadata.example/")).rejects.toThrow(/resolves to non-public address 169\.254\.169\.254/);
    });

    it("rejects mixed DNS answers when any address is private (round-robin rebinding)", async () => {
      const provider = new FetchPageProvider({
        resolveHost: async () => [
          { address: PUBLIC_ADDRESS, family: 4 },
          { address: "10.0.0.9", family: 4 },
        ],
        fetchImpl: async () => htmlResponse(),
      });
      await expect(provider.fetchPage("https://round-robin.example/")).rejects.toThrow(/resolves to non-public address 10\.0\.0\.9/);
    });

    it("wraps resolver failures with the hostname context", async () => {
      const provider = new FetchPageProvider({
        resolveHost: async () => {
          throw new Error("NXDOMAIN");
        },
        fetchImpl: async () => htmlResponse(),
      });
      await expect(provider.fetchPage("https://flaky.example/")).rejects.toThrow(/could not safely resolve flaky\.example: Error: NXDOMAIN/);
    });
  });

  describe("redirect chain revalidation", () => {
    it("blocks a redirect to a hostname resolving to a private address", async () => {
      const resolveHost = async (hostname: string) =>
        hostname === "cdn.evil.example" ? [{ address: "10.0.0.9", family: 4 }] : [{ address: PUBLIC_ADDRESS, family: 4 }];
      const fetchImpl = vi.fn(async () =>
        new Response(null, { status: 302, headers: { location: "https://cdn.evil.example/loot" } }));
      const provider = new FetchPageProvider({ resolveHost, fetchImpl, retry: 0 });
      await expect(provider.fetchPage("https://public.example/start")).rejects.toThrow(/resolves to non-public address 10\.0\.0\.9/);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("blocks a redirect to the cloud metadata address", async () => {
      const fetchImpl = vi.fn(async () =>
        new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }));
      const provider = new FetchPageProvider({ resolveHost: resolvePublic, fetchImpl, retry: 0 });
      await expect(provider.fetchPage("https://public.example/start")).rejects.toThrow(/blocked non-public network target: 169\.254\.169\.254/);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("follows a relative redirect that stays on a public host", async () => {
      const requested: string[] = [];
      const fetchImpl = vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        requested.push(url);
        if (url.endsWith("/start")) {
          return new Response(null, { status: 302, headers: { location: "/page2" } });
        }
        return htmlResponse();
      });
      const provider = new FetchPageProvider({ resolveHost: resolvePublic, fetchImpl, retry: 0 });
      await expect(provider.fetchPage("https://public.example/start")).resolves.toMatchObject({ content: "ok" });
      expect(requested).toEqual(["https://public.example/start", "https://public.example/page2"]);
    });

    it("treats a redirect response without a Location header as final", async () => {
      const provider = new FetchPageProvider({
        resolveHost: resolvePublic,
        retry: 0,
        fetchImpl: async () => new Response(null, { status: 302 }),
      });
      await expect(provider.fetchPage("https://public.example/start")).rejects.toThrow(/fetch_page HTTP 302/);
    });

    it("stops following redirects past maxRedirects", async () => {
      const fetchImpl = vi.fn(async () =>
        new Response(null, { status: 302, headers: { location: "https://public.example/loop" } }));
      const provider = new FetchPageProvider({ resolveHost: resolvePublic, fetchImpl, retry: 0, maxRedirects: 2 });
      await expect(provider.fetchPage("https://public.example/start")).rejects.toThrow(/fetch_page exceeded 2 redirects/);
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    });

    it("revalidates the final response URL reported by the transport", async () => {
      const fakeResponse = { ok: true, status: 200, url: "http://169.254.169.254/" } as unknown as Response;
      const provider = new FetchPageProvider({ resolveHost: resolvePublic, retry: 0, fetchImpl: async () => fakeResponse });
      await expect(provider.fetchPage("https://public.example/start")).rejects.toThrow(/blocked non-public network target: 169\.254\.169\.254/);
    });
  });

  describe("connection-time DNS pinning (anti-rebinding)", () => {
    const getFetch = (provider: FetchPageProvider): Promise<typeof fetch> =>
      (provider as unknown as { getFetch(): Promise<typeof fetch> }).getFetch();

    it("routes fetches through a dispatcher composed with the pinning DNS interceptor", async () => {
      const provider = new FetchPageProvider({ proxy: "", resolveHost: resolvePublic });
      const page = await provider.fetchPage("https://example.test/report");
      expect(page.content).toContain("ok");
      expect(undiciState.dnsConfig?.maxTTL).toBe(10_000);
      expect(undiciState.composedDispatcher).toBeDefined();
      expect(undiciState.fetch).toHaveBeenCalledTimes(1);
      const init = undiciState.fetch.mock.calls[0]?.[1] as { dispatcher?: object; redirect?: string };
      expect(init.dispatcher).toBe(undiciState.composedDispatcher);
      expect(init.redirect).toBe("manual");
    });

    it("maps validated DNS answers to connection addresses with family and TTL", async () => {
      const answers: Record<string, Array<{ address: string; family: number }>> = {
        "v4.example": [{ address: PUBLIC_ADDRESS, family: 4 }],
        "v6.example": [{ address: "2606:4700:4700::1111", family: 6 }],
      };
      const resolveHost = vi.fn(async (hostname: string) => answers[hostname] ?? []);
      const provider = new FetchPageProvider({ proxy: "", resolveHost });
      await getFetch(provider);
      const lookup = undiciState.dnsConfig?.lookup;
      expect(lookup).toBeDefined();
      const lookupOnce = (hostname: string) =>
        new Promise<{ error: Error | null; addresses: Array<{ address: string; family: number; ttl: number }> }>((resolve) => {
          lookup!({ hostname }, {}, (error, addresses) => resolve({ error, addresses }));
        });
      const v4 = await lookupOnce("V4.example");
      const v6 = await lookupOnce("v6.example");
      // Hostnames are normalized (lowercased) before resolution.
      expect(resolveHost).toHaveBeenCalledWith("v4.example");
      expect(v4).toEqual({ error: null, addresses: [{ address: PUBLIC_ADDRESS, family: 4, ttl: 10_000 }] });
      expect(v6).toEqual({ error: null, addresses: [{ address: "2606:4700:4700::1111", family: 6, ttl: 10_000 }] });
    });

    it("fails the connection attempt when the pinning lookup rejects", async () => {
      const resolveHost = async () => [{ address: "127.0.0.1", family: 4 }];
      const provider = new FetchPageProvider({ proxy: "", resolveHost });
      await getFetch(provider);
      const lookup = undiciState.dnsConfig?.lookup;
      expect(lookup).toBeDefined();
      const { error, addresses } = await new Promise<{
        error: Error | null;
        addresses: Array<{ address: string; family: number; ttl: number }>;
      }>((resolve) => {
        lookup!({ hostname: "rebinding.example" }, {}, (lookupError, lookupAddresses) => resolve({ error: lookupError, addresses: lookupAddresses }));
      });
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/resolves to non-public address 127\.0\.0\.1/);
      expect(addresses).toEqual([]);
    });

    it("returns the raw undici fetch when allowPrivateNetwork is set", async () => {
      const provider = new FetchPageProvider({ proxy: "", allowPrivateNetwork: true });
      await expect(getFetch(provider)).resolves.toBe(undiciState.fetch);
    });
  });

  describe("response size limits", () => {
    it("rejects a PDF whose declared size exceeds maxPdfBytes", async () => {
      const provider = new FetchPageProvider({
        resolveHost: resolvePublic,
        retry: 0,
        maxPdfBytes: 100,
        fetchImpl: async () => new Response("%PDF-1.4 fake", {
          status: 200,
          headers: { "content-type": "application/pdf", "content-length": "200" },
        }),
      });
      await expect(provider.fetchPage("https://example.test/big.pdf")).rejects.toThrow(/PDF exceeds 100 byte limit: 200/);
    });

    it("rejects a PDF whose actual bytes exceed maxPdfBytes", async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(150));
          controller.close();
        },
      });
      const provider = new FetchPageProvider({
        resolveHost: resolvePublic,
        retry: 0,
        maxPdfBytes: 100,
        fetchImpl: async () => new Response(stream, {
          status: 200,
          headers: { "content-type": "application/pdf" },
        }),
      });
      await expect(provider.fetchPage("https://example.test/big.pdf")).rejects.toThrow(/PDF exceeds 100 byte limit: 150/);
    });
  });

  describe("URL validation", () => {
    it.each(["file:///etc/passwd", "ftp://example.test/x"])("rejects non-http(s) URL %s", async (url) => {
      const provider = new FetchPageProvider({ fetchImpl: async () => htmlResponse() });
      await expect(provider.fetchPage(url)).rejects.toThrow(/only supports http/);
    });
  });
});
