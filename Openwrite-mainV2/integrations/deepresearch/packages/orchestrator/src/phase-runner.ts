import type { MemoryEvent, TaskSubmission } from "@deepresearch/contracts";
import { loadDefaultRuntimeProfile, mergeRuntimeProfile } from "./infra/config.js";
import { eventIdForEpisode } from "./infra/ids.js";
import { createDefaultStack, createRunState } from "./run-state.js";
import type { PhaseContext, V5OrchestratorOptions } from "./types.js";

export function createPhaseContext(submission: TaskSubmission, opts: V5OrchestratorOptions): PhaseContext {
  const now = opts.now ?? Date.now;
  const baseProfile = opts.runtimeProfile ?? loadDefaultRuntimeProfile();
  const runtimeProfile = mergeRuntimeProfile(baseProfile, opts.runtimeProfile);
  if (opts.artifactDir) runtimeProfile.artifactDir = opts.artifactDir;
  const state = createRunState(submission, runtimeProfile, now, opts.episodeId);
  const stack = createDefaultStack(opts);
  return {
    state,
    stack,
    now,
    signal: opts.signal,
    async emit(event: Omit<MemoryEvent, "eventId" | "episodeId" | "timestamp"> & { episodeId?: string; timestamp?: string }): Promise<void> {
      throwIfAborted(opts.signal);
      state.eventSequence += 1;
      const episodeId = event.episodeId ?? state.episodeId;
      const fullEvent = {
        eventId: eventIdForEpisode(episodeId, state.eventSequence),
        episodeId,
        timestamp: event.timestamp ?? new Date(now()).toISOString(),
        ...event,
      };
      await stack.memory.appendEvent(fullEvent);
      await opts.onEvent?.(fullEvent);
    },
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  throw new Error(typeof reason === "string" ? reason : "Research run aborted");
}
