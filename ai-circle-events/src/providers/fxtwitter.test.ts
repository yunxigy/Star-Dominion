import { describe, expect, it, vi } from "vitest";

import { FxTwitterProvider } from "./fxtwitter";

const status = (id: string, text = "New model release") => ({
  type: "status",
  id,
  url: "https://x.com/OpenAI/status/" + id,
  text,
  created_at: "2026-09-25T10:00:00.000Z",
  author: { name: "OpenAI", screen_name: "OpenAI" },
  replying_to: { status: "", screen_name: "" },
});

const page = (results: unknown[], bottom: string | null) =>
  new Response(JSON.stringify({ code: 200, results, cursor: { top: null, bottom } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("FxTwitterProvider", () => {
  it("normalizes a timeline post and encodes the monitored handle", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(page([status("20")], null));
    const provider = new FxTwitterProvider({
      baseUrl: "https://api.fxtwitter.com",
      fetcher,
      maxPages: 4,
    });

    const scan = await provider.fetchLatest("OpenAI");

    expect(new URL(String(fetcher.mock.calls[0][0])).pathname)
      .toBe("/2/profile/OpenAI/statuses");
    expect(scan.posts[0]).toMatchObject({
      id: "20",
      author: "OpenAI",
      username: "OpenAI",
      text: "New model release",
      url: "https://x.com/OpenAI/status/20",
      publishedAt: "2026-09-25T10:00:00.000Z",
      handle: "OpenAI",
    });
    expect(scan.scanComplete).toBe(true);
  });

  it("follows cursors until it reaches the last successfully delivered post", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(page([status("30"), status("29")], "next-page"))
      .mockResolvedValueOnce(page([status("28"), status("27"), status("26")], "older"));
    const provider = new FxTwitterProvider({
      baseUrl: "https://api.fxtwitter.com",
      fetcher,
      maxPages: 4,
    });

    const scan = await provider.fetchLatest("OpenAI", { afterPostId: "27" });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetcher.mock.calls[1][0])).searchParams.get("cursor"))
      .toBe("next-page");
    expect(scan.posts.map((post) => post.id)).toEqual(["30", "29", "28"]);
    expect(scan.reachedAfterPostId).toBe(true);
    expect(scan.scanComplete).toBe(true);
  });

  it("marks a scan incomplete rather than advancing past the safe page limit", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(page([status("30")], "next-page"))
      .mockResolvedValueOnce(page([status("29")], "older"));
    const provider = new FxTwitterProvider({
      baseUrl: "https://api.fxtwitter.com",
      fetcher,
      maxPages: 2,
    });

    const scan = await provider.fetchLatest("OpenAI", { afterPostId: "1" });

    expect(scan.latestPostId).toBe("30");
    expect(scan.reachedAfterPostId).toBe(false);
    expect(scan.scanComplete).toBe(false);
  });

  it("uses only the newest page on the first run", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(page([status("30")], "next-page"));
    const provider = new FxTwitterProvider({
      baseUrl: "https://api.fxtwitter.com",
      fetcher,
      maxPages: 4,
    });

    const scan = await provider.fetchLatest("OpenAI");

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(scan.posts.map((post) => post.id)).toEqual(["30"]);
    expect(scan.scanComplete).toBe(true);
  });

  it("retries a transient server failure but rejects malformed provider data", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("temporary", { status: 503 }))
      .mockResolvedValueOnce(page([status("30")], null));
    const provider = new FxTwitterProvider({
      baseUrl: "https://api.fxtwitter.com",
      fetcher,
      maxPages: 1,
      retryDelayMs: 0,
    });

    await provider.fetchLatest("OpenAI");
    expect(fetcher).toHaveBeenCalledTimes(2);

    const malformed = new FxTwitterProvider({
      baseUrl: "https://api.fxtwitter.com",
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(page([{}], null)),
      maxPages: 1,
      retries: 0,
    });
    await expect(malformed.fetchLatest("OpenAI")).rejects.toThrow(/invalid/i);
  });

  it("retries rate limits and aborts a request at its configured timeout", async () => {
    const limitedFetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(page([status("30")], null));
    const limitedProvider = new FxTwitterProvider({
      baseUrl: "https://api.fxtwitter.com",
      fetcher: limitedFetcher,
      maxPages: 1,
      retryDelayMs: 0,
    });

    await limitedProvider.fetchLatest("OpenAI");
    expect(limitedFetcher).toHaveBeenCalledTimes(2);

    const timedOutFetcher = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    );
    const timedOutProvider = new FxTwitterProvider({
      baseUrl: "https://api.fxtwitter.com",
      fetcher: timedOutFetcher,
      maxPages: 1,
      retries: 0,
      timeoutMs: 5,
    });

    await expect(timedOutProvider.fetchLatest("OpenAI")).rejects.toThrow(/timed out/i);
  });
});
