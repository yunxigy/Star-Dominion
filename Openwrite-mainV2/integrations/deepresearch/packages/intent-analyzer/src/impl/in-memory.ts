import type { ResearchContext } from "@deepresearch/contracts";
import { buildResearchContext, type IntentParser, type IntentParserOptions, type ParseInput, type StoredContext } from "../types.js";

export interface InMemoryIntentParserOptions extends IntentParserOptions {
  snapshot?: StoredContext[];
}

export class InMemoryIntentParser implements IntentParser {
  private readonly contexts = new Map<string, StoredContext>();
  private readonly opts: IntentParserOptions;

  constructor(opts: InMemoryIntentParserOptions = {}) {
    this.opts = opts;
    for (const context of opts.snapshot ?? []) this.contexts.set(context.episodeId, structuredClone(context));
  }

  async parse(input: ParseInput): Promise<ResearchContext> {
    const ctx = buildResearchContext(input, this.opts);
    this.contexts.set(ctx.episodeId, { ...structuredClone(ctx), storedAt: new Date(this.opts.now?.() ?? Date.now()).toISOString() });
    return ctx;
  }

  snapshot(): StoredContext[] {
    return Array.from(this.contexts.values()).map((context) => structuredClone(context));
  }
}
