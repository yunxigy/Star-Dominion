import type { ResearchContext } from "@deepresearch/contracts";
import { generateEpisodeId, isoNow } from "../infra/ids.js";
import type { PhaseContext } from "../types.js";

export async function parsePhase(ctx: PhaseContext): Promise<ResearchContext> {
  const episodeId = ctx.state.episodeId || generateEpisodeId(ctx.now);
  ctx.state.episodeId = episodeId;
  const researchContext: ResearchContext = {
    episodeId,
    sessionId: ctx.state.submission.sessionId,
    userInput: ctx.state.submission.userInput,
    expectedArtifacts: ctx.state.runtimeProfile.includeEvidenceIndex
      ? ["report", "evidence_index", "evidence_quality_audit", "budget_audit", "trace"]
      : ["report", "evidence_quality_audit", "budget_audit", "trace"],
  };
  await ctx.emit({
    eventType: "episode_started",
    payload: {
      sessionId: researchContext.sessionId,
      runtimeProfileKeys: Object.keys(ctx.state.runtimeProfile),
      startedAt: isoNow(ctx.now),
    },
  });
  return researchContext;
}
