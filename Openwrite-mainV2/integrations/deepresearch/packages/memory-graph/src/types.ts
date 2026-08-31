import { ValidationError, type MemoryEvent } from "@deepresearch/contracts";

export interface MemoryGraphFactoryOptions {
  seed?: number;
  initial?: MemoryEvent[];
}

export function validateMemoryEvent(event: MemoryEvent): void {
  if (!event.eventId) throw new ValidationError("MemoryEvent.eventId is required", "eventId");
  if (!event.eventType) throw new ValidationError("MemoryEvent.eventType is required", "eventType");
  if (!event.episodeId) throw new ValidationError("MemoryEvent.episodeId is required", "episodeId");
  if (!event.timestamp) throw new ValidationError("MemoryEvent.timestamp is required", "timestamp");
}
