import { canonicalizeUrl } from "./normalizer.js";
import type { SearchHit, SearchOptions, SearchProvider } from "./types.js";
import { abortError } from "@deepresearch/net-utils";

export interface AcademicAugmentedSearchOptions {
  web: SearchProvider;
  academic: SearchProvider;
}

/**
 * Adds an academic index only for literature-shaped queries, then interleaves
 * its results with normal web results so neither source monopolizes topK.
 */
export class AcademicAugmentedSearchProvider implements SearchProvider {
  readonly name: string;

  constructor(private readonly opts: AcademicAugmentedSearchOptions) {
    this.name = "academic-augmented(" + opts.web.name + "+" + opts.academic.name + ")";
  }

  async search(query: string, topK: number, opts: SearchOptions = {}): Promise<SearchHit[]> {
    if (topK <= 0) return [];
    if (opts.signal?.aborted) throw abortError(opts.signal, "Academic search aborted");
    const academicQuery = arxivQueryForAcademicSearch(query);
    if (!academicQuery) return this.opts.web.search(query, topK, opts);
    const [web, academic] = await allSettledUnlessAborted([
      this.opts.web.search(query, topK, opts),
      this.opts.academic.search(academicQuery, topK, opts),
    ], opts.signal);
    const webHits = web.status === "fulfilled" ? web.value : [];
    const academicHits = academic.status === "fulfilled" ? academic.value : [];
    if (webHits.length === 0 && academicHits.length === 0 && web.status === "rejected" && academic.status === "rejected") {
      throw new Error("Web and academic search failed: " + errorMessage(web.reason) + " | " + errorMessage(academic.reason));
    }
    return interleaveUnique([webHits, academicHits], topK);
  }
}

export function arxivQueryForAcademicSearch(query: string): string | undefined {
  const trimmed = query.replace(/\s+/g, " ").trim();
  if (!trimmed || !looksAcademic(trimmed)) return undefined;
  if (/\b(?:all|au|ti|abs|cat|id|jr|co):/i.test(trimmed)) return trimmed;
  const authorPair = extractAuthorPair(trimmed);
  if (authorPair) return authorPair.map((author) => "au:" + quoteArxiv(author)).join(" AND ");
  const quoted = trimmed.match(/["“]([^"”]{4,80})["”]/)?.[1]?.trim();
  const author = extractAuthor(trimmed);
  const stop = new Set([
    "about", "and", "article", "conference", "definition", "doi", "et", "journal", "methods",
    "paper", "review", "source", "the", "with", "year",
  ]);
  const terms = (trimmed.match(/[A-Za-z][A-Za-z0-9'’-]{2,}/g) ?? [])
    .filter((term) => !stop.has(term.toLowerCase()))
    .filter((term) => term.toLowerCase() !== author?.toLowerCase())
    .slice(0, 8);
  const topic = quoted ? "all:" + quoteArxiv(quoted) : academicTopicExpression(trimmed, terms, author);
  if (author && topic) return "au:" + quoteArxiv(author) + " AND " + topic;
  if (author) return "au:" + quoteArxiv(author);
  return topic;
}

function extractAuthorPair(query: string): [string, string] | undefined {
  const match = query.match(/\b([\p{Lu}][\p{L}'’-]{2,})\s+(?:&|and\s+)?([\p{Lu}][\p{L}'’-]{2,})\s*[,([]?\s*(?:19|20)\d{2}\b/u);
  if (!match?.[1] || !match[2]) return undefined;
  return [match[1], match[2]];
}

function extractAuthor(query: string): string | undefined {
  const explicit = query.match(/\b(?:author|au)\s*[:=]?\s*([\p{Lu}][\p{L}'’-]{2,})\b/iu)?.[1];
  if (explicit) return explicit;
  return query.match(/\b([\p{Lu}][\p{L}'’-]{2,})(?:\s+et\s+al\.?)?\s*[,([]?\s*(?:19|20)\d{2}\b/u)?.[1]
    ?? query.match(/\b(?:19|20)\d{2}\s*[,;:-]?\s*([\p{Lu}][\p{L}'’-]{2,})\b/u)?.[1];
}

function academicTopicExpression(query: string, terms: string[], author?: string): string | undefined {
  if (/\bdevice[-\s]?independent\s+quantum\s+key\s+distribution\b/i.test(query) || /\bDI-?QKD\b/i.test(query)) {
    return 'all:"device-independent quantum key distribution"';
  }
  if (/\bdelegated\s+quantum\s+comput(?:ing|ation)\b/i.test(query)) {
    return '(all:"delegated quantum computation" OR all:"verified quantum computation" OR ti:"classical command of quantum systems")';
  }
  if (/\brobust\s+self[-\s]?testing\b/i.test(query)) {
    return 'all:"robust self-testing"';
  }
  const selfTesting = /\bself[-\s]?testing\b/i.test(query);
  if (selfTesting) {
    const facets = [
      /\bMermin\b/i.test(query) ? "all:Mermin" : undefined,
      /\bCHSH\b/i.test(query) ? "all:CHSH" : undefined,
      /\bparallel\b/i.test(query) ? "all:parallel" : undefined,
      /\bgraph\s+states?\b/i.test(query) ? 'all:"graph state"' : undefined,
      /\btilted\s+CHSH\b/i.test(query) ? 'all:"tilted CHSH"' : undefined,
      /\bMayers[-\s]Yao\b/i.test(query) ? 'all:"Mayers-Yao"' : undefined,
      /\bGHZ\b/i.test(query) ? "all:GHZ" : undefined,
      /\bW\s+states?\b/i.test(query) ? 'all:"W state"' : undefined,
    ].filter((value): value is string => Boolean(value));
    if (facets.length === 1) return 'all:"self-testing" AND ' + facets[0];
    if (facets.length > 1) return 'all:"self-testing" AND (' + facets.slice(0, 6).join(" OR ") + ")";
  }
  const topicTerms = terms.filter((term) => term.toLowerCase() !== author?.toLowerCase()).slice(0, author ? 2 : 4);
  return topicTerms.length > 0 ? "all:" + quoteArxiv(topicTerms.join(" ")) : undefined;
}

function looksAcademic(query: string): boolean {
  const latinCount = query.match(/[A-Za-z]/g)?.length ?? 0;
  if (latinCount < 5) return false;
  return /\b(?:arxiv|doi|et\s+al|journal|paper|conference|proceedings|theorem|protocol|inequality|quantum|self-testing|study|trial|review|19\d{2}|20\d{2})\b/i.test(query);
}

function quoteArxiv(value: string): string {
  const cleaned = value.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.includes(" ") ? "\"" + cleaned + "\"" : cleaned;
}

function interleaveUnique(lists: SearchHit[][], topK: number): SearchHit[] {
  const out: SearchHit[] = [];
  const seen = new Set<string>();
  const maxLength = Math.max(0, ...lists.map((list) => list.length));
  for (let index = 0; index < maxLength && out.length < topK; index++) {
    for (const list of lists) {
      const hit = list[index];
      if (!hit) continue;
      const key = canonicalizeUrl(hit.url) || hit.url;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(hit);
      if (out.length >= topK) break;
    }
  }
  return out;
}

function allSettledUnlessAborted<T>(
  promises: [Promise<T>, Promise<T>],
  signal?: AbortSignal,
): Promise<[PromiseSettledResult<T>, PromiseSettledResult<T>]> {
  const settled = Promise.allSettled(promises);
  if (!signal) return settled;
  if (signal.aborted) return Promise.reject(abortError(signal, "Academic search aborted"));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(abortError(signal, "Academic search aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void settled.then((result) => {
      signal.removeEventListener("abort", onAbort);
      resolve(result);
    });
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
