export interface EmbeddingVector {
  id: string;
  vector: number[];
  dim: number;
  model: string;
}

export interface EmbeddingRequest {
  text: string;
  kind?: "knowledge" | "query" | "rubric" | "branch_summary";
  id?: string;
}

export interface EmbeddingService {
  readonly name: string;
  readonly dim: number;
  embed(req: EmbeddingRequest): Promise<EmbeddingVector>;
  embedBatch(reqs: EmbeddingRequest[]): Promise<EmbeddingVector[]>;
  cosine(a: number[], b: number[]): number;
}

export interface LlmChatRequest {
  system?: string;
  user: string;
  json?: boolean;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface LlmChatResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  reasoning?: string;
}

export interface LlmChat {
  readonly name: string;
  chat(req: LlmChatRequest): Promise<LlmChatResponse>;
}

export interface SearchProvider {
  readonly name: string;
  search(query: string, topK: number, opts?: { signal?: AbortSignal }): Promise<Array<{
    url: string;
    title: string;
    snippet: string;
  }>>;
}

export interface FetchProvider {
  readonly name: string;
  fetchPage(url: string, opts?: { timeoutMs?: number; maxChars?: number; focusTerms?: string[]; signal?: AbortSignal }): Promise<{
    url: string;
    title: string;
    content: string;
    description?: string;
  }>;
}
