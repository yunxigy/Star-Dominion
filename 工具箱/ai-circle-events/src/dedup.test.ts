import { describe, expect, it } from "vitest";

import { deduplicatePosts, normalizePostText, normalizePostUrl } from "./dedup";
import type { NormalizedPost } from "./providers/types";

const post = (overrides: Partial<NormalizedPost> = {}): NormalizedPost => ({
  id: "1",
  author: "OpenAI",
  username: "OpenAI",
  handle: "OpenAI",
  text: "New Model",
  url: "https://x.com/OpenAI/status/1",
  publishedAt: "2026-09-25T10:00:00.000Z",
  replyingTo: null,
  isRetweet: false,
  ...overrides,
});

describe("X post deduplication", () => {
  it("normalizes whitespace and Unicode before comparing text", () => {
    expect(normalizePostText(" Ｎｅｗ   Model \n")).toBe("new model");
  });

  it("removes tracking query parameters and trailing slash from URLs", () => {
    expect(normalizePostUrl("https://example.test/story/?utm_source=x&s=20"))
      .toBe("https://example.test/story");
  });

  it("keeps the first post for duplicate ids, normalized text, and normalized URLs", () => {
    const result = deduplicatePosts([
      post(),
      post({ id: "2", text: "new   model", url: "https://x.com/OpenAI/status/2" }),
      post({ id: "3", text: "Different wording", url: "https://x.com/OpenAI/status/1?s=20" }),
      post({ id: "1", text: "Another update", url: "https://x.com/OpenAI/status/4" }),
    ]);

    expect(result.map(({ id }) => id)).toEqual(["1"]);
  });
});
