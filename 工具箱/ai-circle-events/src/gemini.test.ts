import { describe, expect, it, vi } from "vitest";

import { GeminiClient } from "./gemini";
import type { NormalizedPost } from "./providers/types";

const post: NormalizedPost = {
  id: "20",
  author: "OpenAI",
  username: "OpenAI",
  handle: "OpenAI",
  text: "We released a new reasoning model.",
  url: "https://x.com/OpenAI/status/20",
  publishedAt: "2026-09-25T10:00:00.000Z",
  replyingTo: null,
  isRetweet: false,
};

const validResult = {
  posts: [{
    id: post.id,
    author: post.author,
    username: post.username,
    text: post.text,
    url: post.url,
    publishedAt: post.publishedAt,
    importance: 87,
  }],
  summary: {
    title: "AI 圈大事",
    summary: "OpenAI 发布了新的推理模型。",
    events: [{
      title: "发布推理模型",
      summary: "新模型已对外发布。",
      importance: 87,
      postIds: [post.id],
    }],
    risks: [],
  },
};

const modelResponse = (output: unknown) =>
  new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: typeof output === "string" ? output : JSON.stringify(output) }] } }],
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

function clientFor(output: unknown, fetcher = vi.fn<typeof fetch>().mockResolvedValue(modelResponse(output))) {
  return new GeminiClient({
    apiKey: "gemini-test-secret",
    model: "gemini-2.5-flash",
    fetcher,
    retries: 0,
    retryDelayMs: 0,
  });
}

describe("GeminiClient", () => {
  it("requests schema-constrained JSON once and keeps the API key out of the URL", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(modelResponse(validResult));
    const client = clientFor(validResult, fetcher);

    const report = await client.summarize([post]);
    const requestUrl = String(fetcher.mock.calls[0][0]);
    const request = JSON.parse(String(fetcher.mock.calls[0][1]?.body));

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(requestUrl).toContain("/v1beta/models/gemini-2.5-flash:generateContent");
    expect(requestUrl).not.toContain("gemini-test-secret");
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get("x-goog-api-key"))
      .toBe("gemini-test-secret");
    expect(request.generationConfig.responseMimeType).toBe("application/json");
    expect(report).toEqual(validResult);
  });

  it("accepts fenced JSON but rejects malformed JSON", async () => {
    const fence = String.fromCharCode(96).repeat(3);
    const fenced = fence + "json\n" + JSON.stringify(validResult) + "\n" + fence;
    await expect(clientFor(fenced).summarize([post])).resolves.toEqual(validResult);
    await expect(clientFor("not JSON").summarize([post])).rejects.toThrow(/JSON/i);
  });

  it.each([
    ["missing post", { ...validResult, posts: [] }],
    ["extra post", { ...validResult, posts: [...validResult.posts, { ...validResult.posts[0], id: "21" }] }],
    ["rewritten source text", {
      ...validResult,
      posts: [{ ...validResult.posts[0], text: "A rewritten summary" }],
    }],
    ["out-of-range importance", {
      ...validResult,
      posts: [{ ...validResult.posts[0], importance: 101 }],
    }],
    ["unknown event reference", {
      ...validResult,
      summary: {
        ...validResult.summary,
        events: [{ ...validResult.summary.events[0], postIds: ["unknown"] }],
      },
    }],
  ])("rejects model output with %s", async (_label, output) => {
    await expect(clientFor(output).summarize([post])).rejects.toThrow(/invalid|match|reference/i);
  });

  it("retries transient service errors but does not retry a client error", async () => {
    const transient = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(modelResponse(validResult));
    const retryingClient = new GeminiClient({
      apiKey: "gemini-test-secret",
      model: "gemini-2.5-flash",
      fetcher: transient,
      retries: 1,
      retryDelayMs: 0,
    });
    await expect(retryingClient.summarize([post])).resolves.toEqual(validResult);
    expect(transient).toHaveBeenCalledTimes(2);

    const invalidRequest = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "bad request" } }), { status: 400 }),
    );
    await expect(clientFor(validResult, invalidRequest).summarize([post])).rejects.toThrow(/400/);
    expect(invalidRequest).toHaveBeenCalledTimes(1);
  });
});
