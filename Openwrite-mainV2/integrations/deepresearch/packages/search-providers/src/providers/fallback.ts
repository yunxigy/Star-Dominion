import type { SearchHit, SearchOptions, SearchProvider } from "./types.js";
import { abortError, throwIfAborted } from "@deepresearch/net-utils";

export interface FallbackSearchOptions {
  providers: SearchProvider[];
  continueOnEmpty?: boolean;
  acceptResults?: (input: {
    query: string;
    providerName: string;
    results: SearchHit[];
  }) => boolean;
}

/**
 * Uses providers in order and returns the first non-empty successful result.
 * Unlike CompositeSearchProvider it does not wait for every provider, making it
 * suitable for low-latency failover when one configured API is unavailable.
 */
export class FallbackSearchProvider implements SearchProvider {
  readonly name: string;
  private readonly providers: SearchProvider[];
  private readonly continueOnEmpty: boolean;
  private readonly acceptResults?: FallbackSearchOptions["acceptResults"];

  constructor(opts: FallbackSearchOptions) {
    if (opts.providers.length === 0) throw new Error("FallbackSearchProvider requires at least one provider");
    this.providers = [...opts.providers];
    this.continueOnEmpty = opts.continueOnEmpty ?? true;
    this.acceptResults = opts.acceptResults;
    this.name = `fallback(${this.providers.map((provider) => provider.name).join("->")})`;
  }

  async search(query: string, topK: number, opts: SearchOptions = {}): Promise<SearchHit[]> {
    const failures: string[] = [];
    let lastEmpty: SearchHit[] = [];
    let lastRejected: SearchHit[] | undefined;
    for (const provider of this.providers) {
      throwIfAborted(opts.signal, "Fallback search aborted");
      try {
        const results = await provider.search(query, topK, opts);
        if (results.length > 0) {
          const accepted = this.acceptResults?.({ query, providerName: provider.name, results }) ?? true;
          if (!accepted) {
            lastRejected = results;
            failures.push(`${provider.name}: results rejected`);
            continue;
          }
          return results;
        }
        if (!this.continueOnEmpty) return results;
        lastEmpty = results;
        failures.push(`${provider.name}: no results`);
      } catch (err) {
        if (opts.signal?.aborted) throw abortError(opts.signal, "Fallback search aborted");
        failures.push(`${provider.name}: ${errorMessage(err)}`);
      }
    }
    if (lastRejected) return lastRejected;
    if (failures.some((failure) => !failure.endsWith(": no results"))) {
      throw new Error(`All fallback search providers failed: ${failures.join(" | ")}`);
    }
    return lastEmpty;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
