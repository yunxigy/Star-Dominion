import type { NormalizedPost } from "./providers/types";

export function normalizePostText(text: string): string {
  return text.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/gu, " ").trim();
}

export function normalizePostUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    const keys: string[] = [];
    url.searchParams.forEach((_value, key) => keys.push(key));
    for (const key of keys) {
      if (/^utm_/iu.test(key) || ["s", "t", "ref", "source"].includes(key.toLocaleLowerCase("en-US"))) {
        url.searchParams.delete(key);
      }
    }
    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/u, "");
    }
    return url.toString().replace(/\?$/u, "");
  } catch {
    return value.trim();
  }
}

export function deduplicatePosts(posts: readonly NormalizedPost[]): NormalizedPost[] {
  const seenIds = new Set<string>();
  const seenTexts = new Set<string>();
  const seenUrls = new Set<string>();
  const unique: NormalizedPost[] = [];

  for (const post of posts) {
    const text = normalizePostText(post.text);
    const url = normalizePostUrl(post.url);
    if (seenIds.has(post.id) || (text && seenTexts.has(text)) || (url && seenUrls.has(url))) {
      continue;
    }
    seenIds.add(post.id);
    if (text) seenTexts.add(text);
    if (url) seenUrls.add(url);
    unique.push(post);
  }
  return unique;
}
