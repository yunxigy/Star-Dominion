import type { SearchHit } from "./types.js";

export interface SourcePolicy {
  blockedHosts?: string[];
  blockedUrlPatterns?: RegExp[];
}

export function isAllowedByPolicy(hit: SearchHit, policy: SourcePolicy = {}): boolean {
  let url: URL;
  try {
    url = new URL(hit.url);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if ((policy.blockedHosts ?? []).some((blocked) => host === blocked.toLowerCase() || host.endsWith(`.${blocked.toLowerCase()}`))) {
    return false;
  }
  return !(policy.blockedUrlPatterns ?? []).some((pattern) => pattern.test(hit.url));
}
