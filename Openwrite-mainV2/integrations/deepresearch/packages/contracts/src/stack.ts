import type { KgService } from "./knowledge.js";
import type { MemoryGraph } from "./memory-graph.js";
import type { LlmChat, EmbeddingService, SearchProvider, FetchProvider } from "./providers.js";
import type { ReporterService } from "./reporter.js";
import type { TaskLedger } from "./task.js";

export interface EpisodeStack {
  kg: KgService;
  ledger: TaskLedger;
  memory: MemoryGraph;
  reporter: ReporterService;
  llm: LlmChat;
  /** Optional independent model used for semantic publication review. */
  reviewLlm?: LlmChat;
  embedding?: EmbeddingService;
  search?: SearchProvider;
  fetch?: FetchProvider;
}
