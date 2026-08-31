import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  HumanReviewDecision,
  HumanReviewQuestion,
  HumanReviewRequest,
  HumanReviewResponse,
  ReportNode,
  ResearchIssueWaiver,
  TaskItem,
} from "@deepresearch/contracts";
import { isoNow, shortId } from "./infra/ids.js";
import { traceWrite } from "./trace.js";
import type { PhaseContext } from "./types.js";

export interface AppliedHumanReviewResponse {
  continueResearch: boolean;
  responsePath: string;
  taskIds: string[];
  waiverIds: string[];
  decisions: HumanReviewDecision[];
}

export async function applyHumanReviewResponse(
  ctx: PhaseContext,
  response: HumanReviewResponse,
): Promise<AppliedHumanReviewResponse> {
  const artifactDir = join(ctx.state.runtimeProfile.artifactDir, ctx.state.episodeId);
  const reviewPath = join(artifactDir, "human-review.json");
  const review = JSON.parse(await readFile(reviewPath, "utf8")) as HumanReviewRequest;
  const decisions = validateResponse(response, review);
  const taskIds: string[] = [];
  const waiverIds: string[] = [];
  let continueResearch = false;
  for (const decision of decisions) {
    const question = review.questions.find((item) => item.id === decision.questionId)!;
    const applied = await applyDecision(ctx, question, decision);
    taskIds.push(...applied.taskIds);
    waiverIds.push(...applied.waiverIds);
    continueResearch ||= applied.continueResearch;
  }
  ctx.state.result = undefined;
  ctx.state.closedAt = undefined;
  ctx.state.reportArtifact = undefined;
  ctx.state.reportBundle = undefined;
  await mkdir(artifactDir, { recursive: true });
  const responsePath = join(artifactDir, "human-review-response.json");
  const appliedAt = isoNow(ctx.now);
  await writeFile(responsePath, JSON.stringify({
    reviewStage: review.stage,
    reviewGeneratedAt: review.generatedAt,
    submittedAt: response.submittedAt || appliedAt,
    submittedBy: response.submittedBy,
    decisions,
    taskIds,
    waiverIds,
    continueResearch,
    appliedAt,
  }, null, 2), "utf8");
  ctx.state.humanReviewResponsePath = responsePath;
  await ctx.emit({
    eventType: "human_review_response_applied",
    payload: { reviewStage: review.stage, decisions, taskIds, waiverIds, continueResearch, responsePath },
  });
  await traceWrite(ctx, "artifact", "writeFile", { path: responsePath, decisionCount: decisions.length, taskIds, waiverIds });
  return { continueResearch, responsePath, taskIds, waiverIds, decisions };
}

export function validateResponse(response: HumanReviewResponse, review: HumanReviewRequest): HumanReviewDecision[] {
  if (!response || !Array.isArray(response.decisions) || response.decisions.length === 0) {
    throw new Error("humanReviewResponse.decisions must contain at least one decision");
  }
  const questions = new Map(review.questions.map((question) => [question.id, question]));
  const seen = new Set<string>();
  return response.decisions.map((raw, index) => {
    const questionId = clean(raw.questionId);
    if (!questionId || !questions.has(questionId)) throw new Error(`Unknown human review questionId at decisions[${index}]: ${questionId || "<empty>"}`);
    if (seen.has(questionId)) throw new Error(`Duplicate human review decision for questionId: ${questionId}`);
    seen.add(questionId);
    if (!["continue_research", "downplay", "omit", "accept_risk"].includes(raw.action)) {
      throw new Error(`Unsupported human review action for ${questionId}: ${String(raw.action)}`);
    }
    const rationale = clean(raw.rationale);
    if (!rationale) throw new Error(`Human review decision ${questionId} requires a rationale`);
    const question = questions.get(questionId)!;
    if (raw.reportNodeId && question.reportNodeId && raw.reportNodeId !== question.reportNodeId) {
      throw new Error(`Human review decision ${questionId} reportNodeId does not match the review request`);
    }
    return {
      questionId,
      action: raw.action,
      rationale,
      sourceUrls: validSourceUrls(raw.sourceUrls),
      reportNodeId: raw.reportNodeId || question.reportNodeId,
      requirementIds: uniqueStrings([...(raw.requirementIds ?? []), ...(question.requirementIds ?? [])]),
    };
  });
}

async function applyDecision(
  ctx: PhaseContext,
  question: HumanReviewQuestion,
  decision: HumanReviewDecision,
): Promise<{ continueResearch: boolean; taskIds: string[]; waiverIds: string[] }> {
  const inferredRequirementIds = inferRequirementIds(ctx, question, decision);
  let reportNodeId = decision.reportNodeId || question.reportNodeId;
  if (decision.action === "continue_research" && !reportNodeId) {
    reportNodeId = await mapRequirementsToRepairLeaf(ctx, inferredRequirementIds);
  }
  const node = reportNodeId ? await ctx.stack.kg.getReportNode(reportNodeId) : null;
  if (decision.action === "continue_research") {
    if (!node || node.nodeKind !== "hypothesis") {
      throw new Error(`Human review decision ${decision.questionId} needs a hypothesis report node for continued research`);
    }
    await ensureRequirementMapping(ctx, node, inferredRequirementIds);
    const mappedNode = await ctx.stack.kg.getReportNode(node.nodeId) ?? node;
    const task = await createReviewRepairTask(ctx, mappedNode, question, decision);
    return { continueResearch: true, taskIds: [task.taskId], waiverIds: [] };
  }

  if (node) await applyNodeDisposition(ctx, node, decision.action, decision.rationale);
  const issueCode = clean(question.issueCode) || clean(question.title) || "human_review_issue";
  const requirementIds = await waivableRequirementIds(ctx, node, inferredRequirementIds, decision.action, issueCode);
  const waiver = addWaiver(ctx, {
    questionId: decision.questionId,
    issueCode,
    action: decision.action,
    rationale: decision.rationale,
    reportNodeId: node?.nodeId,
    requirementIds,
  });
  if (node) {
    await ctx.stack.kg.closeOpenGaps?.(node.nodeId, `User decision ${decision.action}: ${decision.rationale}`);
    await cancelNodeTasks(ctx, node.nodeId, decision.rationale);
  }
  return { continueResearch: false, taskIds: [], waiverIds: [waiver.waiverId] };
}

async function createReviewRepairTask(
  ctx: PhaseContext,
  node: ReportNode,
  question: HumanReviewQuestion,
  decision: HumanReviewDecision,
): Promise<TaskItem> {
  const now = isoNow(ctx.now);
  const suffix = `${shortId(decision.questionId)}_${String(ctx.now()).slice(-8)}`;
  const task: TaskItem = {
    taskId: `T_human_review_${suffix}`,
    parentTaskId: "T_root",
    reportNodeId: node.nodeId,
    title: `Human-approved research: ${question.title}`,
    objective: [
      `Resolve the user-reviewed issue: ${question.question}`,
      `User rationale: ${decision.rationale}`,
      decision.sourceUrls?.length ? `User-provided source URLs:\n${decision.sourceUrls.map((url) => `- ${url}`).join("\n")}` : undefined,
      node.hypothesis?.evidenceGuidance ? `Evidence guidance: ${node.hypothesis.evidenceGuidance}` : undefined,
    ].filter((line): line is string => Boolean(line)).join("\n\n"),
    status: "queued",
    priority: 100,
    branchId: `B_human_review_${suffix}`,
    acceptanceCriteria: [
      "Directly resolve the reviewed issue on this report node.",
      "Inspect any user-provided source URLs and save only sources that pass quality checks.",
      "Create direct EvidenceLinks and a cited reportlet, or record a precise unresolved gap.",
      "Preserve the user's rationale in the reasoning summary without exposing internal review mechanics in final prose.",
    ],
    createdAt: now,
    updatedAt: now,
  };
  await ctx.stack.ledger.upsert(task);
  const next = { ...node, status: "needs_repair" as const, updatedAt: now };
  await ctx.stack.kg.updateReportNode(next);
  await traceWrite(ctx, "ledger", "upsert", { task, source: "human_review_response", question, decision }, {
    taskId: task.taskId,
    reportNodeId: task.reportNodeId,
    branchId: task.branchId,
  });
  return task;
}

async function applyNodeDisposition(
  ctx: PhaseContext,
  node: ReportNode,
  action: Exclude<HumanReviewDecision["action"], "continue_research">,
  rationale: string,
): Promise<void> {
  const links = await ctx.stack.kg.listEvidenceLinks(node.nodeId);
  const status: ReportNode["status"] = action === "omit"
    ? "pruned"
    : action === "downplay"
      ? "downplayed"
      : links.length > 0 ? "partially_supported" : "downplayed";
  const note = `User-reviewed disposition (${action}): ${rationale}`;
  await ctx.stack.kg.updateReportNode({
    ...node,
    status,
    draftSummary: node.draftSummary ? `${node.draftSummary}\n\n${note}` : note,
    updatedAt: isoNow(ctx.now),
  });
  await traceWrite(ctx, "kg", "applyHumanReviewDisposition", { reportNodeId: node.nodeId, action, rationale, status }, { reportNodeId: node.nodeId });
}

function addWaiver(
  ctx: PhaseContext,
  input: Omit<ResearchIssueWaiver, "waiverId" | "decidedAt">,
): ResearchIssueWaiver {
  const existing = ctx.state.issueWaivers.find((waiver) => (
    waiver.questionId === input.questionId && waiver.issueCode === input.issueCode && waiver.reportNodeId === input.reportNodeId
  ));
  if (existing) return existing;
  const waiver: ResearchIssueWaiver = {
    ...input,
    decidedBy: "user",
    waiverId: `W_${shortId(`${input.questionId}_${input.issueCode}_${input.reportNodeId ?? "global"}`)}`,
    decidedAt: isoNow(ctx.now),
  };
  ctx.state.issueWaivers.push(waiver);
  return waiver;
}

async function waivableRequirementIds(
  ctx: PhaseContext,
  node: ReportNode | null,
  inferred: string[],
  action: Exclude<HumanReviewDecision["action"], "continue_research">,
  issueCode: string,
): Promise<string[]> {
  if (action === "accept_risk" && !isRequirementLevelIssue(issueCode)) return [];
  const candidates = uniqueStrings([...inferred, ...(node?.requirementIds ?? [])]);
  if (!node) return candidates;
  const nodes = await ctx.stack.kg.listReportNodes();
  return candidates.filter((requirementId) => !nodes.some((other) => (
    other.nodeId !== node.nodeId
    && other.nodeKind === "hypothesis"
    && !["pruned", "downplayed"].includes(other.status)
    && other.requirementIds?.includes(requirementId)
  )));
}

function isRequirementLevelIssue(issueCode: string): boolean {
  return [
    "unmapped_research_requirement",
    "ungrounded_research_requirement",
    "stale_research_requirement",
    "unknown_source_freshness",
  ].includes(issueCode);
}

async function mapRequirementsToRepairLeaf(ctx: PhaseContext, requirementIds: string[]): Promise<string | undefined> {
  const nodes = (await ctx.stack.kg.listReportNodes()).filter((node) => node.nodeKind === "hypothesis" && node.status !== "pruned");
  const target = nodes.find((node) => requirementIds.some((id) => node.requirementIds?.includes(id))) ?? nodes[0];
  if (!target) return undefined;
  await ensureRequirementMapping(ctx, target, requirementIds);
  return target.nodeId;
}

async function ensureRequirementMapping(ctx: PhaseContext, node: ReportNode, requirementIds: string[]): Promise<void> {
  const merged = uniqueStrings([...(node.requirementIds ?? []), ...requirementIds]);
  if (merged.length === (node.requirementIds ?? []).length) return;
  await ctx.stack.kg.updateReportNode({ ...node, requirementIds: merged, updatedAt: isoNow(ctx.now) });
}

async function cancelNodeTasks(ctx: PhaseContext, reportNodeId: string, rationale: string): Promise<void> {
  for (const task of await ctx.stack.ledger.listByReportNode(reportNodeId)) {
    if (!['queued', 'running', 'blocked'].includes(task.status)) continue;
    await ctx.stack.ledger.updateStatus(task.taskId, "cancelled", `Human review disposition: ${rationale}`);
  }
}

function inferRequirementIds(ctx: PhaseContext, question: HumanReviewQuestion, decision: HumanReviewDecision): string[] {
  const explicit = uniqueStrings([...(question.requirementIds ?? []), ...(decision.requirementIds ?? [])]);
  if (explicit.length > 0) return explicit;
  const text = `${question.title}\n${question.question}`;
  return (ctx.state.globalRubric?.requirements ?? [])
    .filter((requirement) => text.includes(requirement.requirementId))
    .map((requirement) => requirement.requirementId);
}

function validSourceUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.flatMap((item) => {
    if (typeof item !== "string") return [];
    try {
      const parsed = new URL(item.trim());
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? [parsed.toString()] : [];
    } catch {
      return [];
    }
  })).slice(0, 20);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map(clean).filter(Boolean)));
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}
