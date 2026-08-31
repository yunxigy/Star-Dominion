// 测试用确定性搜索 provider。返回基于 query 长度 + seed 生成的假结果，不调用任何外部 API。
import type { SearchHit, SearchProvider } from "./types.js";

export type { SearchHit, SearchProvider };

export class MockSearchProvider implements SearchProvider {
  readonly name = "mock";
  private seed: number;

  constructor(opts: { seed?: number } = {}) {
    this.seed = opts.seed ?? 42;
  }

  async search(query: string, topK: number): Promise<SearchHit[]> {
    if (!query || topK <= 0) return [];
    const base = Math.max(1, query.length);
    const out: SearchHit[] = [];
    for (let i = 0; i < topK; i++) {
      const url = `https://example.test/${this.slug(query)}/result-${base + i}`;
      out.push({
        url,
        title: `${query} – result ${i + 1}`,
        snippet: `Mock snippet for "${query}" item ${i + 1}`,
      });
    }
    return out;
  }

  private slug(s: string): string {
    return s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40) || "q";
  }
}
