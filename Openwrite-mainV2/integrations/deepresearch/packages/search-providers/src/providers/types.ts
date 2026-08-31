// 搜索 provider 核心契约。所有搜索 provider（Jina, Brave, Bing, arXiv 等）实现此接口。

/** 单条搜索结果 */
export interface SearchHit {
  url: string;
  title: string;
  snippet: string;
}

export interface SearchOptions {
  signal?: AbortSignal;
}

/** 搜索 provider 接口。实现方需提供 search 方法返回 SearchHit[]。 */
export interface SearchProvider {
  readonly name: string;
  search(query: string, topK: number, opts?: SearchOptions): Promise<SearchHit[]>;
}
