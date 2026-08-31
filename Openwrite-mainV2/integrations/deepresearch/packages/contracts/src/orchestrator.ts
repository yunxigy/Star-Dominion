import type { TaskSubmission, RuntimeProfile, EpisodeResult } from "./context.js";

export interface OrchestratorOptions {
  /** Stable caller-provided identity for a new episode. Must be safe as one path segment. */
  episodeId?: string;
  runtimeProfile?: RuntimeProfile;
  benchmarkArtifacts?: string[];
}

export interface Orchestrator {
  runEpisode(submission: TaskSubmission, opts?: OrchestratorOptions): Promise<EpisodeResult>;
}
