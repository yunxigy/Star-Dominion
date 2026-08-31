import { createHash } from "node:crypto";
import type { SearchHit } from "./types.js";

export interface NormalizedSearchHit extends SearchHit {
  canonicalUrl: string;
  contentHash: string;
  sourceTier: "official" | "primary" | "secondary" | "unknown";
}

export function normalizeSearchHit(hit: SearchHit): NormalizedSearchHit | null {
  const canonicalUrl = canonicalizeUrl(hit.url);
  if (!canonicalUrl) return null;
  const title = cleanText(hit.title || canonicalUrl);
  const snippet = cleanText(hit.snippet || "");
  return {
    url: canonicalUrl,
    canonicalUrl,
    title,
    snippet,
    contentHash: `sha256:${createHash("sha256").update(`${canonicalUrl}\n${title}\n${snippet}`).digest("hex")}`,
    sourceTier: inferSourceTier(canonicalUrl),
  };
}

export function canonicalizeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (isTrackingParam(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function cleanText(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function inferSourceTier(url: string): NormalizedSearchHit["sourceTier"] {
  const host = new URL(url).hostname;
  if (host.endsWith(".gov") || host.endsWith(".gov.cn") || host.endsWith(".edu")) return "official";
  if (host.includes("arxiv.org") || host.includes("doi.org") || host.includes("nature.com") || host.includes("sciencedirect.com")) return "primary";
  if (host.includes("wikipedia.org") || host.includes("medium.com") || host.includes("reddit.com")) return "unknown";
  return "secondary";
}

function isTrackingParam(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized.startsWith("utm_") || ["fbclid", "gclid", "yclid", "mc_cid", "mc_eid"].includes(normalized);
}
