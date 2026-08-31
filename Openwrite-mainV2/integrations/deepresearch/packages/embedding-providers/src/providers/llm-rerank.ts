// LlmRerankProvider：把"embedding"实现为"用 LLM 评分"。
// 工作原理：对一对 (query, candidate) text，调 LLM 返回 0-1 相似度分数。
// 用途：deepseek 不提供真 embedding 端点，但提供 chat；用 chat 评分能"用纯 LLM API 跑通"语义召回。
// 缺点：不能做"对 N 个 candidate 全跑 cosine"那种成对比较——只能逐对调用 LLM。
// 适用场景：分支去重（duplicate_risk 计算），而不是大规模资源召回。

import type { EmbeddingRequest, EmbeddingService, EmbeddingVector } from "@deepresearch/contracts";
import { cosine, featureHash, stableId } from "../internal/feature-hash.js";

export interface LlmRerankProviderOptions {
  /** 调用 LLM 的函数。返回 0-1 的语义相似度分数。 */
  scoreFn: (a: string, b: string) => Promise<number>;
  /** fallback dim（feature hash 用） */
  dim?: number;
  /** id 前缀 */
  idPrefix?: string;
}

export class LlmRerankProvider implements EmbeddingService {
  readonly name = "llm-rerank";
  readonly dim: number;
  private readonly scoreFn: (a: string, b: string) => Promise<number>;
  private readonly idPrefix: string;

  constructor(opts: LlmRerankProviderOptions) {
    this.dim = opts.dim ?? 64;
    this.scoreFn = opts.scoreFn;
    this.idPrefix = opts.idPrefix ?? "emb";
  }

  async embed(req: EmbeddingRequest): Promise<EmbeddingVector> {
    const id = req.id ?? stableId(this.idPrefix, req.text);
    // 单条 embed 没有 query，就用 feature hash 当 placeholder
    return { id, vector: featureHash(req.text, this.dim), dim: this.dim, model: this.name };
  }

  async embedBatch(reqs: EmbeddingRequest[]): Promise<EmbeddingVector[]> {
    return Promise.all(reqs.map((r) => this.embed(r)));
  }

  /** 重点方法：替代 cosine 的 pairwise 评分。 */
  async score(a: string, b: string): Promise<number> {
    return this.scoreFn(a, b);
  }

  cosine(a: number[], b: number[]): number {
    return cosine(a, b);
  }
}
