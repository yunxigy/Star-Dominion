import type { MemoryEvent, MemoryEventType, MemoryGraph } from "@deepresearch/contracts";
import { validateMemoryEvent } from "../types.js";

export class InMemoryMemoryGraph implements MemoryGraph {
  private readonly events: MemoryEvent[] = [];

  constructor(opts: { initial?: MemoryEvent[] } = {}) {
    for (const event of opts.initial ?? []) {
      validateMemoryEvent(event);
      this.events.push(structuredClone(event));
    }
  }

  async appendEvent(event: MemoryEvent): Promise<void> {
    validateMemoryEvent(event);
    this.events.push(structuredClone(event));
  }

  async listEvents(opts: {
    episodeId?: string;
    taskId?: string;
    reportNodeId?: string;
    branchId?: string;
    eventType?: MemoryEventType;
    limit?: number;
  } = {}): Promise<MemoryEvent[]> {
    const filtered = this.events
      .filter((event) => !opts.episodeId || event.episodeId === opts.episodeId)
      .filter((event) => !opts.taskId || event.taskId === opts.taskId)
      .filter((event) => !opts.reportNodeId || event.reportNodeId === opts.reportNodeId)
      .filter((event) => !opts.branchId || event.branchId === opts.branchId)
      .filter((event) => !opts.eventType || event.eventType === opts.eventType)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return filtered.slice(0, opts.limit ?? filtered.length).map((event) => structuredClone(event));
  }

  async exportJsonl(episodeId: string): Promise<string> {
    const events = await this.listEvents({ episodeId });
    return events.map((event) => JSON.stringify(event)).join("\n");
  }

  snapshot(): MemoryEvent[] {
    return this.events.map((event) => structuredClone(event));
  }
}
