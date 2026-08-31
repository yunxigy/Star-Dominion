import type { EpisodeStack, LlmChat } from "@deepresearch/contracts";
import type { IntentParser } from "@deepresearch/intent-analyzer";
import { createIntentParserImpl, createIntentParserMock } from "@deepresearch/intent-analyzer";
import { createInMemoryTaskLedger } from "@deepresearch/task-ledger";
import { createFixtureKgService, createInMemoryKgService } from "@deepresearch/knowledge-graph";
import { createInMemoryMemoryGraph } from "@deepresearch/memory-graph";
import { createInMemoryReporter } from "@deepresearch/report-evaluator";

export interface MockStack extends EpisodeStack {
  parser: IntentParser;
}

export interface MockStackOptions {
  seed?: number;
}

const testLlm: LlmChat = {
  name: "testing-echo-llm",
  async chat(req) {
    return { content: req.json ? "{}" : req.user };
  },
};

export function newMockStack(opts: MockStackOptions = {}): MockStack {
  const seed = opts.seed ?? 42;
  return {
    parser: createIntentParserMock(),
    ledger: createInMemoryTaskLedger({ seed }),
    kg: createFixtureKgService({ seed }),
    memory: createInMemoryMemoryGraph(),
    reporter: createInMemoryReporter(),
    llm: testLlm,
  };
}

export function newInMemoryStack(_opts: MockStackOptions = {}): MockStack {
  return {
    parser: createIntentParserImpl({ kind: "in-memory" }),
    ledger: createInMemoryTaskLedger(),
    kg: createInMemoryKgService(),
    memory: createInMemoryMemoryGraph(),
    reporter: createInMemoryReporter(),
    llm: testLlm,
  };
}
