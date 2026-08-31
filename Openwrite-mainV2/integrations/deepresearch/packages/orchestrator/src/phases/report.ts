import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReportArtifact, ReportBundle } from "@deepresearch/contracts";
import { isExplicitTestLlm, parseLlmJson } from "../infra/ai.js";
import { REPORT_WRITER_SYSTEM_PROMPT } from "../prompts.js";
import { traceWrite, tracedLlmChat } from "../trace.js";
import type { PhaseContext } from "../types.js";
import {
  buildLeafFirstPlan,
  compactBundle,
  formatCitationList,
  isReportableEntry,
  limitReportPrompt,
  readerFacingRequirements,
  reportContextBudget,
  writerConstraints,
} from "./report-bundle.js";
import {
  acceptFinalizedReport,
  detectMissingRenderedDeliverables,
  detectRenderedTopLevelSectionCountIssue,
  requestedTopLevelSectionCount,
  requestedTopLevelSectionNames,
} from "./report-headings.js";
import { completeProvableLocalCitations, propagateLeadCitationsToQuantitativeListItems } from "./report-assembly.js";
import { generateLeafFirstLlmReport, runWriterDraftAgent } from "./report-writer.js";

export {
  acceptFinalizedReport,
  detectMissingRenderedDeliverables,
  detectRenderedTopLevelSectionCountIssue,
  requestedTopLevelSectionCount,
  requestedTopLevelSectionNames,
  type MissingRenderedDeliverable,
  type RenderedTopLevelSectionCountIssue,
} from "./report-headings.js";
export { relatedSupplementalEvidence } from "./report-bundle.js";
export {
  assembleLeafFirstReport,
  completeProvableLocalCitations,
  mergeSynthesisConclusionIntoFinalSection,
  normalizeDuplicateLocalCitations,
  propagateLeadCitationsToQuantitativeListItems,
  stripStandaloneLeafCoverageNotes,
} from "./report-assembly.js";

export async function reportPhase(ctx: PhaseContext): Promise<{ bundle: ReportBundle; artifact: ReportArtifact; draftPath: string; citationMapPath: string; diagnosticsPath: string }> {
  const rubric = ctx.state.globalRubric;
  if (!rubric) throw new Error("rubric required before report");
  const bundle = await ctx.stack.kg.buildReportBundle(ctx.state.episodeId, "R_root", {
    language: rubric.outputHints.language ?? "zh-CN",
    citationRequired: rubric.outputHints.citationRequired ?? true,
    rubricId: rubric.rubricId,
    rubricText: rubric.rubricText,
    requirements: rubric.requirements,
    waivers: ctx.state.issueWaivers,
  });
  let artifact = isExplicitTestLlm(ctx.stack.llm.name)
    ? await ctx.stack.reporter.generate(bundle, {
        llm: ctx.state.runtimeProfile.llm.report,
        maxContextTokens: ctx.state.runtimeProfile.phases.report?.contextTokenLimit,
      })
    : await generateLlmReport(ctx, bundle);
  artifact = await organizeMissingDeliverables(ctx, bundle, artifact);
  artifact = {
    ...artifact,
    reportMd: completeProvableLocalCitations(
      propagateLeadCitationsToQuantitativeListItems(artifact.reportMd),
      bundle,
    ),
  };
  const dir = join(ctx.state.runtimeProfile.artifactDir, ctx.state.episodeId);
  await mkdir(dir, { recursive: true });
  const draftPath = join(dir, "report-draft.md");
  const citationMapPath = join(dir, "citation-map.json");
  const diagnosticsPath = join(dir, "grounding-diagnostics.json");
  await writeFile(draftPath, artifact.reportMd, "utf8");
  await traceWrite(ctx, "artifact", "writeFile", { path: draftPath, bytes: artifact.reportMd.length });
  await writeFile(citationMapPath, JSON.stringify(artifact.citationMap, null, 2), "utf8");
  await traceWrite(ctx, "artifact", "writeFile", { path: citationMapPath, citationCount: Object.keys(artifact.citationMap).length });
  await writeFile(diagnosticsPath, JSON.stringify(artifact.diagnostics, null, 2), "utf8");
  await traceWrite(ctx, "artifact", "writeFile", { path: diagnosticsPath, diagnostics: artifact.diagnostics });
  ctx.state.reportBundle = bundle;
  ctx.state.reportArtifact = artifact;
  await ctx.emit({ eventType: "report_draft_created", payload: { draftPath, citationMapPath, diagnosticsPath } });
  return { bundle, artifact, draftPath, citationMapPath, diagnosticsPath };
}

async function generateLlmReport(ctx: PhaseContext, bundle: ReportBundle): Promise<ReportArtifact> {
  const maxCalls = ctx.state.runtimeProfile.phases.report?.maxLlmCalls ?? 1;
  const plan = buildLeafFirstPlan(bundle);
  if (plan.leaves.length > 0 && maxCalls >= plan.requiredCalls) {
    return generateLeafFirstLlmReport(ctx, bundle, plan);
  }
  const nonPrunedHypotheses = bundle.tree.filter((entry) => entry.node.nodeKind === "hypothesis" && isReportableEntry(bundle, entry)).length;
  const expectedCharacters = Math.max(3000, Math.min(18000, nonPrunedHypotheses * 1200));
  const context = reportContextBudget(ctx);
  const response = await tracedLlmChat(ctx, "report.write", {
    system: REPORT_WRITER_SYSTEM_PROMPT,
    user: limitReportPrompt(`Write the final report from this ReportBundle.

Constraints:
${JSON.stringify(writerConstraints(bundle), null, 2)}

Report tree and evidence:
${JSON.stringify(compactBundle(bundle), null, 2)}

Available citations:
${formatCitationList(bundle)}

Depth requirements:
- Target at least ${expectedCharacters} Chinese characters when the output language is zh-CN, or comparable depth in other languages.
- Include a concise executive summary, a chronological or logical development route, one substantive section for every major aspect, and a synthesis section.
- Do not leave placeholders. If evidence is weak, downscope the claim to what the cited evidence actually supports instead of writing an evidence-gap disclaimer.
- Every evidence-dependent sentence, including executive-summary and conclusion sentences that repeat facts or numbers, must carry its supporting [C#] citation at that sentence.
- Explicitly satisfy every active priority=must structured requirement. A requirement with an omit waiver is intentionally out of scope; a downplay/accept_risk waiver keeps only its cited, verified subset and must state the concrete coverage boundary without claiming full completion. Do not print internal requirement IDs.
- Respect bundle.constraints.waivers exactly and never expose internal waiver records, framework dispositions, or user-review mechanics.

Return Markdown only. Use citations exactly as [C1], [C2], etc.`, context.maxPromptChars),
    json: false,
    ...ctx.state.runtimeProfile.llm.report,
  });
  const reportMd = response.content.trim();
  if (!reportMd) throw new Error("report phase expected Markdown from the LLM but received an empty payload");
  const citationMap: Record<string, string> = {};
  for (const item of bundle.globalEvidenceIndex) citationMap[item.citationId] = item.knowledgeNodeId;
  const diagnostics: ReportArtifact["diagnostics"] = [];
  if (bundle.globalEvidenceIndex.length === 0 && bundle.constraints.citationRequired) {
    diagnostics.push({ code: "no_evidence", severity: "warning", message: "Citation-required report has no evidence index." });
  }
  return {
    episodeId: bundle.episodeId,
    reportMd: reportMd.endsWith("\n") ? reportMd : `${reportMd}\n`,
    citationMap,
    evidenceIndex: bundle.globalEvidenceIndex,
    diagnostics,
    generatedAt: new Date(ctx.now()).toISOString(),
  };
}

async function organizeMissingDeliverables(
  ctx: PhaseContext,
  bundle: ReportBundle,
  artifact: ReportArtifact,
): Promise<ReportArtifact> {
  const missing = detectMissingRenderedDeliverables(bundle, artifact.reportMd);
  const sectionCountIssue = detectRenderedTopLevelSectionCountIssue(bundle, artifact.reportMd);
  if ((missing.length === 0 && !sectionCountIssue) || isExplicitTestLlm(ctx.stack.llm.name)) return artifact;
  const requestedSectionCount = requestedTopLevelSectionCount(bundle);
  const requestedSectionNames = requestedTopLevelSectionNames(bundle);
  const prompt = [
    "Organize the already assembled final report to render missing must-have deliverables.",
    "",
    "This is a formatting and requirement-completion pass only. Do not search, fetch sources, or add evidence.",
    "",
    "Structured requirements:",
    JSON.stringify(readerFacingRequirements(bundle), null, 2),
    "",
    "Missing rendered deliverables:",
    JSON.stringify(missing, null, 2),
    "",
    "Rendered top-level section-count issue:",
    JSON.stringify(sectionCountIssue ?? null, null, 2),
    "",
    "Available citation summaries:",
    formatCitationList(bundle),
    "",
    "Current complete report:",
    artifact.reportMd,
    "",
    "Rules:",
    "- Return the complete Markdown report, not a patch or commentary.",
    "- Preserve the existing title, executive summary, aspect sections, leaf detail, conclusion, and citations.",
    "- Add only the missing section/table/list required by the structured requirements, using evidence already present in the report and the citation summaries above.",
    "- When a missing item includes expectedTableCount, render that many separate Markdown table blocks inside the relevant section; a column count is not a table count.",
    requestedSectionCount !== undefined
      ? `- Preserve exactly ${requestedSectionCount} level-2 (##) main sections. Put any added table/list under the most relevant existing main section with a level-3 (###) heading; never add another level-2 section.`
      : "",
    requestedSectionNames
      ? `- Use these level-2 main-section names in this exact order: ${requestedSectionNames.join(" | ")}. Optional numeric prefixes are allowed; do not rename, reorder, merge, or replace them.`
      : "",
    "- Do not start new research and do not invent facts, numbers, dates, or citations.",
    "- For unsupported table cells write \"Not established by cited evidence\".",
    "- Use only citation IDs from the available summaries. Do not expose internal requirement IDs or repair mechanics.",
    "- Keep the report at least as substantive as the current report.",
  ].join("\n");
  let organized: string;
  try {
    organized = await runWriterDraftAgent(ctx, {
      phase: "report.organize",
      reportNodeId: bundle.root.nodeId,
      title: "FinalReportOrganizer",
      objective: "Repair rendered deliverables and exact main-section structure in the assembled report",
      language: bundle.constraints.language,
      prompt: limitReportPrompt(prompt, Math.max(12000, reportContextBudget(ctx).synthesisPromptChars + 4000)),
    });
  } catch (error) {
    await traceWrite(ctx, "writer", "organizerFallback", {
      missingDeliverableCount: missing.length,
      reason: error instanceof Error ? error.message : String(error),
    }, { reportNodeId: bundle.root.nodeId });
    return artifact;
  }
  const candidate = organized.trim();
  if (!acceptFinalizedReport(artifact.reportMd, candidate, bundle, missing)) return artifact;
  return {
    ...artifact,
    reportMd: candidate.endsWith("\n") ? candidate : candidate + "\n",
  };
}
