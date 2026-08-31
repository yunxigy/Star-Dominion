import type { SearchHit, SearchOptions, SearchProvider } from "./types.js";
import { normalizeSearchHit } from "./normalizer.js";
import { isAllowedByPolicy, type SourcePolicy } from "./policy.js";

export interface CompositeSearchOptions {
  providers: SearchProvider[];
  perProviderTopK?: number;
  policy?: SourcePolicy;
}

export class CompositeSearchProvider implements SearchProvider {
  readonly name: string;
  private readonly providers: SearchProvider[];
  private readonly perProviderTopK?: number;
  private readonly policy: SourcePolicy;

  constructor(opts: CompositeSearchOptions) {
    if (opts.providers.length === 0) throw new Error("CompositeSearchProvider requires at least one provider");
    this.providers = opts.providers;
    this.perProviderTopK = opts.perProviderTopK;
    this.policy = opts.policy ?? {};
    this.name = `composite(${opts.providers.map((p) => p.name).join("+")})`;
  }

  async search(query: string, topK: number, opts: SearchOptions = {}): Promise<SearchHit[]> {
    const perProviderTopK = this.perProviderTopK ?? topK;
    const settled = await Promise.allSettled(this.providers.map((provider) => provider.search(query, perProviderTopK, opts)));
    const lists = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    const seen = new Set<string>();
    const out: SearchHit[] = [];
    const maxLen = Math.max(0, ...lists.map((list) => list.length));
    for (let i = 0; i < maxLen; i++) {
      for (const list of lists) {
        const hit = list[i];
        if (!hit) continue;
        if (!isAllowedByPolicy(hit, this.policy)) continue;
        const normalized = normalizeSearchHit(hit);
        if (!normalized) continue;
        const key = normalized.canonicalUrl;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ url: normalized.url, title: normalized.title, snippet: normalized.snippet });
        if (out.length >= topK) return out;
      }
    }
    return out;
  }
}
