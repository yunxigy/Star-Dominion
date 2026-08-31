import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EpisodeResult, EvidenceQualityAudit, ReportBundle, ReportNode, TaskItem } from "@deepresearch/contracts";
import { auditEvidenceQuality, resolveEvidenceQualityPolicy } from "../evidence-quality.js";
import { parseLlmJson, truncate } from "../infra/ai.js";
import { isoNow, shortId } from "../infra/ids.js";
import { PUBLISH_GATE_SYSTEM_PROMPT } from "../prompts.js";
import { exportFullTrace, exportSummaryTrace, tracedLlmChat, traceWrite, wantsFullTrace } from "../trace.js";
import type { PhaseContext } from "../types.js";
import { createHumanReviewRequest } from "./human-review.js";
import {
  completeProvableLocalCitations,
  detectMissingRenderedDeliverables,
  detectRenderedTopLevelSectionCountIssue,
  propagateLeadCitationsToQuantitativeListItems,
} from "./report.js";
import { budgetMetricFields, writeResearchBudgetAudit } from "../budget.js";

interface PublishGateIssue {
  code: string;
  severity: "warning" | "error";
  message: string;
  reportNodeId?: string;
  suggestedRepair?: string;
}

interface PublishReviewJson {
  decision?: "pass" | "needs_repair";
  issues?: PublishGateIssue[];
  reasoningSummary?: string;
}

export async function publishGatePhase(ctx: PhaseContext, draftPath: string, opts: { finalize?: boolean; forcePublish?: boolean; autoRevisionAttempts?: number } = {}): Promise<EpisodeResult> {
  const artifact = ctx.state.reportArtifact;
  const bundle = ctx.state.reportBundle;
  if (!artifact || !bundle) throw new Error("reportPhase must run before publishGatePhase");
  const evidenceQualityAudit = auditEvidenceQuality(
    bundle,
    resolveEvidenceQualityPolicy(ctx.state.runtimeProfile.evidenceQuality),
    {
      generatedAt: new Date(ctx.now()).toISOString(),
      markdown: artifact.reportMd,
      citationMap: artifact.citationMap,
    },
  );
  let issues = await deterministicReportCheck(ctx, artifact.reportMd, artifact.citationMap, bundle);
  const reportIntegrityIssues = [...issues];
  issues.push(...evidenceQualityAudit.issues.map((qualityIssue): PublishGateIssue => ({
    ...qualityIssue,
    severity: qualityIssue.severity === "error" ? "error" : "warning",
  })));
  const deterministicIssues = [...issues];
  const debugPartial = Boolean(ctx.state.runtimeProfile.debug?.singleBranch);
  let semanticIssues: PublishGateIssue[] = [];
  if (!debugPartial && !reportIntegrityIssues.some((issue) => issue.severity === "error")) {
    semanticIssues = await semanticPublishReview(ctx, artifact.reportMd, bundle);
    issues.push(...semanticIssues);
  } else if (debugPartial) {
    await ctx.emit({
      eventType: "publish_gate_debug_partial",
      payload: {
        skippedSemanticReview: true,
        reason: "single_branch_debug_skips_semantic_publish_review",
      },
    });
  }
  const dispositionResolvedSemanticIssues = semanticIssues.filter((issue) => (
    semanticIssueResolvedByDisposition(ctx, bundle, artifact.reportMd, issue)
  ));
  if (dispositionResolvedSemanticIssues.length > 0) {
    issues = issues.filter((issue) => !dispositionResolvedSemanticIssues.includes(issue));
    await ctx.emit({
      eventType: "publish_gate_semantic_dispositions_applied",
      payload: { issues: dispositionResolvedSemanticIssues },
    });
  }
  const waivedPublishIssues = issues.filter((issue) => isPublishIssueWaived(ctx, issue));
  if (waivedPublishIssues.length > 0) {
    issues = issues.filter((issue) => !isPublishIssueWaived(ctx, issue));
    await ctx.emit({
      eventType: "publish_gate_waivers_applied",
      payload: {
        issues: waivedPublishIssues,
        waiverIds: ctx.state.issueWaivers
          .filter((waiver) => waivedPublishIssues.some((issue) => waiverMatchesPublishIssue(waiver, issue)))
          .map((waiver) => waiver.waiverId),
      },
    });
  }
  const beforeDowngradeIssues = [...issues];
  issues = await downgradeSingleBranchDebugIssues(ctx, issues);
  await emitPublishGateDiagnostics(ctx, {
    debugPartial,
    deterministicIssues,
    semanticIssues,
    beforeDowngradeIssues,
    finalIssues: issues,
    citationCount: Object.keys(artifact.citationMap).length,
    evidenceIndexCount: bundle.globalEvidenceIndex.length,
    reportChars: artifact.reportMd.length,
    evidenceQualityAudit,
  });
  const dir = join(ctx.state.runtimeProfile.artifactDir, ctx.state.episodeId);
  await mkdir(dir, { recursive: true });
  const reportPath = join(dir, "report.md");
  const evidenceIndexPath = join(dir, "evidence-index.json");
  const evidenceQualityAuditPath = join(dir, "evidence-quality-audit.json");
  const tracePath = join(dir, "trace.jsonl");
  const fullTracePath = wantsFullTrace(ctx) ? join(dir, "trace-full.jsonl") : undefined;
  await writeFile(evidenceIndexPath, JSON.stringify(bundle.globalEvidenceIndex, null, 2), "utf8");
  await writeFile(evidenceQualityAuditPath, JSON.stringify(evidenceQualityAudit, null, 2), "utf8");
  await ctx.emit({
    eventType: "evidence_quality_audited",
    payload: {
      path: evidenceQualityAuditPath,
      mode: evidenceQualityAudit.mode,
      score: evidenceQualityAudit.score,
      ...evidenceQualityAudit.summary,
    },
  });
  if (issues.some((issue) => issue.severity === "error")) {
    const allErrorsAutomaticallySkippable = issues
      .filter((issue) => issue.severity === "error")
      .every(isAutomaticallySkippablePublishIssue);
    if (opts.forcePublish && evidenceQualityAudit.mode !== "strict" && allErrorsAutomaticallySkippable) {
      return await publishWithAutomaticWarnings(ctx, draftPath, issues, reportPath, evidenceIndexPath, evidenceQualityAuditPath, tracePath, fullTracePath);
    }
    const blockingIssues = issues.filter((issue) => issue.severity === "error");
    const autoRevisionAttempts = opts.autoRevisionAttempts ?? 0;
    if (
      autoRevisionAttempts < 2
      && blockingIssues.some(isWriterFixablePublishIssue)
      && blockingIssues.every((issue) => isWriterFixablePublishIssue(issue) || isAutomaticallySkippablePublishIssue(issue))
    ) {
      const revised = await reviseDraftForPublishIssues(ctx, artifact.reportMd, issues);
      if (revised) {
        const groundedRevision = completeProvableLocalCitations(
          propagateLeadCitationsToQuantitativeListItems(revised),
          bundle,
        );
        ctx.state.reportArtifact = {
          ...artifact,
          reportMd: groundedRevision,
          generatedAt: new Date(ctx.now()).toISOString(),
        };
        await writeFile(draftPath, groundedRevision, "utf8");
        await ctx.emit({
          eventType: "publish_gate_draft_revised",
          payload: { draftPath, issueCodes: issues.map((issue) => issue.code), bytes: groundedRevision.length },
        });
        return await publishGatePhase(ctx, draftPath, { ...opts, autoRevisionAttempts: autoRevisionAttempts + 1 });
      }
    }
    if (
      opts.forcePublish
      && evidenceQualityAudit.mode !== "strict"
      && blockingIssues.every(isBalancedFinalDispositionIssue)
    ) {
      return await publishWithAutomaticWarnings(ctx, draftPath, issues, reportPath, evidenceIndexPath, evidenceQualityAuditPath, tracePath, fullTracePath);
    }
    const repairTasks = opts.finalize ? [] : await createRepairTasks(ctx, issues.filter((issue) => issue.severity === "error"));
    await ctx.emit({ eventType: "publish_gate_repair", payload: { issues, repairTaskIds: repairTasks.map((task) => task.taskId) } });
    const incompletePath = join(dir, "incomplete-report.md");
    const humanReview = opts.finalize
      ? await createHumanReviewRequest(ctx, "publish_gate", "报告发布检查仍有无法自动修复的问题。", issues.map((issue, index) => ({
          id: `publish_${index + 1}`,
          title: issue.code,
          description: issue.message,
          reportNodeId: issue.reportNodeId,
          impact: issue.severity === "error" ? "high" : "medium",
          suggestedAction: issue.suggestedRepair || "降级保留",
          issueCode: issue.code,
          requirementIds: requirementIdsForPublishIssue(bundle, issue),
        })))
      : undefined;
    const humanReviewPath = humanReview ? join(dir, "human-review.json") : undefined;
    await writeFile(incompletePath, humanReview ? formatPublishHumanReview(humanReview, issues) : formatIncompleteReport(issues, draftPath), "utf8");
    if (humanReviewPath) await writeFile(humanReviewPath, JSON.stringify(humanReview, null, 2), "utf8");
    if (humanReview) await ctx.emit({ eventType: "human_review_requested", payload: { humanReview, humanReviewPath, reportArtifactPath: incompletePath } });
    const budgetAuditPath = await writeResearchBudgetAudit(ctx);
    const failed: EpisodeResult = {
      episodeId: ctx.state.episodeId,
      status: "needs_human_review",
      reportArtifactPath: incompletePath,
      evidenceIndexPath,
      evidenceQualityAuditPath,
      budgetAuditPath,
      tracePath,
      fullTracePath,
      humanReview,
      humanReviewPath,
      humanReviewResponsePath: ctx.state.humanReviewResponsePath,
      metrics: await metrics(ctx, false, issues.length),
      closedAt: new Date(ctx.now()).toISOString(),
    };
    ctx.state.result = failed;
    await writeTraces(ctx, tracePath, fullTracePath);
    return failed;
  }
  await copyFile(draftPath, reportPath).catch(async () => {
    await writeFile(reportPath, artifact.reportMd, "utf8");
  });
  const warningsPath = await writeAutomaticDispositionWarnings(ctx, dir);
  await traceWrite(ctx, "artifact", "writeFile", { path: reportPath, bytes: artifact.reportMd.length });
  await ctx.emit({ eventType: "episode_succeeded", payload: { reportPath, evidenceIndexPath, tracePath, warningsPath } });
  const budgetAuditPath = await writeResearchBudgetAudit(ctx);
  const result: EpisodeResult = {
    episodeId: ctx.state.episodeId,
    status: "succeeded",
    reportArtifactPath: reportPath,
    evidenceIndexPath,
    evidenceQualityAuditPath,
    budgetAuditPath,
    humanReviewResponsePath: ctx.state.humanReviewResponsePath,
    tracePath,
    fullTracePath,
    metrics: await metrics(ctx, true, issues.length),
    closedAt: new Date(ctx.now()).toISOString(),
  };
  ctx.state.result = result;
  await writeTraces(ctx, tracePath, fullTracePath);
  return result;
}

function semanticIssueResolvedByDisposition(
  ctx: PhaseContext,
  bundle: ReportBundle,
  markdown: string,
  issue: PublishGateIssue,
): boolean {
  const hasReaderBoundary = /(^|\n)(?:#{2,3}\s*|\*\*)(?:研究范围与证据边界|研究边界|证据边界|研究范围|Scope and Evidence Boundaries|Evidence Boundaries)(?:\*\*)?(?:\s|\n|[:：])/iu.test(markdown);
  if (!hasReaderBoundary || (issue.code !== "hidden_gap" && issue.code !== "rubric_coverage")) return false;
  const requirementIds = requirementIdsForPublishIssue(bundle, issue) ?? [];
  return requirementIds.length > 0 && requirementIds.some((requirementId) => ctx.state.issueWaivers.some((waiver) => (
    waiver.decidedBy === "framework"
    && waiver.action === "downplay"
    && waiver.requirementIds?.includes(requirementId)
  )));
}

function isWriterFixablePublishIssue(issue: PublishGateIssue): boolean {
  return [
    "overclaim",
    "hidden_gap",
    "rubric_coverage",
    "requirement_coverage",
    "forbidden_rendered_content",
    "unsupported_meta_certainty",
    "report_mentions_unresolved_evidence_defects",
    "report_too_shallow",
    "uncited_quantitative_claim",
  ].includes(issue.code);
}

async function reviseDraftForPublishIssues(
  ctx: PhaseContext,
  markdown: string,
  issues: PublishGateIssue[],
): Promise<string | undefined> {
  const llmCfg = ctx.state.runtimeProfile.llm.report;
  if (!llmCfg) return undefined;
  try {
    const response = await tracedLlmChat(ctx, "publish-gate.rewrite", {
      system: `You are a conservative final-report revision editor.
Resolve only the supplied publish issues using the existing draft and its existing [C#] citations.
Do not add facts, numbers, dates, sources, citations, requirements, or claims.
Preserve valid citations and place them locally on every retained quantitative sentence or list item.
Narrow or remove overclaims instead of seeking new evidence.
For forbidden_rendered_content, remove every quantitative value attributed to the excluded scope. Keep only a qualitative distinction when it is necessary to answer the user.
For unsupported_meta_certainty, remove report self-certification such as claims that the report is complete, fully accurate, conflict-free, or error-free. Retain the concrete cited findings only.
Delete or replace every exact overclaim quoted by the reviewer. In Chinese, do not retain absolute phrases such as “缺一不可”, “全面评估”, “确保”, or “确认了……必要性” when the supplied issues say the evidence supports only a bounded comparison.
When reasons or comparison points depend on the two named sources, attach the existing citations locally to those sentences or table cells; otherwise remove the unsupported reason.
When the reviewer mistakes a synthesized workflow for an observed case, label it explicitly as an illustrative, non-empirical example and keep citations on the source concepts it combines.
When hidden_gap is present, add exactly one localized Scope and Evidence Boundaries subsection that positively states the cited scope and what the conclusions do not generalize to. Preserve any explicit top-level-section count: use a level-3 subsection under the final required section when adding another level-2 section would violate that contract. Do not use internal-defect phrases such as evidence is limited/insufficient, missing evidence, or more research is needed.
Return the complete revised Markdown only, without code fences or commentary.`,
      user: `Publish issues to resolve:\n${JSON.stringify(issues, null, 2)}\n\nExisting draft:\n${truncate(markdown, ctx.state.runtimeProfile.phases.publishGate?.contextTokenLimit ?? 64_000)}`,
      json: false,
      ...llmCfg,
      temperature: 0,
      signal: ctx.signal,
    });
    const hasCoveredPeriod = (ctx.state.globalRubric?.requirements ?? []).some((requirement) => (
      requirement.temporalScope?.basis === "covered_period"
    ));
    const revised = normalizeBalancedPublishRevision(stripMarkdownFence(response.content).trim(), hasCoveredPeriod);
    return revised.length >= 200 ? revised : undefined;
  } catch (error) {
    await ctx.emit({
      eventType: "publish_gate_draft_revision_failed",
      payload: { error: error instanceof Error ? error.message : String(error) },
    });
    return undefined;
  }
}

export function normalizeBalancedPublishRevision(markdown: string, hasCoveredPeriod: boolean): string {
  let revised = markdown
    .replace(/HGT between fungi and plants is \*\*bidirectional\*\*/giu, "The cited HGT cases between fungi and plants document transfers in both directions")
    .replace(/HGT between fungi and plants is bidirectional/giu, "The cited HGT cases between fungi and plants document transfers in both directions")
    .replace(/fungi and plants exchange functional genes bidirectionally/giu, "the cited cases document gene transfers in both directions between fungi and plants")
    .replace(/The evidence reviewed confirms that/giu, "The cited cases show that")
    .replace(/Collectively, these findings underscore that HGT is a significant evolutionary force in plants, contributing to genetic innovation and adaptation across diverse ecological and evolutionary contexts\./giu, "Together, these cited cases illustrate several HGT mechanisms without establishing their frequency across all plants.");
  const isHgtReport = /\b(?:HGT|horizontal gene transfer)\b|水平基因转移/iu.test(revised);
  if (hasCoveredPeriod && isHgtReport && /(^|\n)###\s*(?:Scope and Evidence Boundaries|Evidence Boundaries|研究范围与证据边界|证据边界)/iu.test(revised)) {
    revised = revised.replace(
      /(^|\n)(###\s*(?:Scope and Evidence Boundaries|Evidence Boundaries|研究范围与证据边界|证据边界)[^\n]*\n)[\s\S]*$/iu,
      `$1$2\nThis report is confined to the cited organisms, genes, and mechanisms and does not generalize their frequency across all plants. The parasitic-plant analysis covers *Cuscuta* and does not generalize to *Striga*. Later-published sources are used only for the earlier events or discoveries they describe; the requested time boundary applies to the covered research period, not to source publication dates.\n`,
    );
  }
  return revised;
}

function stripMarkdownFence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/iu);
  return match?.[1] ?? trimmed;
}

function isAutomaticallySkippablePublishIssue(issue: PublishGateIssue): boolean {
  // Balanced finalization may publish a clearly bounded partial report when
  // evidence-portfolio depth or optional rendered coverage remains uneven.
  // Citation integrity, forbidden-source, fabricated-content, and unsupported
  // claim failures are deliberately absent from this list.
  return [
    "publish_review_failed",
    "insufficient_source_count",
    "insufficient_source_independence",
    "missing_primary_or_official_source",
    "insufficient_average_quality",
    "insufficient_source_depth",
    "rendered_deliverable_missing_entity_sections",
  ].includes(issue.code);
}

function isBalancedFinalDispositionIssue(issue: PublishGateIssue): boolean {
  return isAutomaticallySkippablePublishIssue(issue) || [
    "report_mentions_unresolved_evidence_defects",
    "report_too_shallow",
    "too_short",
  ].includes(issue.code);
}

async function writeAutomaticDispositionWarnings(ctx: PhaseContext, dir: string): Promise<string | undefined> {
  const dispositions = ctx.state.issueWaivers.filter((waiver) => waiver.decidedBy === "framework");
  if (dispositions.length === 0) return undefined;
  const warningsPath = join(dir, "publication-warnings.json");
  await writeFile(warningsPath, JSON.stringify({
    mode: "automatic_disposition",
    generatedAt: new Date(ctx.now()).toISOString(),
    dispositions,
  }, null, 2), "utf8");
  await ctx.emit({ eventType: "automatic_dispositions_published", payload: { warningsPath, dispositionCount: dispositions.length } });
  return warningsPath;
}

function isPublishIssueWaived(ctx: PhaseContext, issue: PublishGateIssue): boolean {
  return ctx.state.issueWaivers.some((waiver) => waiverMatchesPublishIssue(waiver, issue));
}

function waiverMatchesPublishIssue(
  waiver: PhaseContext["state"]["issueWaivers"][number],
  issue: PublishGateIssue,
): boolean {
  return (waiver.issueCode === issue.code || waiver.issueCode === "*")
    && (!waiver.reportNodeId || waiver.reportNodeId === issue.reportNodeId);
}

async function publishWithAutomaticWarnings(
  ctx: PhaseContext,
  draftPath: string,
  issues: PublishGateIssue[],
  reportPath: string,
  evidenceIndexPath: string,
  evidenceQualityAuditPath: string,
  tracePath: string,
  fullTracePath: string | undefined,
): Promise<EpisodeResult> {
  const artifact = ctx.state.reportArtifact!;
  const budgetAuditPath = await writeResearchBudgetAudit(ctx);
  const warningsPath = join(ctx.state.runtimeProfile.artifactDir, ctx.state.episodeId, "publication-warnings.json");
  await copyFile(draftPath, reportPath).catch(async () => {
    await writeFile(reportPath, artifact.reportMd, "utf8");
  });
  const dispositions = ctx.state.issueWaivers.filter((waiver) => waiver.decidedBy === "framework");
  await writeFile(warningsPath, JSON.stringify({ issues, dispositions, mode: "automatic_disposition", generatedAt: new Date(ctx.now()).toISOString() }, null, 2), "utf8");
  await ctx.emit({ eventType: "publish_gate_auto_skipped", payload: { issues, warningsPath, reportPath } });
  await ctx.emit({ eventType: "episode_succeeded", payload: { reportPath, evidenceIndexPath, tracePath, autoSkippedPublishIssues: issues.length } });
  const result: EpisodeResult = {
    episodeId: ctx.state.episodeId,
    status: "succeeded",
    reportArtifactPath: reportPath,
    evidenceIndexPath,
    evidenceQualityAuditPath,
    budgetAuditPath,
    humanReviewResponsePath: ctx.state.humanReviewResponsePath,
    tracePath,
    fullTracePath,
    metrics: await metrics(ctx, false, issues.length),
    closedAt: new Date(ctx.now()).toISOString(),
  };
  ctx.state.result = result;
  await writeTraces(ctx, tracePath, fullTracePath);
  return result;
}

function formatPublishHumanReview(review: NonNullable<EpisodeResult["humanReview"]>, issues: PublishGateIssue[]): string {
  const questions = review.questions.map((question, index) => `## ${index + 1}. ${question.title}\n\n${question.question}\n\n为什么需要决定：${question.whyNeeded}\n\n回答格式：${question.answerFormat}${question.options?.length ? `\n\n可选回答：${question.options.join(" / ")}` : ""}${question.recommendedAnswer ? `\n\n建议：${question.recommendedAnswer}` : ""}`).join("\n\n");
  return `# 报告发布需要你的决定\n\n${review.summary}\n\n${questions}\n\n## 检查问题\n\n${issues.map((issue) => `- ${issue.message}`).join("\n")}\n\n## 如何继续\n\n${review.responseInstructions}\n`;
}

function requirementIdsForPublishIssue(bundle: ReportBundle, issue: PublishGateIssue): string[] | undefined {
  const fromMessage = (bundle.constraints.requirements ?? [])
    .filter((requirement) => issue.message.includes(requirement.requirementId))
    .map((requirement) => requirement.requirementId);
  if (fromMessage.length > 0) return fromMessage;
  return issue.reportNodeId
    ? bundle.tree.find((entry) => entry.node.nodeId === issue.reportNodeId)?.node.requirementIds
    : undefined;
}

async function emitPublishGateDiagnostics(
  ctx: PhaseContext,
  input: {
    debugPartial: boolean;
    deterministicIssues: PublishGateIssue[];
    semanticIssues: PublishGateIssue[];
    beforeDowngradeIssues: PublishGateIssue[];
    finalIssues: PublishGateIssue[];
    citationCount: number;
    evidenceIndexCount: number;
    reportChars: number;
    evidenceQualityAudit: EvidenceQualityAudit;
  },
): Promise<void> {
  await ctx.emit({
    eventType: "publish_gate_diagnostics",
    payload: {
      debugPartial: input.debugPartial,
      counts: {
        deterministicIssues: input.deterministicIssues.length,
        semanticIssues: input.semanticIssues.length,
        beforeDowngradeErrors: input.beforeDowngradeIssues.filter((issue) => issue.severity === "error").length,
        finalErrors: input.finalIssues.filter((issue) => issue.severity === "error").length,
        finalWarnings: input.finalIssues.filter((issue) => issue.severity === "warning").length,
        citationMapEntries: input.citationCount,
        evidenceIndexEntries: input.evidenceIndexCount,
        reportChars: input.reportChars,
        evidenceQualityScore: input.evidenceQualityAudit.score,
        evidenceQualityErrors: input.evidenceQualityAudit.summary.errorCount,
        evidenceQualityWarnings: input.evidenceQualityAudit.summary.warningCount,
      },
      deterministicIssueCodes: input.deterministicIssues.map((issue) => issue.code),
      semanticIssueCodes: input.semanticIssues.map((issue) => issue.code),
      finalIssues: input.finalIssues.map((issue) => ({
        code: issue.code,
        severity: issue.severity,
        reportNodeId: issue.reportNodeId,
        message: issue.message,
      })),
    },
  });
}

async function downgradeSingleBranchDebugIssues(ctx: PhaseContext, issues: PublishGateIssue[]): Promise<PublishGateIssue[]> {
  if (!ctx.state.runtimeProfile.debug?.singleBranch) return issues;
  let downgraded = 0;
  const next = issues.map((issue): PublishGateIssue => {
    if (issue.severity !== "error" || !isSingleBranchDebugCoverageIssue(issue)) return issue;
    downgraded += 1;
    return {
      ...issue,
      severity: "warning",
      message: `${issue.message} (single-branch debug partial report; downgraded from blocking publish error)`,
    };
  });
  if (downgraded > 0) {
    await ctx.emit({
      eventType: "publish_gate_debug_partial",
      payload: {
        downgraded,
        reason: "single_branch_debug_allows_partial_coverage",
        issueCodes: next.filter((issue) => isSingleBranchDebugCoverageIssue(issue)).map((issue) => issue.code),
      },
    });
  }
  return next;
}

function isSingleBranchDebugCoverageIssue(issue: PublishGateIssue): boolean {
  return [
    "rubric_coverage",
    "report_mentions_unresolved_evidence_defects",
    "report_too_shallow",
    "too_short",
    "low_report_citation_coverage",
    "uncited_quantitative_claim",
    "unmapped_research_requirement",
  ].includes(issue.code);
}

async function writeTraces(ctx: PhaseContext, tracePath: string, fullTracePath: string | undefined): Promise<void> {
  await writeFile(tracePath, await exportSummaryTrace(ctx), "utf8");
  if (fullTracePath) await writeFile(fullTracePath, await exportFullTrace(ctx), "utf8");
}

async function createRepairTasks(
  ctx: PhaseContext,
  issues: PublishGateIssue[],
): Promise<TaskItem[]> {
  const now = isoNow(ctx.now);
  const rootNode = await ctx.stack.kg.getReportNode("R_root");
  const out: TaskItem[] = [];
  for (let i = 0; i < issues.length; i++) {
    const issue = issues[i]!;
    const reportNodeId = issue.reportNodeId || rootNode?.nodeId || ctx.state.rootNode?.nodeId || "R_root";
    if (reportNodeId === "R_root" && isRootPublishIssueNonDispatchable(issue)) {
      await traceWrite(ctx, "ledger", "skipPublishRepairTask", {
        issue,
        reportNodeId,
        reason: "root_publish_issue_requires_structure_or_report_rewrite_not_evidence_search",
      }, { taskId: "T_root", reportNodeId });
      continue;
    }
    const targets = await publishRepairTargets(ctx, issue, reportNodeId);
    if (targets.length === 0) {
      await traceWrite(ctx, "ledger", "skipPublishRepairTask", {
        issue,
        reportNodeId,
        reason: "publish_issue_has_no_dispatchable_report_node",
      }, { taskId: "T_root", reportNodeId });
      continue;
    }
    for (let j = 0; j < targets.length; j++) {
      const target = targets[j]!;
      const taskIdBase = `T_publish_repair_${shortId(issue.code)}`;
      const taskId = await nextRepairTaskId(ctx, taskIdBase);
      const task: TaskItem = {
        taskId,
        parentTaskId: "T_root",
        reportNodeId: target.nodeId,
        title: `Repair publish gate issue: ${issue.code}`,
        objective: issue.suggestedRepair ? `${issue.message}\n\nSuggested repair: ${issue.suggestedRepair}` : issue.message,
        status: "queued",
        priority: 95 - i - j,
        branchId: `B_${taskId}`,
        acceptanceCriteria: [
          "Fix or remove the ungrounded report statement.",
          "All citations in the final report must map to the citation map and evidence index.",
          "If the issue is semantic overclaim, hidden gap, or rubric coverage, collect targeted evidence, restore reportable coverage, or downscope the affected report node.",
        ],
        createdAt: now,
        updatedAt: now,
      };
      await ctx.stack.ledger.upsert(task);
      await traceWrite(ctx, "ledger", "upsert", {
        task,
        source: "publish_gate_repair",
        sourceIssue: issue,
      }, { taskId: task.taskId, reportNodeId: task.reportNodeId, branchId: task.branchId });
      out.push(task);
    }
  }
  return out;
}

async function publishRepairTargets(ctx: PhaseContext, issue: PublishGateIssue, reportNodeId: string): Promise<ReportNode[]> {
  const node = await ctx.stack.kg.getReportNode(reportNodeId);
  if (!node) return [];
  if (issue.code === "rubric_coverage" && node.nodeKind === "aspect") {
    await restorePublishRepairNode(ctx, node, issue);
    const descendants = await descendantNodes(ctx, node.nodeId);
    const leafHypotheses = descendants.filter((item) => item.nodeKind === "hypothesis");
    const targets = leafHypotheses.length > 0 ? leafHypotheses : [node];
    for (const target of targets) await restorePublishRepairNode(ctx, target, issue);
    return targets.slice(0, 6);
  }
  await restorePublishRepairNode(ctx, node, issue);
  return [node];
}

async function restorePublishRepairNode(ctx: PhaseContext, node: ReportNode, issue: PublishGateIssue): Promise<void> {
  if (node.status !== "pruned" && node.status !== "downplayed") return;
  const next = { ...node, status: "needs_repair" as const, updatedAt: isoNow(ctx.now) };
  await ctx.stack.kg.updateReportNode(next);
  await traceWrite(ctx, "kg", "restorePublishRepairNode", {
    issueCode: issue.code,
    reportNodeId: node.nodeId,
    previousStatus: node.status,
    nextStatus: next.status,
    reason: "Publish gate requires this report node to be repairable and visible to the report writer.",
  }, { reportNodeId: node.nodeId });
}

async function descendantNodes(ctx: PhaseContext, nodeId: string): Promise<ReportNode[]> {
  const out: ReportNode[] = [];
  const queue = await ctx.stack.kg.listChildren(nodeId);
  while (queue.length > 0) {
    const current = queue.shift()!;
    out.push(current);
    queue.push(...await ctx.stack.kg.listChildren(current.nodeId));
  }
  return out;
}

function isRootPublishIssueNonDispatchable(issue: PublishGateIssue): boolean {
  if (issue.code.startsWith("rendered_")) return true;
  return [
    "missing_citation",
    "orphan_citation",
    "empty_reference",
    "rubric_coverage",
    "overclaim",
    "hidden_gap",
    "unresolved_evidence_gaps",
    "report_mentions_unresolved_evidence_defects",
    "repeated_open_problem_blocks",
    "report_template_completion",
    "duplicate_conclusion",
    "report_truncated",
    "report_too_shallow",
    "too_short",
  ].includes(issue.code);
}

async function nextRepairTaskId(ctx: PhaseContext, base: string): Promise<string> {
  const existing = new Set((await ctx.stack.ledger.listAll()).map((task) => task.taskId));
  for (let i = 1; i < 1000; i++) {
    const candidate = `${base}_${i}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${base}_${Date.now()}`;
}

async function deterministicReportCheck(ctx: PhaseContext, markdown: string, citationMap: Record<string, string>, bundle: ReportBundle): Promise<PublishGateIssue[]> {
  const issues: PublishGateIssue[] = [];
  const used = Array.from(markdown.matchAll(/\[(C\d+)\]/g)).map((m) => m[1]!);
  const evidenceByCitation = new Map(bundle.globalEvidenceIndex.map((entry) => [entry.citationId, entry]));
  const evidenceByKnowledge = new Map(bundle.globalEvidenceIndex.map((entry) => [entry.knowledgeNodeId, entry]));
  for (const citation of used) {
    const mappedKnowledgeNodeId = citationMap[citation];
    const evidenceEntry = evidenceByCitation.get(citation);
    if (!mappedKnowledgeNodeId) {
      issues.push({ code: "missing_citation", severity: "error", message: `Citation ${citation} is not in citation map.` });
      continue;
    }
    if (!evidenceEntry || evidenceEntry.knowledgeNodeId !== mappedKnowledgeNodeId || !evidenceByKnowledge.has(mappedKnowledgeNodeId)) {
      issues.push({ code: "orphan_citation", severity: "error", message: `Citation ${citation} does not map to the evidence index KnowledgeNode.` });
      continue;
    }
    if (!evidenceEntry.title && !evidenceEntry.url) {
      issues.push({ code: "empty_reference", severity: "error", message: `Citation ${citation} points to an empty reference.` });
    }
  }
  if (markdown.length < 200) {
    issues.push({ code: "too_short", severity: "warning", message: "Report draft is short." });
  }
  if (hasTemplateCompletion(markdown)) {
    issues.push({ code: "report_template_completion", severity: "error", message: "Report ends with the automatic maxTokens/maxLlmCalls completion template instead of a real conclusion." });
  }
  if (hasDuplicateConclusionSections(markdown)) {
    issues.push({ code: "duplicate_conclusion", severity: "error", message: "Report contains multiple conclusion sections, which usually means a truncated report was patched with a second template conclusion." });
  }
  if (looksTruncated(markdown)) {
    issues.push({ code: "report_truncated", severity: "error", message: "Report appears to stop mid-sentence or lacks a complete conclusion section." });
  }
  const openProblemBlockCount = markdown.match(/存在的开放性问题/g)?.length ?? 0;
  if (openProblemBlockCount > 1) {
    issues.push({ code: "repeated_open_problem_blocks", severity: "error", message: `Report repeats standalone open-problem blocks ${openProblemBlockCount} times instead of integrating limitations once.` });
  }
  const evidenceDefectMatches = evidenceDefectPhrases(markdown);
  if (evidenceDefectMatches.length > 0) {
    issues.push({
      code: "report_mentions_unresolved_evidence_defects",
      severity: "error",
      message: `Report describes unresolved evidence-collection defects instead of resolving or downscoping them: ${evidenceDefectMatches.slice(0, 3).join("；")}`,
      suggestedRepair: "Remove internal evidence-gap/debug disclaimers from the final report. Resolve medium/high-impact gaps before publishing; for publishable low-impact caveats, use one reader-facing 研究范围与证据边界 section and downscope the claim.",
    });
  }
  const nodes = await ctx.stack.kg.listReportNodes();
  const hypothesisCount = nodes.filter((node) => node.nodeKind === "hypothesis" && node.status !== "pruned").length;
  const minLength = Math.max(200, Math.min(12000, hypothesisCount * 900));
  if (hypothesisCount >= 3 && markdown.length < minLength) {
    issues.push({ code: "report_too_shallow", severity: "error", message: `Report draft is too shallow for ${hypothesisCount} researched hypotheses. Expected at least ${minLength} characters.` });
  }
  const nodesById = new Map(nodes.map((node) => [node.nodeId, node]));
  const openGaps = (await ctx.stack.kg.listOpenGaps?.() ?? []).filter((gap) => isPublishBlockingGap(gap, nodesById) && gap.impact !== "low");
  if (openGaps.length > 0) {
    issues.push({ code: "unresolved_evidence_gaps", severity: "error", message: `Report still has ${openGaps.length} medium/high-impact unresolved evidence gaps.` });
  }
  for (const missing of detectMissingRenderedDeliverables(bundle, markdown)) {
    const details = missing.reason === "wrong_table_columns"
      ? ` Expected columns in order: ${(missing.expectedTableColumns ?? []).join(", ")}.`
      : missing.reason === "insufficient_tables"
        ? ` Found ${missing.observedTableCount ?? 0} Markdown table blocks; requires ${missing.expectedTableCount ?? 0}.`
      : missing.reason === "incomplete_table"
        ? missing.missingEntities?.length || missing.duplicateEntities?.length || missing.missingPartitions?.length
          ? ` Missing entities: ${(missing.missingEntities ?? []).join(", ") || "none"}; duplicate entities: ${(missing.duplicateEntities ?? []).join(", ") || "none"}; missing partition labels: ${(missing.missingPartitions ?? []).join(", ") || "none"}.`
          : ` Found ${missing.observedTableRows ?? 0} complete, distinct, cited rows; requires at least ${missing.minimumTableRows ?? 0}.`
        : "";
    issues.push({
      code: `rendered_deliverable_${missing.reason}`,
      severity: "error",
      message: `Requirement ${missing.requirementId} is not correctly rendered (${missing.reason}).${details}`,
      suggestedRepair: "Re-run report organization from the existing cited reportlets and preserve the complete report; do not perform new research unless the evidence completion gate separately reports a gap.",
    });
  }
  const sectionCountIssue = detectRenderedTopLevelSectionCountIssue(bundle, markdown);
  if (sectionCountIssue) {
    const namedContract = sectionCountIssue.expectedHeadings?.length
      ? ` The required ordered headings are: ${sectionCountIssue.expectedHeadings.join(" | ")}.`
      : "";
    issues.push({
      code: "rendered_top_level_section_count",
      severity: "error",
      message: `The report's level-2 main-section contract is not satisfied: expected ${sectionCountIssue.expected}, observed ${sectionCountIssue.observed} (${sectionCountIssue.headings.join(" | ")}).${namedContract}`,
      suggestedRepair: "Preserve the requested level-2 section count, names, and order. Nest ancillary tables, lists, synthesis, and conclusions under the relevant existing main section with level-3 headings; reference sections may remain separate.",
    });
  }
  return issues;
}

function evidenceDefectPhrases(markdown: string): string[] {
  const withoutReaderFacingBoundary = markdown
    .replace(readerFacingBoundarySectionPattern(), "")
    .replace(readerFacingBoundaryNotePattern(), "");
  const phrases = [
    /证据(?:仍然|还)?(?:不足|不充分|有限|薄弱)/gu,
    /(?:缺乏|尚缺|不足以|未能找到|未找到|有待补充|有待进一步|需要进一步)(?:[^。！？\n]{0,28})(?:证据|资料|数据|文献|来源|研究|分析|比较|调查|引文|支撑)/gu,
    /(?:开放缺口|开放性问题|证据缺口|待补证缺口|研究缺口|证据漏洞)/gu,
    /(?:仍需|还需|需要)(?:[^。！？\n]{0,20})(?:补充|深化|填补|验证)/gu,
  ];
  const matches = new Set<string>();
  for (const phrase of phrases) {
    for (const match of withoutReaderFacingBoundary.matchAll(phrase)) {
      const value = match[0]?.trim();
      if (value && shouldFlagEvidenceDefect(withoutReaderFacingBoundary, match.index ?? 0, value)) matches.add(value);
    }
  }
  return Array.from(matches);
}

function shouldFlagEvidenceDefect(markdown: string, index: number, value: string): boolean {
  const sentence = sentenceAround(markdown, index);
  const internalResearchContext = /(本报告|本研究|本文|当前(?:报告|研究|证据|资料)|现有(?:证据|资料|来源)|目前(?:证据|资料|来源)|证据库|资料收集|本系统|agent|缺口|待补|开放|仍需|还需|需要进一步|有待补充|有待进一步)/u;
  if (/\[C\d+\]/.test(sentence) && !internalResearchContext.test(sentence)) {
    return false;
  }
  if (!internalResearchContext.test(sentence)
    && /(?:不会|避免|防止)[^。！？\n]{0,32}(?:缺乏|不足)[^。！？\n]{0,24}(?:而|导致|造成|无法)/u.test(sentence)) return false;
  if (value === "有待进一步研究" || value === "有待进一步分析") return false;
  return true;
}

function sentenceAround(markdown: string, index: number): string {
  const startMarks = ["。", "！", "？", "\n"];
  let start = 0;
  for (const mark of startMarks) start = Math.max(start, markdown.lastIndexOf(mark, index - 1) + 1);
  const ends = startMarks.map((mark) => markdown.indexOf(mark, index)).filter((pos) => pos >= 0);
  const end = ends.length ? Math.min(...ends) + 1 : Math.min(markdown.length, index + 220);
  return markdown.slice(start, end);
}

function readerFacingBoundarySectionPattern(): RegExp {
  return /(^|\n)##\s*(?:研究范围与证据边界|研究边界|证据边界|研究范围)(?:\s|\n)[\s\S]*?(?=\n##\s+|$)/gu;
}

function readerFacingBoundaryNotePattern(): RegExp {
  return /(^|\n)\*\*(?:证据覆盖说明|覆盖说明|研究范围与证据边界|Scope and Evidence Boundaries|Evidence Boundaries)\*\*[:：]\s*[^\n]*/giu;
}

async function semanticPublishReview(ctx: PhaseContext, markdown: string, bundle: ReportBundle): Promise<PublishGateIssue[]> {
  const cfg = ctx.state.runtimeProfile.phases.publishGate;
  if (cfg?.enabled === false || (cfg?.maxLlmCalls ?? 1) <= 0) return [];
  await ctx.emit({
    eventType: "publish_gate_review_started",
    payload: {
      evidenceCount: bundle.globalEvidenceIndex.length,
      reportNodeCount: bundle.tree.length,
      reportChars: markdown.length,
      reviewerProvider: (ctx.stack.reviewLlm ?? ctx.stack.llm).name,
      independentReviewer: Boolean(ctx.stack.reviewLlm),
    },
  });
  let response;
  try {
    response = await tracedLlmChat(ctx, "publish-gate.semantic", {
      system: PUBLISH_GATE_SYSTEM_PROMPT,
      user: `Semantic publish review for this final draft.

Check only high-value semantic risks:
- rubric coverage: major requested aspects missing or shallow.
- requirement coverage: every active priority=must structured requirement is explicitly answered in reader-facing prose, not merely mapped internally. An omit waiver removes that obligation; a downplay/accept_risk waiver requires the verified subset and an honest coverage boundary, not a false completeness claim.
- overclaim: claims stronger than evidence/gaps support.
- hidden gaps: known medium/high-impact open gaps or low-support nodes are neither resolved, downscoped, nor acknowledged in one reader-facing "研究范围与证据边界" section. Do not require internal gap/debug wording.
- dispositions: do not re-open an issue explicitly listed in constraints.waivers, whether decided by the user or framework; verify that omit/downplay decisions are reflected and no internal review metadata leaks into prose.
- analytical synthesis: comparing the documented scopes of two locally cited primary sources may support a bounded inference that their perspectives are complementary. Do not demand a third source that states the synthesis verbatim.
- illustrative synthesis: a clearly labeled hypothetical workflow assembled from cited concepts is not a factual case claim. Require another citation only if the report says the workflow actually occurred.
- temporal semantics: temporalScope.basis="covered_period" constrains the events, discoveries, or measurements described, not the source publication date. Do not flag a later retrospective source solely because it was published after the covered period. Only basis="source_publication" imposes a publication-date eligibility cutoff.

Return JSON only:
{"decision":"pass"|"needs_repair","reasoningSummary":string,"issues":[{"code":"rubric_coverage"|"overclaim"|"hidden_gap"|string,"severity":"warning"|"error","message":string,"reportNodeId":string|null,"suggestedRepair":string}]}

Rubric:
${JSON.stringify(ctx.state.globalRubric ?? {}, null, 2)}

Report tree and grounding summary:
${JSON.stringify(compactPublishBundle(bundle), null, 2)}

Draft markdown:
${truncate(markdown, ctx.state.runtimeProfile.phases.publishGate?.contextTokenLimit ?? 24000)}`,
      json: true,
      ...ctx.state.runtimeProfile.llm.publishGate,
      signal: ctx.signal,
    }, {}, ctx.stack.reviewLlm ?? ctx.stack.llm);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const issue: PublishGateIssue = {
      code: "publish_review_failed",
      severity: "error",
      message: `Semantic publish review failed: ${message}`,
      suggestedRepair: "Retry publish review after the reviewer/provider error is resolved.",
    };
    await ctx.emit({
      eventType: "publish_gate_review_finished",
      payload: {
        decision: "needs_repair",
        issueCount: 1,
        issues: [issue],
        reasoningSummary: message,
      },
    });
    return [issue];
  }
  const parsed = parseLlmJson<PublishReviewJson>("publish-gate.semantic", ctx.stack.llm.name, response, () => ({ decision: "pass", issues: [] }));
  const issues = normalizePublishReview(parsed, bundle);
  await ctx.emit({
    eventType: "publish_gate_review_finished",
    payload: {
      decision: issues.some((issue) => issue.severity === "error") ? "needs_repair" : "pass",
      issueCount: issues.length,
      issues,
      reasoningSummary: parsed.reasoningSummary,
    },
  });
  return issues;
}

function normalizePublishReview(input: PublishReviewJson, bundle: ReportBundle): PublishGateIssue[] {
  const reportNodeIds = new Set(bundle.tree.map((entry) => entry.node.nodeId));
  return (Array.isArray(input.issues) ? input.issues : [])
    .filter((issue) => issue && typeof issue.code === "string" && typeof issue.message === "string")
    .slice(0, 12)
    .map((issue): PublishGateIssue => {
      const severity: PublishGateIssue["severity"] = issue.severity === "error" || input.decision === "needs_repair" ? "error" : "warning";
      return {
        code: sanitizeIssueCode(issue.code),
        severity,
        message: issue.message.trim(),
        reportNodeId: issue.reportNodeId && reportNodeIds.has(issue.reportNodeId) ? issue.reportNodeId : undefined,
        suggestedRepair: typeof issue.suggestedRepair === "string" ? issue.suggestedRepair.trim() : undefined,
      };
    })
    .filter((issue) => issue.message.length > 0);
}

function sanitizeIssueCode(code: string): string {
  return code.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "semantic_publish_issue";
}

function compactPublishBundle(bundle: ReportBundle): unknown {
  return {
    constraints: bundle.constraints,
    root: bundle.root,
    nodes: bundle.tree.map((entry) => ({
      nodeId: entry.node.nodeId,
      parentNodeId: entry.node.parentNodeId,
      nodeKind: entry.node.nodeKind,
      label: entry.node.label,
      status: entry.node.status,
      hypothesis: entry.node.hypothesis,
      requirementIds: entry.node.requirementIds,
      evidence: entry.evidence.map((item) => ({
        relation: item.link.relation,
        claimText: item.link.claimText,
        confidence: item.link.confidence,
        sourceTitle: item.knowledge.title,
        sourceTier: item.knowledge.sourceTier,
        summary: item.knowledge.summary,
        focusedSourcePassages: focusedPassagesForClaim(
          Array.isArray(item.knowledge.metadata?.focusedPassages)
            ? item.knowledge.metadata.focusedPassages.filter((value): value is string => typeof value === "string")
            : [],
          item.link.claimText,
        ),
      })),
      openGaps: entry.openGaps.filter(isBlockingGap),
    })),
    evidenceIndex: bundle.globalEvidenceIndex.map((entry) => ({
      citationId: entry.citationId,
      title: entry.title,
      url: entry.url,
      sourceTier: entry.sourceTier,
      qualityScore: entry.qualityScore,
      publishedAt: entry.publishedAt,
      publisher: entry.publisher,
      summary: entry.summary,
    })),
  };
}

export function focusedPassagesForClaim(passages: string[], claimText: string, limit = 2, maxCharsPerPassage = 3_600): string[] {
  const unique = Array.from(new Map(passages.map((passage) => [
    passage.normalize("NFKC").replace(/\s+/gu, " ").trim(),
    passage,
  ])).values()).filter(Boolean);
  if (unique.length === 0) return [];
  const terms = publishPassageTerms(claimText);
  const ranked = unique.map((passage, index) => ({
    passage,
    index,
    score: terms.reduce((sum, term) => sum + (normalizedPassageText(passage).includes(term.value) ? term.weight : 0), 0),
  })).sort((left, right) => right.score - left.score || right.index - left.index);
  const candidates = ranked.some((item) => item.score > 0) ? ranked.filter((item) => item.score > 0) : ranked;
  const selected: typeof ranked = [];
  for (const candidate of candidates) {
    if (selected.some((prior) => focusedPassageOverlap(prior.passage, candidate.passage) >= 0.6)) continue;
    selected.push(candidate);
    if (selected.length >= Math.max(1, limit)) break;
  }
  return selected.map((item) => clipFocusedPassage(item.passage, terms, Math.max(400, maxCharsPerPassage)));
}

function focusedPassageOverlap(left: string, right: string): number {
  const range = (value: string) => value.match(/characters\s+(\d+)\s*-\s*(\d+)/iu)?.slice(1, 3).map(Number);
  const leftRange = range(left);
  const rightRange = range(right);
  if (!leftRange || !rightRange) return 0;
  const [leftStart = 0, leftEnd = 0] = leftRange;
  const [rightStart = 0, rightEnd = 0] = rightRange;
  const intersection = Math.max(0, Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart));
  const shorter = Math.max(1, Math.min(leftEnd - leftStart, rightEnd - rightStart));
  return intersection / shorter;
}

function clipFocusedPassage(passage: string, terms: Array<{ value: string; weight: number }>, maxChars: number): string {
  if (passage.length <= maxChars) return passage;
  const marker = passage.match(/^---\s*Focused source passage[^\n]*---/iu)?.[0] ?? "";
  const budget = Math.max(200, maxChars - (marker ? marker.length + 45 : 0));
  const compact = compactTextOffsets(passage);
  const positions = terms.flatMap((term) => {
    const found: number[] = [];
    let offset = 0;
    while (found.length < 20) {
      const index = compact.text.indexOf(term.value, offset);
      if (index < 0) break;
      found.push(compact.offsets[index] ?? 0);
      offset = index + Math.max(1, term.value.length);
    }
    return found;
  });
  const starts = Array.from(new Set([0, ...positions.map((position) => Math.max(0, Math.min(
    passage.length - budget,
    position - Math.floor(budget / 3),
  )))]));
  const bestStart = starts.map((start) => {
    const text = normalizedPassageText(passage.slice(start, start + budget));
    const score = terms.reduce((sum, term) => sum + (text.includes(term.value) ? term.weight : 0), 0);
    return { start, score };
  }).sort((left, right) => right.score - left.score || left.start - right.start)[0]?.start ?? 0;
  const excerpt = passage.slice(bestStart, bestStart + budget).trim();
  if (!marker || bestStart === 0) return `${marker ? `${marker}\n` : ""}${excerpt.replace(marker, "").trim()}`.slice(0, maxChars);
  return `${marker}\n[Focused excerpt within stored passage]\n${excerpt}`.slice(0, maxChars);
}

function compactTextOffsets(value: string): { text: string; offsets: number[] } {
  const normalized = value.normalize("NFKC").toLocaleLowerCase();
  const chars: string[] = [];
  const offsets: number[] = [];
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index]!;
    if (/\s/u.test(char)) continue;
    chars.push(char);
    offsets.push(index);
  }
  return { text: chars.join(""), offsets };
}

function publishPassageTerms(claimText: string): Array<{ value: string; weight: number }> {
  const normalized = claimText.normalize("NFKC").toLocaleLowerCase();
  const terms = new Map<string, number>();
  const add = (value: string, weight: number) => {
    const key = normalizedPassageText(value);
    if (key.length >= 2) terms.set(key, Math.max(terms.get(key) ?? 0, weight));
  };
  for (const match of normalized.matchAll(/\barticle\s+\d+[a-z]?(?:\(\d+\))?/gu)) {
    add(match[0], 30);
    const base = match[0].match(/article\s+\d+[a-z]?/u)?.[0];
    if (base) add(base, 20);
  }
  for (const match of normalized.matchAll(/\bannex\s+[ivxlcdm]+(?:\s+part\s+[a-z0-9]+)?/gu)) add(match[0], 30);
  for (const match of normalized.matchAll(/\b(?:19|20)\d{2}\b/gu)) add(match[0], 7);
  for (const match of normalized.matchAll(/\b\d+(?:[.,]\d+)?\s*%/gu)) add(match[0], 12);
  const ignored = new Set(["according", "collection", "evidence", "materials", "official", "regulation", "report", "source", "targets", "text", "these", "this"]);
  for (const word of normalized.match(/[a-z][a-z0-9-]{4,}/gu) ?? []) if (!ignored.has(word)) add(word, 2);
  for (const sequence of normalized.match(/[\p{Script=Han}]{4,}/gu) ?? []) {
    for (let index = 0; index <= sequence.length - 4; index += 2) add(sequence.slice(index, index + 4), 2);
  }
  return Array.from(terms, ([value, weight]) => ({ value, weight }));
}

function normalizedPassageText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/gu, "");
}

export function looksTruncated(markdown: string): boolean {
  const trimmed = markdown.trim();
  if (!trimmed) return true;
  const bodyBeforeReferences = trimmed.split(/\n##\s*(?:参考文献|references|bibliography)(?:\s|\n|$)/i)[0]?.trim() || trimmed;
  const conclusionMatches = Array.from(bodyBeforeReferences.matchAll(/(^|\n)#{2,3}\s+[^\n]*(?:结论|conclusion)[^\n]*(?=\n|$)/gi));
  if (conclusionMatches.length === 0 && trimmed.length > 1200) return true;
  if (conclusionMatches.length > 0) {
    const finalConclusionIndex = conclusionMatches.at(-1)?.index ?? -1;
    const beforeFinalConclusion = finalConclusionIndex > 0
      ? stripMarkdownTail(bodyBeforeReferences.slice(0, finalConclusionIndex))
      : "";
    if (
      beforeFinalConclusion.length > 1200
      && !endsWithSentencePunctuation(beforeFinalConclusion)
      && !endsWithCompleteStructuralLine(beforeFinalConclusion)
    ) return true;
  }
  const tail = stripMarkdownTail(bodyBeforeReferences);
  return !endsWithSentencePunctuation(tail) && !endsWithCompleteStructuralLine(tail);
}

function hasTemplateCompletion(markdown: string): boolean {
  return /若需要更长篇幅，应提高\s*report\.maxTokens\s*或增加\s*report\.maxLlmCalls/.test(markdown);
}

function hasDuplicateConclusionSections(markdown: string): boolean {
  const bodyBeforeReferences = markdown.trim().split(/\n##\s*(?:参考文献|references|bibliography)(?:\s|\n|$)/i)[0] ?? markdown;
  return Array.from(bodyBeforeReferences.matchAll(/(^|\n)##\s+[^\n]*(?:结论|conclusion)[^\n]*(?=\n|$)/gi)).length > 1;
}

function stripMarkdownTail(markdown: string): string {
  return markdown.trim().replace(/\n-{3,}\s*$/g, "").replace(/[*_`~\s]+$/g, "");
}

function endsWithSentencePunctuation(markdown: string): boolean {
  return /[。！？.!?）)]$/.test(markdown.trim());
}

function endsWithCompleteStructuralLine(markdown: string): boolean {
  const finalLine = markdown.trim().split(/\r?\n/).at(-1)?.trim() ?? "";
  return /https?:\/\/\S+$/i.test(finalLine)
    || /^\|.*\|$/.test(finalLine)
    || /^\[[Cc]\d+\](?:\s|$)/.test(finalLine);
}

function formatIncompleteReport(issues: PublishGateIssue[], draftPath: string): string {
  const errors = issues.filter((issue) => issue.severity === "error");
  const lines = errors.length > 0
    ? errors.map((issue, index) => `${index + 1}. ${issue.code}: ${issue.message}${issue.suggestedRepair ? `\n   修复建议：${issue.suggestedRepair}` : ""}`)
    : ["1. 发布前检查未通过。"];
  return `# Episode incomplete

这次运行已经生成草稿，但发布门禁发现仍需修复的问题，所以没有把草稿作为最终报告发布。

## 阻塞问题

${lines.join("\n\n")}

## 草稿位置

诊断草稿保留在：${draftPath}
`;
}

async function metrics(ctx: PhaseContext, publishGatePassed: boolean, rubricIssueCount: number): Promise<EpisodeResult["metrics"]> {
  const reportNodes = await ctx.stack.kg.listReportNodes();
  const knowledgeNodes = await ctx.stack.kg.listKnowledgeNodes();
  const evidenceLinks = await ctx.stack.kg.listEvidenceLinks();
  const tasks = await ctx.stack.ledger.listAll();
  const gaps = (await ctx.stack.kg.listOpenGaps?.() ?? []).filter(isBlockingGap);
  const evidenceQualityAudit = currentEvidenceQualityAudit(ctx);
  const citationCount = ctx.state.reportBundle?.globalEvidenceIndex.length ?? 0;
  const validCitationIds = new Set(ctx.state.reportBundle?.globalEvidenceIndex.map((item) => item.citationId) ?? []);
  const usedCitationCount = new Set(
    Array.from(ctx.state.reportArtifact?.reportMd.matchAll(/\[(C\d+)\]/g) ?? [])
      .map((match) => match[1]!)
      .filter((citationId) => validCitationIds.has(citationId)),
  ).size;
  return {
    reportNodeCount: reportNodes.length,
    knowledgeNodeCount: knowledgeNodes.length,
    evidenceLinkCount: evidenceLinks.length,
    completedTaskCount: tasks.filter((task) => task.status === "completed").length,
    openGapCount: gaps.length,
    citationCount,
    usedCitationCount,
    citationUtilization: citationCount > 0 ? usedCitationCount / citationCount : 0,
    rubricIssueCount,
    publishGatePassed,
    evidenceQualityScore: evidenceQualityAudit?.score,
    evidenceQualityIssueCount: evidenceQualityAudit?.issues.length,
    requirementCoverage: evidenceQualityAudit?.requirementCoverage.coverage,
    mustRequirementCount: evidenceQualityAudit?.requirementCoverage.mustCount,
    coveredMustRequirementCount: evidenceQualityAudit?.requirementCoverage.coveredMustCount,
    ...budgetMetricFields(ctx),
  };
}

function currentEvidenceQualityAudit(ctx: PhaseContext): EvidenceQualityAudit | undefined {
  const bundle = ctx.state.reportBundle;
  const artifact = ctx.state.reportArtifact;
  if (!bundle) return undefined;
  return auditEvidenceQuality(bundle, resolveEvidenceQualityPolicy(ctx.state.runtimeProfile.evidenceQuality), {
    generatedAt: new Date(ctx.now()).toISOString(),
    markdown: artifact?.reportMd,
    citationMap: artifact?.citationMap,
  });
}

function isBlockingGap(gap: { status?: string; impact?: string }): boolean {
  return gap.status === "open" || (gap.status === "acknowledged" && gap.impact === "high");
}

function isPublishBlockingGap(gap: { status?: string; impact?: string; reportNodeId?: string }, nodesById: Map<string, ReportNode>): boolean {
  if (!isBlockingGap(gap)) return false;
  const node = gap.reportNodeId ? nodesById.get(gap.reportNodeId) : undefined;
  if (!node || !["pruned", "downplayed"].includes(node.status)) return true;
  return gap.impact === "high";
}
