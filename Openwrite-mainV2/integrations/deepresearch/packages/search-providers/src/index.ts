// 搜索 provider 统一导出。
export type { SearchHit, SearchOptions, SearchProvider } from "./providers/types.js";
export { DuckDuckGoSearchProvider } from "./providers/duckduckgo.js";
export { BingSearchProvider, officialEuropeanLawHits, parseBingHtml, type BingSearchOptions } from "./providers/bing.js";
export { BraveSearchProvider, type BraveSearchOptions } from "./providers/brave.js";
export { BochaSearchProvider, type BochaSearchOptions } from "./providers/bocha.js";
export { ArxivSearchProvider, parseArxivAtom, type ArxivSearchOptions } from "./providers/arxiv.js";
export {
  AcademicAugmentedSearchProvider,
  arxivQueryForAcademicSearch,
  type AcademicAugmentedSearchOptions,
} from "./providers/academic.js";
export { CompositeSearchProvider, type CompositeSearchOptions } from "./providers/composite.js";
export { FallbackSearchProvider, type FallbackSearchOptions } from "./providers/fallback.js";
export { JinaSearchProvider, type JinaSearchOptions } from "./providers/jina.js";
export {
  canonicalizeUrl,
  cleanText,
  inferSourceTier,
  normalizeSearchHit,
  type NormalizedSearchHit,
} from "./providers/normalizer.js";
export { isAllowedByPolicy, type SourcePolicy } from "./providers/policy.js";
