import type { ExpectedArtifact, ResearchContext, TaskSubmission } from "@deepresearch/contracts";

export interface ParseInput extends TaskSubmission {
  episodeId?: string;
  expectedArtifacts?: ExpectedArtifact[];
}

export interface IntentParser {
  parse(input: ParseInput): Promise<ResearchContext>;
}

export interface IntentParserOptions {
  now?: () => number;
  defaultArtifacts?: ExpectedArtifact[];
}

export interface StoredContext extends ResearchContext {
  storedAt: string;
}

let seq = 0;

export function buildResearchContext(input: ParseInput, opts: IntentParserOptions = {}): ResearchContext {
  const now = opts.now ?? Date.now;
  const episodeId = input.episodeId ?? generateEpisodeId(now);
  return {
    episodeId,
    sessionId: input.sessionId,
    userInput: input.userInput,
    expectedArtifacts: input.expectedArtifacts ?? opts.defaultArtifacts ?? ["report", "evidence_index"],
  };
}

function generateEpisodeId(now: () => number): string {
  seq += 1;
  const day = new Date(now()).toISOString().slice(0, 10).replace(/-/g, "");
  return `EP_${day}_${String(seq).padStart(3, "0")}`;
}
