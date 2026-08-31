import type {
  EvidenceLink,
  NewTaskRequest,
  OpenGap,
  ReportNode,
  StructurePatch,
  StructurePatchCritique,
  StructurePatchDecision,
  StructurePatchSuggestion,
  TaskItem,
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition,
  ToolRegistry,
} from "@deepresearch/contracts";
import { runAgentRuntime } from "../agent-runtime.js";
import { evidenceRuntimeHistoryMaxChars } from "./evidence-budget.js";
import { isoNow, shortId } from "../infra/ids.js";
import { STRUCTURE_REVIEW_SYSTEM_PROMPT } from "../prompts.js";
import { traceWrite, tracedLlmChat } from "../trace.js";
import type { PhaseContext } from "../types.js";

interface StructureReviewJson {
  suggestions?: StructurePatchSuggestion[];
}

export interface StructureReviewOptions {
  allowNewResearchTasks?: boolean;
}

export async function structureReviewPhase(ctx: PhaseContext, opts: StructureReviewOptions = {}): Promise<StructurePatchDecision[]> {
  const allowNewResearchTasks = opts.allowNewResearchTasks ?? true;
  const rawWorkerSuggestions = ctx.state.agentResults.flatMap((result) => result.structurePatchSuggestions);
  const workerSanitized = sanitizeSuggestions(rawWorkerSuggestions);
  const nodes = await ctx.stack.kg.listReportNodes();
  const evidenceLinks = await ctx.stack.kg.listEvidenceLinks();
  const gaps = await ctx.stack.kg.listOpenGaps?.() ?? [];
  await ctx.emit({
    eventType: "structure_review_started",
    payload: {
      reportNodes: nodes.length,
      evidenceLinks: evidenceLinks.length,
      openGaps: gaps.length,
      workerSuggestions: rawWorkerSuggestions.length,
      allowNewResearchTasks,
    },
  });
  if (workerSanitized.dropped > 0) {
    await ctx.emit({
      eventType: "structure_review_suggestions_filtered",
      payload: { source: "worker", kept: workerSanitized.suggestions.length, dropped: workerSanitized.dropped },
    });
  }
  const ai = await runStructureReviewAgent(ctx, {
    nodes,
    evidenceLinks,
    gaps,
    workerSuggestions: workerSanitized.suggestions,
    allowNewResearchTasks,
  });
  const aiSanitized = sanitizeSuggestions(ai.suggestions ?? []);
  if (aiSanitized.dropped > 0) {
    await ctx.emit({
      eventType: "structure_review_suggestions_filtered",
      payload: { source: "structure-review", kept: aiSanitized.suggestions.length, dropped: aiSanitized.dropped },
    });
  }
  let suggestions = [...workerSanitized.suggestions, ...aiSanitized.suggestions];
  await ctx.emit({
    eventType: "structure_review_agent_suggested",
    payload: {
      workerSuggestions: workerSanitized.suggestions.length,
      aiSuggestions: aiSanitized.suggestions.length,
      droppedWorkerSuggestions: workerSanitized.dropped,
      droppedAiSuggestions: aiSanitized.dropped,
      suggestions,
    },
  });
  if (!allowNewResearchTasks) {
    const before = suggestions.length;
    suggestions = suggestions.filter((suggestion) => !patchCreatesNewResearchWork(suggestion.patch));
    const dropped = before - suggestions.length;
    if (dropped > 0) {
      await ctx.emit({
        eventType: "structure_review_suggestions_filtered",
        payload: { source: "dispatch-budget", kept: suggestions.length, dropped },
      });
    }
  }
  const limited = suggestions.slice(0, ctx.state.runtimeProfile.phases.structureReview?.maxOutputItems ?? 24);
  const decisions: StructurePatchDecision[] = [];
  let applied = 0;
  let rejected = 0;

  for (let i = 0; i < limited.length; i++) {
    const suggestion = limited[i]!;
    const critique = await critiquePatch(ctx, suggestion, i);
    await ctx.emit({
      eventType: "structure_critic_decision",
      payload: { critique, suggestion },
    });
    const decision = await deterministicPatchGuard(ctx, suggestion, critique, allowNewResearchTasks);
    if (decision.decision === "apply" && decision.finalPatch) {
      await applyStructurePatch(ctx, decision.finalPatch);
      applied += 1;
    } else if (decision.decision === "redispatch" && decision.finalPatch && allowNewResearchTasks) {
      await createRepairTask(ctx, decision.finalPatch, critique.reason);
      rejected += 1;
    } else {
      rejected += 1;
    }
    decisions.push(decision);
    await ctx.emit({
      eventType: "patch_guard_decision",
      payload: { decision, suggestion, critique },
    });
    await traceWrite(ctx, "structure", "decision", { decision, suggestion });
  }

  await ctx.emit({ eventType: "structure_review", payload: { applied, rejected, decisions } });
  return decisions;
}

async function runStructureReviewAgent(ctx: PhaseContext, input: {
  nodes: ReportNode[];
  evidenceLinks: EvidenceLink[];
  gaps: OpenGap[];
  workerSuggestions: StructurePatchSuggestion[];
  allowNewResearchTasks: boolean;
}): Promise<StructureReviewJson> {
  const llmCfg = ctx.state.runtimeProfile.llm.structureReview;
  const agentCfg = ctx.state.runtimeProfile.agents.structureReview;
  const agentRunId = "A_structure_review";
  const registry = new StructureReviewToolRegistry(ctx, input);
  const runtime = await runAgentRuntime({
    agent: {
      agentId: "structure_review",
      agentRunId,
      role: "main_dispatcher",
      title: "StructureReviewAgent",
      objective: "Review the explored report tree, detect duplicated or weak branches, and propose safe structure patches or redispatch-worthy additions.",
      episodeId: ctx.state.episodeId,
    },
    llm: ctx.stack.llm,
    system: `${STRUCTURE_REVIEW_SYSTEM_PROMPT}
You are now operating as a ReAct tree-adjustment agent after reflection.
Use inspection tools when you need the current tree, evidence bindings, open gaps, or worker patch suggestions.
Do not write report prose and do not apply patches yourself.
Finish with {"suggestions":[{"patch":object,"rationale":string,"confidence":number}]}.
Allowed patch ops: add_aspect_node, add_hypothesis_node, rename_report_node, move_report_node, merge_report_nodes, move_evidence_link, retag_knowledge_node, discard_knowledge_node, downplay_hypothesis.`,
    context: {
      instruction: "Propose only necessary tree adjustments after evidence exploration. Prefer merging duplication, moving misplaced evidence, downplaying weak hypotheses, or adding narrowly scoped missing nodes that justify redispatch.",
      reportNodeCount: input.nodes.length,
      evidenceLinkCount: input.evidenceLinks.length,
      openGapCount: input.gaps.length,
      workerSuggestionCount: input.workerSuggestions.length,
      allowNewResearchTasks: input.allowNewResearchTasks,
      structuredRequirements: ctx.state.globalRubric?.requirements ?? [],
      treePreview: input.nodes.map((node) => ({
        nodeId: node.nodeId,
        parentNodeId: node.parentNodeId,
        nodeKind: node.nodeKind,
        label: node.label,
        status: node.status,
        coverage: node.coverage,
        requirementIds: node.requirementIds,
      })),
      rules: [
        "Do not add new research nodes when allowNewResearchTasks is false.",
        ...(ctx.state.runtimeProfile.debug?.maxAspects || ctx.state.runtimeProfile.debug?.maxBranchesPerAspect
          ? [`Debug tree limits remain active for the entire run: at most ${ctx.state.runtimeProfile.debug?.maxAspects ?? 2} aspect nodes and ${ctx.state.runtimeProfile.debug?.maxBranchesPerAspect ?? 2} hypothesis branches per aspect. Do not propose additions beyond these limits.`]
          : []),
        "Prefer no patch over speculative structure churn.",
        "Use move/merge only when evidence or labels show a clear duplicate or misplaced node.",
        "Preserve requirement traceability across patches. Never prune or merge away the only leaf mapped to a priority=must requirement without transferring that requirement to a valid target.",
        "PatchGuard will reject unsafe patches, so provide complete patch fields and clear rationale.",
      ],
    },
    tools: registry,
    budget: {
      maxReactSteps: Math.max(1, agentCfg?.maxReactSteps ?? 6),
      maxToolCalls: Math.max(0, agentCfg?.maxToolCalls ?? 8),
      targetReactSteps: positiveOptional(agentCfg?.targetReactSteps),
      targetToolCalls: positiveOptional(agentCfg?.targetToolCalls),
    },
    outputSchema: {
      suggestions: [{ patch: "StructurePatch", rationale: "string", confidence: "number 0..1" }],
    },
    ...llmCfg,
    historyMaxChars: evidenceRuntimeHistoryMaxChars(),
    outputRepairAttempts: agentCfg?.outputRepairAttempts ?? 1,
    signal: ctx.signal,
    chat: (request) => tracedLlmChat(ctx, "structure-review.react", request, { agentRunId }),
    onVisualEvent: (event) => ctx.emit({
      eventType: "agent_runtime_visual",
      agentRunId: event.actor.agentRunId,
      taskId: event.actor.taskId,
      reportNodeId: event.actor.reportNodeId,
      payload: { visual: event },
    }),
  });
  if (runtime.status === "completed") return object(runtime.finish) as StructureReviewJson;
  await ctx.emit({
    eventType: "structure_review_parse_repair",
    payload: {
      provider: ctx.stack.llm.name,
      reason: runtime.error ?? `StructureReviewAgent ended with status=${runtime.status}`,
      fallback: "no_new_structure_suggestions",
    },
  });
  return { suggestions: [] };
}

const structureReviewTools: ToolDefinition[] = [
  { toolName: "list_report_tree", description: "List current report nodes with status and coverage." },
  { toolName: "list_evidence_links", description: "List evidence links, optionally filtered by reportNodeId." },
  { toolName: "list_open_gaps", description: "List stored open gaps." },
  { toolName: "list_worker_patch_suggestions", description: "List patch suggestions produced by EvidenceAgents." },
  { toolName: "list_relevant_evidence", description: "List evidence links and source summaries for a report node." },
  { toolName: "inspect_knowledge_node", description: "Inspect one saved KnowledgeNode by id." },
];

class StructureReviewToolRegistry implements ToolRegistry {
  constructor(
    private readonly ctx: PhaseContext,
    private readonly input: {
      nodes: ReportNode[];
      evidenceLinks: EvidenceLink[];
      gaps: OpenGap[];
      workerSuggestions: StructurePatchSuggestion[];
      allowNewResearchTasks: boolean;
    },
  ) {}

  listTools(): ToolDefinition[] {
    return structureReviewTools;
  }

  async invoke(req: ToolCallRequest): Promise<ToolCallResult> {
    const startedAt = Date.now();
    try {
      switch (req.toolName) {
        case "list_report_tree":
          return ok(req.toolName, startedAt, this.input.nodes.map((node) => ({
            nodeId: node.nodeId,
            parentNodeId: node.parentNodeId,
            nodeKind: node.nodeKind,
            label: node.label,
            scopeNote: node.scopeNote,
            status: node.status,
            coverage: node.coverage,
          })));
        case "list_evidence_links":
          return ok(req.toolName, startedAt, this.listEvidenceLinks(req));
        case "list_open_gaps":
          return ok(req.toolName, startedAt, this.input.gaps);
        case "list_worker_patch_suggestions":
          return ok(req.toolName, startedAt, {
            allowNewResearchTasks: this.input.allowNewResearchTasks,
            suggestions: this.input.workerSuggestions,
          });
        case "list_relevant_evidence":
          return ok(req.toolName, startedAt, await this.listRelevantEvidence(req));
        case "inspect_knowledge_node":
          return ok(req.toolName, startedAt, await this.inspectKnowledgeNode(req));
        default:
          return fail(req.toolName, startedAt, `Tool is not available in StructureReviewAgent: ${req.toolName}`);
      }
    } catch (err) {
      return fail(req.toolName, startedAt, err instanceof Error ? err.message : String(err));
    }
  }

  private listEvidenceLinks(req: ToolCallRequest): unknown {
    const ids = requestedReportNodeIds(req.args);
    return ids.length
      ? this.input.evidenceLinks.filter((link) => ids.includes(link.reportNodeId))
      : this.input.evidenceLinks;
  }

  private async listRelevantEvidence(req: ToolCallRequest): Promise<unknown> {
    const ids = requestedReportNodeIds(req.args);
    const links = (ids.length
      ? this.input.evidenceLinks.filter((link) => ids.includes(link.reportNodeId))
      : this.input.evidenceLinks).slice(0, 80);
    const out = [];
    for (const link of links) {
      const knowledge = await this.ctx.stack.kg.getKnowledgeNode(link.knowledgeNodeId);
      out.push({
        link,
        knowledge: knowledge
          ? {
              nodeId: knowledge.nodeId,
              title: knowledge.title,
              url: knowledge.url,
              sourceTier: knowledge.sourceTier,
              qualityScore: knowledge.qualityScore,
              summary: knowledge.summary,
            }
          : null,
      });
    }
    return out;
  }

  private async inspectKnowledgeNode(req: ToolCallRequest): Promise<unknown> {
    const knowledgeNodeId = stringOrUndefined(object(req.args).knowledgeNodeId);
    if (!knowledgeNodeId) throw new Error("knowledgeNodeId is required");
    return await this.ctx.stack.kg.getKnowledgeNode(knowledgeNodeId);
  }
}

function patchCreatesNewResearchWork(patch: StructurePatch): boolean {
  return patch.op === "add_aspect_node" || patch.op === "add_hypothesis_node";
}

function sanitizeSuggestions(suggestions: unknown[]): { suggestions: StructurePatchSuggestion[]; dropped: number } {
  const allowed = new Set([
    "add_aspect_node",
    "add_hypothesis_node",
    "rename_report_node",
    "move_report_node",
    "merge_report_nodes",
    "move_evidence_link",
    "retag_knowledge_node",
    "discard_knowledge_node",
    "downplay_hypothesis",
  ]);
  const out: StructurePatchSuggestion[] = [];
  let dropped = 0;
  for (const item of suggestions) {
    const suggestion = item && typeof item === "object" ? item as Partial<StructurePatchSuggestion> : undefined;
    const patch = suggestion?.patch as StructurePatch | undefined;
    const op = (patch as { op?: string } | undefined)?.op;
    if (!patch || !op || !allowed.has(op) || !isCompletePatch(patch)) {
      dropped += 1;
      continue;
    }
    const rationale = suggestion?.rationale || "LLM structure review suggestion.";
    const confidence = suggestion?.confidence;
    out.push({
      patch,
      rationale,
      confidence: typeof confidence === "number" ? Math.max(0, Math.min(1, confidence)) : 0.5,
    });
  }
  return { suggestions: out.slice(0, 24), dropped };
}

function isCompletePatch(patch: StructurePatch): boolean {
  switch (patch.op) {
    case "add_aspect_node":
      return Boolean(patch.parentNodeId && patch.label && patch.scopeNote);
    case "add_hypothesis_node":
      return Boolean(patch.parentNodeId && patch.statement && patch.researchBrief && patch.evidenceGuidance);
    case "rename_report_node":
      return Boolean(patch.reportNodeId && patch.label);
    case "move_report_node":
      return Boolean(patch.reportNodeId && patch.fromParentId && patch.toParentId);
    case "merge_report_nodes":
      return Boolean(patch.sourceNodeId && patch.targetNodeId);
    case "move_evidence_link":
      return Boolean(patch.linkId && patch.fromReportNodeId && patch.toReportNodeId);
    case "retag_knowledge_node":
      return Boolean(patch.knowledgeNodeId && patch.metadataPatch && typeof patch.metadataPatch === "object");
    case "discard_knowledge_node":
      return Boolean(patch.knowledgeNodeId && patch.reason);
    case "downplay_hypothesis":
      return Boolean(patch.reportNodeId && patch.writePolicy);
  }
}

export async function applyStructurePatch(ctx: PhaseContext, patch: StructurePatch): Promise<void> {
  const now = isoNow(ctx.now);
  switch (patch.op) {
    case "add_aspect_node": {
      const nodeId = patch.newNodeId ?? `R_aspect_${shortId(patch.label)}_${nowSuffix(now)}`;
      const parent = await ctx.stack.kg.getReportNode(patch.parentNodeId);
      await ctx.stack.kg.upsertReportNode({
        nodeId,
        nodeKind: "aspect",
        label: patch.label,
        parentNodeId: patch.parentNodeId,
        scopeNote: patch.scopeNote,
        status: "planned",
        requirementIds: parent?.requirementIds,
        coverage: emptyCoverage(),
        createdAt: now,
        updatedAt: now,
      });
      await traceWrite(ctx, "kg", "upsertReportNode", { patch, nodeId }, { reportNodeId: nodeId });
      break;
    }
    case "add_hypothesis_node": {
      const nodeId = patch.newNodeId ?? `R_hyp_${shortId(patch.statement)}_${nowSuffix(now)}`;
      const parent = await ctx.stack.kg.getReportNode(patch.parentNodeId);
      const node: ReportNode = {
        nodeId,
        nodeKind: "hypothesis",
        label: patch.statement.slice(0, 80),
        parentNodeId: patch.parentNodeId,
        scopeNote: patch.researchBrief,
        hypothesis: {
          statement: patch.statement,
          researchBrief: patch.researchBrief,
          evidenceGuidance: patch.evidenceGuidance,
        },
        status: "planned",
        requirementIds: parent?.requirementIds,
        coverage: emptyCoverage(),
        createdAt: now,
        updatedAt: now,
      };
      await ctx.stack.kg.upsertReportNode(node);
      await traceWrite(ctx, "kg", "upsertReportNode", { patch, node }, { reportNodeId: nodeId });
      await createTask(ctx, {
        reportNodeId: nodeId,
        title: `Research ${patch.statement.slice(0, 60)}`,
        objective: patch.researchBrief,
        priority: 70,
        acceptanceCriteria: ["Collect supporting or contradicting evidence for this hypothesis."],
      });
      break;
    }
    case "rename_report_node": {
      const node = await requiredNode(ctx, patch.reportNodeId);
      const next = {
        ...node,
        label: patch.label,
        scopeNote: patch.scopeNote ?? node.scopeNote,
        updatedAt: now,
      };
      await ctx.stack.kg.updateReportNode(next);
      await traceWrite(ctx, "kg", "updateReportNode", { patch, node: next }, { reportNodeId: node.nodeId });
      break;
    }
    case "move_report_node": {
      const node = await requiredNode(ctx, patch.reportNodeId);
      if (node.parentNodeId !== patch.fromParentId) throw new Error(`move_report_node fromParent mismatch for ${patch.reportNodeId}`);
      const next = { ...node, parentNodeId: patch.toParentId, updatedAt: now };
      await ctx.stack.kg.updateReportNode(next);
      await traceWrite(ctx, "kg", "updateReportNode", { patch, node: next }, { reportNodeId: node.nodeId });
      break;
    }
    case "merge_report_nodes": {
      const source = await requiredNode(ctx, patch.sourceNodeId);
      const target = await requiredNode(ctx, patch.targetNodeId);
      for (const link of await ctx.stack.kg.listEvidenceLinks(patch.sourceNodeId)) {
        await ctx.stack.kg.updateEvidenceLink({ ...link, reportNodeId: patch.targetNodeId });
      }
      const mergedTarget = {
        ...target,
        requirementIds: Array.from(new Set([...(target.requirementIds ?? []), ...(source.requirementIds ?? [])])),
        updatedAt: now,
      };
      await ctx.stack.kg.updateReportNode(mergedTarget);
      const next = { ...source, status: "pruned" as const, updatedAt: now };
      await ctx.stack.kg.updateReportNode(next);
      await traceWrite(ctx, "kg", "updateReportNode", { patch, node: next }, { reportNodeId: source.nodeId });
      await traceWrite(ctx, "kg", "updateReportNode", { patch, node: mergedTarget, reason: "merge_requirement_ids" }, { reportNodeId: target.nodeId });
      break;
    }
    case "move_evidence_link": {
      const link = await ctx.stack.kg.getEvidenceLink(patch.linkId);
      if (!link) throw new Error(`EvidenceLink not found: ${patch.linkId}`);
      if (link.reportNodeId !== patch.fromReportNodeId) throw new Error(`move_evidence_link fromReportNodeId mismatch for ${patch.linkId}`);
      await requiredNode(ctx, patch.toReportNodeId);
      await ctx.stack.kg.updateEvidenceLink({ ...link, reportNodeId: patch.toReportNodeId });
      await traceWrite(ctx, "kg", "updateEvidenceLink", { patch, link: { ...link, reportNodeId: patch.toReportNodeId } }, { reportNodeId: patch.toReportNodeId });
      break;
    }
    case "retag_knowledge_node": {
      const node = await ctx.stack.kg.getKnowledgeNode(patch.knowledgeNodeId);
      if (!node) throw new Error(`KnowledgeNode not found: ${patch.knowledgeNodeId}`);
      const next = {
        ...node,
        nodeType: typeof patch.metadataPatch.nodeType === "string" ? patch.metadataPatch.nodeType : node.nodeType,
        sourceTier: typeof patch.metadataPatch.sourceTier === "string" ? patch.metadataPatch.sourceTier : node.sourceTier,
        metadata: { ...node.metadata, ...patch.metadataPatch },
      };
      await ctx.stack.kg.upsertKnowledgeNode(next);
      await traceWrite(ctx, "kg", "upsertKnowledgeNode", { patch, knowledge: next });
      break;
    }
    case "discard_knowledge_node": {
      const node = await ctx.stack.kg.getKnowledgeNode(patch.knowledgeNodeId);
      if (!node) throw new Error(`KnowledgeNode not found: ${patch.knowledgeNodeId}`);
      await ctx.stack.kg.upsertKnowledgeNode({
        ...node,
        qualityScore: 0,
        metadata: node.metadata,
      });
      await traceWrite(ctx, "kg", "upsertKnowledgeNode", { patch, knowledgeNodeId: node.nodeId, qualityScore: 0 });
      break;
    }
    case "downplay_hypothesis": {
      const node = await requiredNode(ctx, patch.reportNodeId);
      if (node.nodeKind !== "hypothesis") throw new Error(`downplay_hypothesis requires hypothesis node: ${patch.reportNodeId}`);
      const next = { ...node, status: "downplayed" as const, updatedAt: now };
      await ctx.stack.kg.updateReportNode(next);
      await traceWrite(ctx, "kg", "updateReportNode", { patch, node: next }, { reportNodeId: node.nodeId });
      break;
    }
  }
}

async function critiquePatch(ctx: PhaseContext, suggestion: StructurePatchSuggestion, patchIndex: number): Promise<StructurePatchCritique> {
  const patch = suggestion.patch;
  const evidenceLinks = await ctx.stack.kg.listEvidenceLinks();
  const touchesEvidence = (nodeId: string): boolean => evidenceLinks.some((link) => link.reportNodeId === nodeId);
  if (patch.op === "rename_report_node" || patch.op === "retag_knowledge_node" || patch.op === "discard_knowledge_node" || patch.op === "downplay_hypothesis") {
    return { patchIndex, risk: "safe", concerns: [], suggestedAction: "apply", reason: suggestion.rationale };
  }
  if (patch.op === "move_evidence_link" || patch.op === "add_aspect_node" || patch.op === "add_hypothesis_node") {
    return { patchIndex, risk: "safe", concerns: [], suggestedAction: "apply", reason: suggestion.rationale };
  }
  if (patch.op === "move_report_node") {
    if (await wouldCreateCycle(ctx, patch.reportNodeId, patch.toParentId)) {
      return { patchIndex, risk: "dangerous", concerns: ["move_report_node would create a report-tree cycle"], suggestedAction: "reject", reason: "Patch would move a node under its own descendant." };
    }
    const risk = touchesEvidence(patch.reportNodeId) ? "risky" : "safe";
    return { patchIndex, risk, concerns: risk === "risky" ? ["node has evidence links"] : [], suggestedAction: risk === "safe" ? "apply" : "redispatch", reason: suggestion.rationale };
  }
  if (patch.op === "merge_report_nodes") {
    if (patch.sourceNodeId === patch.targetNodeId) {
      return { patchIndex, risk: "dangerous", concerns: ["merge_report_nodes cannot merge a node into itself"], suggestedAction: "reject", reason: "Patch source and target are identical." };
    }
    return { patchIndex, risk: "risky", concerns: ["merge rewrites evidence link bindings"], suggestedAction: "apply", reason: suggestion.rationale };
  }
  return { patchIndex, risk: "dangerous", concerns: ["unknown patch op"], suggestedAction: "reject", reason: "Patch op is not allowed by v5 contracts." };
}

async function deterministicPatchGuard(
  ctx: PhaseContext,
  suggestion: StructurePatchSuggestion,
  critique: StructurePatchCritique,
  allowNewResearchTasks: boolean,
): Promise<StructurePatchDecision> {
  if (critique.risk === "dangerous") {
    return {
      patchIndex: critique.patchIndex,
      decision: "reject",
      rationale: `PatchGuard rejected dangerous patch: ${critique.reason}`,
    };
  }
  if (critique.suggestedAction === "redispatch" && !allowNewResearchTasks) {
    return {
      patchIndex: critique.patchIndex,
      decision: "reject",
      rationale: `PatchGuard rejected redispatch because no research budget remains: ${critique.reason}`,
    };
  }
  const treeLimitViolation = await debugTreeLimitViolation(ctx, suggestion.patch);
  if (treeLimitViolation) {
    return {
      patchIndex: critique.patchIndex,
      decision: "reject",
      rationale: `PatchGuard rejected patch because the debug tree limit would be exceeded: ${treeLimitViolation}`,
    };
  }
  const semanticViolation = await semanticTreeViolation(ctx, suggestion.patch);
  if (semanticViolation) {
    return {
      patchIndex: critique.patchIndex,
      decision: "reject",
      rationale: `PatchGuard rejected patch because it would erase requirement-focused structure: ${semanticViolation}`,
    };
  }
  if (suggestion.patch.op === "move_report_node") {
    const node = await ctx.stack.kg.getReportNode(suggestion.patch.reportNodeId);
    if (!node) {
      return {
        patchIndex: critique.patchIndex,
        decision: "reject",
        rationale: `PatchGuard rejected patch for missing ReportNode: ${suggestion.patch.reportNodeId}`,
      };
    }
    if (node.parentNodeId !== suggestion.patch.fromParentId) {
      return {
        patchIndex: critique.patchIndex,
        decision: "reject",
        rationale: `PatchGuard rejected move_report_node fromParent mismatch for ${suggestion.patch.reportNodeId}`,
      };
    }
  }
  return {
    patchIndex: critique.patchIndex,
    decision: critique.suggestedAction,
    finalPatch: critique.suggestedAction === "reject" ? undefined : suggestion.patch,
    rationale: critique.reason,
  };
}

async function semanticTreeViolation(ctx: PhaseContext, patch: StructurePatch): Promise<string | undefined> {
  const nodes = await ctx.stack.kg.listReportNodes();
  if (patch.op === "add_aspect_node") {
    return "a standalone aspect has no evidence leaf or research task; add or move a concrete hypothesis instead";
  }
  if (patch.op === "merge_report_nodes") {
    const source = nodes.find((node) => node.nodeId === patch.sourceNodeId);
    const target = nodes.find((node) => node.nodeId === patch.targetNodeId);
    if (!source || !target) return `merge references a missing ReportNode`;
    if (source.nodeKind !== target.nodeKind) {
      return `merge would move ${source.nodeKind} evidence into a ${target.nodeKind} node and break leaf-level grounding`;
    }
    const requirements = ctx.state.globalRubric?.requirements ?? [];
    const leafOwningIds = new Set(requirements
      .filter((requirement) => requirement.priority === "must"
        && requirement.evidenceRequired
        && ["question", "comparison", "deliverable"].includes(requirement.kind))
      .map((requirement) => requirement.requirementId));
    const sourceIds = new Set((source.requirementIds ?? []).filter((id) => leafOwningIds.has(id)));
    const targetIds = new Set((target.requirementIds ?? []).filter((id) => leafOwningIds.has(id)));
    const sourceOnly = [...sourceIds].filter((id) => !targetIds.has(id));
    const targetOnly = [...targetIds].filter((id) => !sourceIds.has(id));
    if (sourceOnly.length > 0 && targetOnly.length > 0) {
      return `merge would combine distinct evidence-bearing must requirements (${sourceOnly.join(", ")} vs ${targetOnly.join(", ")})`;
    }
    if (source.nodeKind === "hypothesis" && target.nodeKind === "hypothesis" && source.parentNodeId === target.parentNodeId) {
      const sourceSubject = leadingSubjectToken(source.label);
      const targetSubject = leadingSubjectToken(target.label);
      if (sourceSubject && targetSubject && sourceSubject !== targetSubject) {
        return `merge would combine distinct sibling subjects (${source.label} vs ${target.label})`;
      }
      const sourceTokens = distinctiveLabelTokens(source.label);
      const targetTokens = distinctiveLabelTokens(target.label);
      if (sourceTokens.size > 0 && targetTokens.size > 0 && ![...sourceTokens].some((token) => targetTokens.has(token))) {
        return `merge would combine distinct sibling subjects (${source.label} vs ${target.label})`;
      }
    }
  }
  return undefined;
}

function leadingSubjectToken(value: string): string | undefined {
  const generic = new Set(["the", "a", "an", "part", "section", "technical", "summary", "analysis", "overview", "compare", "comparison", "explain", "assess", "identify", "provide", "discuss", "describe", "research"]);
  return value.normalize("NFKC").toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .find((token) => token.length >= 2 && !generic.has(token));
}

function normalizedNodeLabel(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/&/g, "and").replace(/[\p{P}\p{S}\s]+/gu, "");
}

function distinctiveLabelTokens(value: string): Set<string> {
  const stop = new Set(["technical", "summary", "analysis", "overview", "report", "comparison", "evidence", "finding", "findings", "part", "section", "research", "requirement"]);
  return new Set(value.normalize("NFKC").toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !stop.has(token)));
}

async function debugTreeLimitViolation(ctx: PhaseContext, patch: StructurePatch): Promise<string | undefined> {
  const debug = ctx.state.runtimeProfile.debug;
  const maxAspects = positiveLimit(debug?.maxAspects);
  const maxBranchesPerAspect = positiveLimit(debug?.maxBranchesPerAspect);
  const maxInitialAgentNodes = positiveLimit(debug?.maxInitialAgentNodes);
  if (!maxAspects && !maxBranchesPerAspect && !maxInitialAgentNodes) return undefined;

  const nodes = await ctx.stack.kg.listReportNodes();
  if (patch.op === "add_aspect_node") {
    const aspectCount = nodes.filter((node) => node.nodeKind === "aspect" && node.parentNodeId === patch.parentNodeId).length;
    if (maxAspects && aspectCount >= maxAspects) return `aspect count is already ${aspectCount}/${maxAspects}`;
  }
  if (patch.op === "add_hypothesis_node") {
    const branchCount = nodes.filter((node) => node.nodeKind === "hypothesis" && node.parentNodeId === patch.parentNodeId).length;
    const totalBranches = nodes.filter((node) => node.nodeKind === "hypothesis").length;
    if (maxBranchesPerAspect && branchCount >= maxBranchesPerAspect) {
      return `parent ${patch.parentNodeId} already has ${branchCount}/${maxBranchesPerAspect} branches`;
    }
    if (maxInitialAgentNodes && totalBranches >= maxInitialAgentNodes) {
      return `total branch/agent count is already ${totalBranches}/${maxInitialAgentNodes}`;
    }
  }
  if (patch.op === "move_report_node") {
    const moving = nodes.find((node) => node.nodeId === patch.reportNodeId);
    if (!moving || moving.parentNodeId === patch.toParentId) return undefined;
    if (moving.nodeKind === "aspect" && maxAspects) {
      const aspectCount = nodes.filter((node) => node.nodeKind === "aspect" && node.parentNodeId === patch.toParentId && node.nodeId !== moving.nodeId).length;
      if (aspectCount >= maxAspects) return `target parent already has ${aspectCount}/${maxAspects} aspects`;
    }
    if (moving.nodeKind === "hypothesis" && maxBranchesPerAspect) {
      const branchCount = nodes.filter((node) => node.nodeKind === "hypothesis" && node.parentNodeId === patch.toParentId && node.nodeId !== moving.nodeId).length;
      if (branchCount >= maxBranchesPerAspect) return `target aspect already has ${branchCount}/${maxBranchesPerAspect} branches`;
    }
  }
  return undefined;
}

function positiveLimit(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

async function wouldCreateCycle(ctx: PhaseContext, reportNodeId: string, targetParentId: string): Promise<boolean> {
  let cursor: string | null = targetParentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === reportNodeId) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    const node = await ctx.stack.kg.getReportNode(cursor);
    cursor = node?.parentNodeId ?? null;
  }
  return false;
}

async function createRepairTask(ctx: PhaseContext, patch: StructurePatch, reason: string): Promise<void> {
  const reportNodeId = "reportNodeId" in patch ? patch.reportNodeId : "parentNodeId" in patch ? patch.parentNodeId : "R_root";
  await createTask(ctx, {
    reportNodeId,
    title: `Review structure patch ${patch.op}`,
    objective: reason,
    priority: 60,
    acceptanceCriteria: ["Confirm the structure patch is supported by evidence before applying it."],
  });
}

async function createTask(ctx: PhaseContext, req: NewTaskRequest): Promise<TaskItem> {
  const now = isoNow(ctx.now);
  const task: TaskItem = {
    taskId: `T_repair_${shortId(req.title)}_${nowSuffix(now)}`,
    parentTaskId: req.parentTaskId ?? "T_root",
    reportNodeId: req.reportNodeId,
    title: req.title,
    objective: req.objective,
    status: "queued",
    priority: req.priority,
    branchId: `B_repair_${shortId(req.title)}_${nowSuffix(now)}`,
    acceptanceCriteria: req.acceptanceCriteria.length > 0 ? req.acceptanceCriteria : ["Complete the repair task."],
    createdAt: now,
    updatedAt: now,
  };
  await ctx.stack.ledger.upsert(task);
  await traceWrite(ctx, "ledger", "upsert", { task }, { taskId: task.taskId, reportNodeId: task.reportNodeId, branchId: task.branchId });
  return task;
}

async function requiredNode(ctx: PhaseContext, nodeId: string): Promise<ReportNode> {
  const node = await ctx.stack.kg.getReportNode(nodeId);
  if (!node) throw new Error(`ReportNode not found: ${nodeId}`);
  return node;
}

function emptyCoverage(): ReportNode["coverage"] {
  return { supportingCount: 0, contradictingCount: 0, openGapCount: 0 };
}

function nowSuffix(now: string): string {
  return now.replace(/\D/g, "").slice(8, 14);
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positiveOptional(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function requestedReportNodeIds(args: unknown): string[] {
  const raw = object(args);
  const ids = [
    stringOrUndefined(raw.reportNodeId),
    stringOrUndefined(raw.nodeId),
    ...(Array.isArray(raw.reportNodeIds) ? raw.reportNodeIds.map(stringOrUndefined) : []),
    ...(Array.isArray(raw.nodeIds) ? raw.nodeIds.map(stringOrUndefined) : []),
  ].filter((value): value is string => Boolean(value));
  return Array.from(new Set(ids));
}

function ok(toolName: string, startedAt: number, output: unknown): ToolCallResult {
  return { toolName, ok: true, output, durationMs: Date.now() - startedAt };
}

function fail(toolName: string, startedAt: number, error: string): ToolCallResult {
  return { toolName, ok: false, error, durationMs: Date.now() - startedAt };
}
