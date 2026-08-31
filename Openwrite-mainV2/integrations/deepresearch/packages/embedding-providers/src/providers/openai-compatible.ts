// OpenAICompatibleEmbeddingProvider：调 OpenAI 兼容的 /v1/embeddings 端点。
// DeepSeek 不提供 embedding 端点（验证：POST /v1/embeddings 返回空 body），所以这个 provider
// 默认只用于"接了真 embedding 后端"的场景（如 text-embedding-3-small / Voyage / Cohere / 本地 sentence-transformers 起的兼容 server）。
// 留作占位 + 测试 fixture；不阻塞 MVP 跑通。

import type { EmbeddingRequest, EmbeddingService, EmbeddingVector } from "@deepresearch/contracts";
import { cosine } from "../internal/feature-hash.js";

export interface OpenAICompatibleEmbeddingProviderOptions {
  /** OpenAI 兼容 base url。例：https://api.openai.com/v1、http://localhost:8080/v1 */
  baseUrl: string;
  /** API key */
  apiKey: string;
  /** 模型名。例：text-embedding-3-small */
  model: string;
  /** id 默认前缀 */
  idPrefix?: string;
  /** 自定义 fetch（测试时可注入） */
  fetchImpl?: typeof fetch;
}

export class OpenAICompatibleEmbeddingProvider implements EmbeddingService {
  readonly name = "openai-compatible";
  readonly dim: number;
  private readonly opts: Required<OpenAICompatibleEmbeddingProviderOptions>;

  constructor(opts: OpenAICompatibleEmbeddingProviderOptions) {
    this.opts = {
      idPrefix: "emb",
      fetchImpl: defaultFetch,
      ...opts,
    };
    this.dim = 0; // 真模型的 dim 由 provider 端决定，调用方按返回的 vector.length 自适应
  }

  async embed(req: EmbeddingRequest): Promise<EmbeddingVector> {
    const r = await this.embedBatch([req]);
    return r[0]!;
  }

  async embedBatch(reqs: EmbeddingRequest[]): Promise<EmbeddingVector[]> {
    if (reqs.length === 0) return [];
    const f = this.opts.fetchImpl;
    if (!f) throw new Error("OpenAICompatibleEmbeddingProvider: fetch not available");
    const resp = await f(`${this.opts.baseUrl.replace(/\/$/, "")}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify({ model: this.opts.model, input: reqs.map((r) => r.text) }),
    });
    if (!resp.ok) {
      throw new Error(`Embedding API ${resp.status}: ${await resp.text()}`);
    }
    const data = (await resp.json()) as { data: Array<{ embedding: number[]; index: number }> };
    return reqs.map((r, i) => {
      const found = data.data.find((d) => d.index === i);
      return {
        id: r.id ?? `${this.opts.idPrefix}_${i}`,
        vector: found?.embedding ?? [],
        dim: found?.embedding.length ?? 0,
        model: this.opts.model,
      };
    });
  }

  cosine(a: number[], b: number[]): number {
    return cosine(a, b);
  }
}

const defaultFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);
