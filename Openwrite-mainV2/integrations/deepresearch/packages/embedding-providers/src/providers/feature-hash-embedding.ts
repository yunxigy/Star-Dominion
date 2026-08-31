// FeatureHashEmbedding：纯本地 feature hashing embedding，零外部依赖。
// 用途：embedding 入库的默认实现，benchmark / 单测 / 离线跑通。
// 维度可选 64 / 128 / 256 / 512，用确定性哈希（无需外部 API）。

import type { EmbeddingRequest, EmbeddingService, EmbeddingVector } from "@deepresearch/contracts";
import { cosine, featureHash, stableId } from "../internal/feature-hash.js";

export interface FeatureHashEmbeddingOptions {
  /** 输出维度。默认 128。越大越精细，但 cosine 也更稀疏。 */
  dim?: number;
  /** 生成的 id 默认前缀 */
  idPrefix?: string;
}

export class FeatureHashEmbedding implements EmbeddingService {
  readonly name = "feature-hash";
  readonly dim: number;
  private readonly idPrefix: string;

  constructor(opts: FeatureHashEmbeddingOptions = {}) {
    this.dim = opts.dim ?? 128;
    this.idPrefix = opts.idPrefix ?? "emb";
  }

  async embed(req: EmbeddingRequest): Promise<EmbeddingVector> {
    const id = req.id ?? stableId(this.idPrefix, req.text);
    return {
      id,
      vector: featureHash(req.text, this.dim),
      dim: this.dim,
      model: this.name,
    };
  }

  async embedBatch(reqs: EmbeddingRequest[]): Promise<EmbeddingVector[]> {
    return reqs.map((r) => {
      const id = r.id ?? stableId(this.idPrefix, r.text);
      return { id, vector: featureHash(r.text, this.dim), dim: this.dim, model: this.name };
    });
  }

  cosine(a: number[], b: number[]): number {
    return cosine(a, b);
  }
}
