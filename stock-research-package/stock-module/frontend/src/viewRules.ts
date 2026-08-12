import type { CandidateEvidence } from "./types";

export const CATALYST_SCORE_THRESHOLD = 55;

export function filterCatalystCandidates(items: CandidateEvidence[]): CandidateEvidence[] {
  return items.filter((item) => item.total_score > CATALYST_SCORE_THRESHOLD);
}

export function isAuthenticatedResponse(status: number): boolean {
  return status >= 200 && status < 300;
}
