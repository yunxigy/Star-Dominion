import { describe, expect, it, vi } from "vitest";

import { createIdempotencyKey, SiteClient } from "./site-client";

const batch = {
  provider: "fxtwitter" as const,
  modelProvider: "google" as const,
  modelName: "gemini-2.5-flash",
  posts: [{
    id: "20",
    author: "OpenAI",
    username: "OpenAI",
    text: "We released a model.",
    url: "https://x.com/OpenAI/status/20",
    publishedAt: "2026-09-25T10:00:00.000Z",
    importance: 80,
  }],
  summary: {
    title: "AI 圈大事",
    summary: "OpenAI 发布了新模型。",
    events: [],
    risks: [],
  },
};

describe("SiteClient", () => {
  it("sends a bearer-authenticated batch with a stable idempotency key", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ accepted: 1, duplicates: 0, reportId: "report-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new SiteClient({
      endpoint: "https://reports.example.test/reports-api/api/v1/ingest/x",
      token: "site-test-secret",
      fetcher,
    });

    const result = await client.push(batch);
    const request = fetcher.mock.calls[0][1]!;
    const headers = new Headers(request.headers);
    const expectedKey = await createIdempotencyKey(batch.provider, batch.posts);

    expect(String(fetcher.mock.calls[0][0])).toBe(
      "https://reports.example.test/reports-api/api/v1/ingest/x",
    );
    expect(headers.get("authorization")).toBe("Bearer site-test-secret");
    expect(headers.get("x-idempotency-key")).toBe(expectedKey);
    expect(await createIdempotencyKey(batch.provider, batch.posts)).toBe(expectedKey);
    expect(JSON.parse(String(request.body))).toEqual(batch);
    expect(result).toMatchObject({ accepted: 1, reportId: "report-1" });
  });

  it("retries transient site failures but never retries client errors", async () => {
    const transient = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("busy", { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ accepted: 1 }), { status: 200 }));
    const client = new SiteClient({
      endpoint: "https://reports.example.test/ingest",
      token: "site-test-secret",
      fetcher: transient,
      retryDelayMs: 0,
    });
    await client.push(batch);
    expect(transient).toHaveBeenCalledTimes(2);

    const rejected = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("unauthorized", { status: 401 }),
    );
    const unauthorized = new SiteClient({
      endpoint: "https://reports.example.test/ingest",
      token: "site-test-secret",
      fetcher: rejected,
    });
    let message = "";
    try {
      await unauthorized.push(batch);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(rejected).toHaveBeenCalledTimes(1);
    expect(message).toContain("401");
    expect(message).not.toContain("site-test-secret");
  });
});
