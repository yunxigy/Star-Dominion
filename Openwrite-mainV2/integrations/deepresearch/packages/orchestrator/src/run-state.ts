import type { EpisodeStack, RuntimeProfile, TaskSubmission } from "@deepresearch/contracts";
import { createInMemoryKgService } from "@deepresearch/knowledge-graph";
import { createInMemoryMemoryGraph } from "@deepresearch/memory-graph";
import { createInMemoryTaskLedger } from "@deepresearch/task-ledger";
import { MarkdownReporter } from "./reporter.js";
import { validateEpisodeId } from "./infra/ids.js";
import type { EpisodeRunState, V5OrchestratorOptions } from "./types.js";

export function createRunState(
  submission: TaskSubmission,
  runtimeProfile: RuntimeProfile,
  now: () => number,
  episodeId?: string,
): EpisodeRunState {
  return {
    submission,
    runtimeProfile,
    episodeId: episodeId ? validateEpisodeId(episodeId) : "",
    startedAt: new Date(now()).toISOString(),
    agentResults: [],
    fetchCache: new Map(),
    sourceGuards: [],
    eventSequence: 0,
    issueWaivers: [],
    budgetUsage: {},
    budgetBreaches: [],
    cycleGains: [],
  };
}

export function createDefaultStack(opts: V5OrchestratorOptions): Required<Pick<EpisodeStack, "kg" | "ledger" | "memory" | "reporter" | "llm">> & Partial<EpisodeStack> {
  const llm = opts.llm ?? opts.stack?.llm;
  if (!llm) {
    throw new Error("A real LLM provider is required. Pass opts.llm or opts.stack.llm; use EchoJsonLlm only in explicit tests/local smoke runs.");
  }
  return {
    kg: opts.stack?.kg ?? createInMemoryKgService(),
    ledger: opts.stack?.ledger ?? createInMemoryTaskLedger(),
    memory: opts.stack?.memory ?? createInMemoryMemoryGraph(),
    reporter: opts.stack?.reporter ?? new MarkdownReporter(),
    llm,
    reviewLlm: opts.reviewLlm ?? opts.stack?.reviewLlm,
    embedding: opts.stack?.embedding,
    search: opts.search ?? opts.stack?.search,
    fetch: opts.fetch ?? opts.stack?.fetch,
  };
}
