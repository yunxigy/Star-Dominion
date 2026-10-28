import { describe, expect, it } from "vitest";

import { filterPosts, shouldKeepPost } from "./filter";
import type { NormalizedPost } from "./providers/types";

const post = (overrides: Partial<NormalizedPost> = {}): NormalizedPost => ({
  id: "1",
  author: "OpenAI",
  username: "OpenAI",
  handle: "OpenAI",
  text: "We released a new reasoning model with a public benchmark.",
  url: "https://x.com/OpenAI/status/1",
  publishedAt: "2026-09-25T10:00:00.000Z",
  replyingTo: null,
  isRetweet: false,
  ...overrides,
});

describe("X post filtering", () => {
  it("drops empty and emoji-only replies", () => {
    expect(shouldKeepPost(post({ text: "", replyingTo: { status: "0", screenName: "user" } })))
      .toBe(false);
    expect(shouldKeepPost(post({ text: "🙌 🎉", replyingTo: { status: "0", screenName: "user" } })))
      .toBe(false);
  });

  it("drops brief courtesy replies and link-only templates", () => {
    expect(shouldKeepPost(post({
      text: "Thanks!",
      replyingTo: { status: "0", screenName: "user" },
    }))).toBe(false);
    expect(shouldKeepPost(post({ text: "https://example.com/promo" }))).toBe(false);
  });

  it("drops obvious promotion without an independent industry announcement", () => {
    expect(shouldKeepPost(post({
      text: "Sponsored: sign up today and use code SAVE20 for a discount.",
    }))).toBe(false);
  });

  it("keeps original announcements and substantive reposts", () => {
    expect(shouldKeepPost(post())).toBe(true);
    expect(shouldKeepPost(post({
      isRetweet: true,
      text: "This open-source model release changes inference costs by 40%.",
    }))).toBe(true);
  });

  it("filters a batch without mutating its input", () => {
    const posts = [post(), post({ id: "2", text: "Thanks!", replyingTo: { status: "0", screenName: "x" } })];

    expect(filterPosts(posts).map(({ id }) => id)).toEqual(["1"]);
    expect(posts).toHaveLength(2);
  });
});
