import type { ReportNode, ResearchRequirement, TaskItem } from "@deepresearch/contracts";
import { countedStudyTableMinimum } from "../counted-rows.js";
import { parseLlmJson } from "../infra/ai.js";
import { isoNow, shortId } from "../infra/ids.js";
import { ARCHITECT_SYSTEM_PROMPT } from "../prompts.js";
import { traceWrite, tracedLlmChat } from "../trace.js";
import { isGlobalSourcePublicationRequirement } from "../requirement-temporal.js";
import { explicitTopLevelSectionNames } from "../rendered-contracts.js";
import type { ArchitectTreePlan, PhaseContext } from "../types.js";

interface DebugTreeLimits {
  maxAspects?: number;
  maxBranchesPerAspect?: number;
  maxInitialAgentNodes?: number;
  maxSchedulableInitialNodes?: number;
}

const DEFAULT_DEBUG_MAX_ASPECTS = 2;
const DEFAULT_DEBUG_MAX_BRANCHES_PER_ASPECT = 2;

export async function architectTreePhase(ctx: PhaseContext): Promise<{ reportNodes: ReportNode[]; tasks: TaskItem[] }> {
  const rubric = ctx.state.globalRubric;
  if (!rubric) throw new Error("rubric required before architect-tree");
  const knowledge = await ctx.stack.kg.listKnowledgeNodes();
  const llmCfg = ctx.state.runtimeProfile.llm.architect;
  const schedulableNodes = schedulableInitialNodeCount(ctx);
  const recommendedNodes = recommendedInitialNodeCount(rubric.requirements ?? [], ctx.state.submission.userInput);
  const debugTreeLimit = positiveInteger(ctx.state.runtimeProfile.debug?.maxInitialAgentNodes);
  const debugLimits: DebugTreeLimits = {
    maxAspects: positiveInteger(ctx.state.runtimeProfile.debug?.maxAspects),
    maxBranchesPerAspect: positiveInteger(ctx.state.runtimeProfile.debug?.maxBranchesPerAspect),
    maxInitialAgentNodes: positiveInteger(ctx.state.runtimeProfile.debug?.maxInitialAgentNodes),
    maxSchedulableInitialNodes: Math.min(
      schedulableNodes ?? Number.POSITIVE_INFINITY,
      debugTreeLimit ?? recommendedNodes,
    ),
  };
  const response = await tracedLlmChat(ctx, "architect-tree", {
    system: ARCHITECT_SYSTEM_PROMPT,
    user: `User task:
${ctx.state.submission.userInput}

Global rubric:
${rubric.rubricText}

Structured requirements (every must requirement must map to at least one leaf):
${JSON.stringify(rubric.requirements ?? [], null, 2)}

Initial source map:
${knowledge.map((node) => `- ${node.nodeId} | ${node.sourceTier} | ${node.title} | ${node.summary.slice(0, 100)}`).join("\n")}

Planning constraints:
- ${debugLimits.maxInitialAgentNodes ? `Debug limit: create up to ${debugLimits.maxAspects ?? DEFAULT_DEBUG_MAX_ASPECTS} report aspect(s), up to ${debugLimits.maxBranchesPerAspect ?? DEFAULT_DEBUG_MAX_BRANCHES_PER_ASPECT} concrete leaf report sub-branch(es) per aspect, and no more than ${debugLimits.maxInitialAgentNodes} leaf sub-branches total.` : `Create one concrete leaf report sub-branch for each distinct user deliverable or evidence-bearing analysis requirement. This task has an execution budget of at most ${recommendedNodes} initial leaf sub-branches; do not pad the tree with generic timelines, definitions, or case-study branches unless the task actually requests them.`}
- For narrow factual tasks, create only 1-4 leaf report sub-branches and Agent node/task pairs.
- Prefer non-overlapping research tasks, but do not collapse distinct historical stages, mechanisms, evidence types, or counterarguments into one broad task.
- Preserve explicitly paired analytical perspectives (for example, "on the one hand ... on the other hand") as sibling evidence leaves under one parent section so each side receives direct research before bottom-up comparison.
- Do not split truly minor subquestions into separate tasks unless they are necessary for the user's rubric.
- Each leaf report sub-branch is represented in the JSON as one "hypothesis" item and should map to exactly one initial Agent task.
- The Agent task may later plan internal report tasks; do not model those internal tasks as separate initial subagents.
- For each initial Agent task, write 4-8 concrete acceptanceCriteria. Treat these as the planned internal report tasks for that Agent node.
- Each acceptance criterion should name one sub-claim, data point, mechanism, case, definition, or comparison that can become one cited reportlet fragment and later be merged back into its leaf report sub-branch.
- For consequential claims, include acceptance criteria for an authoritative/primary source, independent corroboration, full-source inspection, and a counterevidence or boundary check. Do not count multiple URLs from one publisher as independent evidence.
- When an owned requirement has sourcePolicy.mode="named_primary_sufficient", inspect and quote that exact canonical document deeply. Do not add an independent-source criterion merely to satisfy a generic source count; additional sources remain allowed only when they answer a real unresolved claim.
- Avoid generic criteria such as "save evidence"; say what should be searched and what the resulting reusable reportlet should explain.
- Do not invent or lock in factual percentages, dates, quantities, article/section numbers, or target values that the user did not explicitly provide. Frame unknown values and legal locations as questions to verify; a hypothesis must remain falsifiable by the retrieved source.
- Copy the exact requirementId values into aspect.requirementIds and hypothesis.requirementIds. Every priority=must requirement must be mapped, but language, citation, blocked-source, heading, and report-format requirements are ancillary constraints on real research leaves and must never receive their own search leaf.
- For a study-review table, partition work by study population, methodology, geography, or another row-level dimension. Never partition research leaves by output columns such as country, sample size, outcome, or effectiveness label: each row-producing leaf must fill every requested column for its own studies.
- For any named entity comparison table, assign every entity to exactly one row-producing leaf, follow the grouping requested by the user, and list the exact entity names in that leaf's hypothesis, task objective, or acceptance criteria. Never create one leaf per output column; every entity row must fill every requested field.
- When entityScopeRole="groups", the named values are discovery categories rather than final rows. Create one bounded leaf per group; each leaf must discover multiple concrete members, verify membership, and produce complete cited rows for all requested fields. Do not turn the group label itself into a table row or invent a fixed member quota.
- For repeated named case-study/profile/category sections, normally create one leaf per requested entity (or a bounded entity group when debug limits require it). List exact entity names in the leaf task, cover every repeated field for that entity, and preserve the user's requested section order. If a summary table is also required, reuse each entity's complete evidence for both its detailed section and its table row.
- If an abstract top-level section count conflicts with a longer complete First/Second/Finally or 首先/其次/最后 sequence of substantive outputs, preserve each concrete sequence component as an aspect. Do not collapse the final named analysis/output merely to satisfy the smaller inconsistent count.
- Treat a global source-publication cutoff as an eligibility rule on every relevant evidence leaf, not as a standalone research topic. Preserve its propagated temporalScope when mapping the substantive requirements.

Output schema:
{"aspects":[{"label":string,"scopeNote":string,"requirementIds":string[],"hypotheses":[{"statement":string,"researchBrief":string,"evidenceGuidance":string,"requirementIds":string[]}],"tasks":[{"title":string,"objective":string,"acceptanceCriteria":string[]}]}]}`,
    json: true,
    ...llmCfg,
  });
  const plan = normalizePlan(
    parseLlmJson<ArchitectTreePlan>("architect-tree", ctx.stack.llm.name, response, () => fallbackPlan(ctx.state.submission.userInput)),
    ctx.state.submission.userInput,
    rubric.rubricText,
    debugLimits,
    rubric.requirements ?? [],
  );
  const now = isoNow(ctx.now);
  const reportNodes: ReportNode[] = [];
  const tasks: TaskItem[] = [];
  const requirementLeafCounts = requirementMappingCounts(plan);
  let aspectIndex = 0;
  let hypIndex = 0;
  for (const aspect of plan.aspects) {
    aspectIndex += 1;
    const aspectId = `R_aspect_${aspectIndex}`;
    const aspectNode: ReportNode = {
      nodeId: aspectId,
      nodeKind: "aspect",
      label: aspect.label,
      parentNodeId: "R_root",
      scopeNote: aspect.scopeNote,
      status: "planned",
      requirementIds: aspect.requirementIds,
      coverage: { supportingCount: 0, contradictingCount: 0, openGapCount: 0 },
      createdAt: now,
      updatedAt: now,
    };
    await ctx.stack.kg.upsertReportNode(aspectNode);
    await traceWrite(ctx, "kg", "upsertReportNode", { node: aspectNode }, { reportNodeId: aspectNode.nodeId });
    reportNodes.push(aspectNode);
    for (let i = 0; i < aspect.hypotheses.length; i++) {
      hypIndex += 1;
      const hyp = aspect.hypotheses[i]!;
      const taskSpec = aspect.tasks[i] ?? aspect.tasks[0] ?? {
        title: `Research ${aspect.label}`,
        objective: hyp.researchBrief,
        acceptanceCriteria: ["Find supporting or contradicting evidence."],
      };
      const aligned = alignSingleRequirementLeaf(hyp, taskSpec, rubric.requirements ?? [], requirementLeafCounts);
      const hypId = `R_hyp_${hypIndex}`;
      const hypNode: ReportNode = {
        nodeId: hypId,
        nodeKind: "hypothesis",
        label: compactHypothesisLabel(aligned.hypothesis.statement),
        parentNodeId: aspectId,
        scopeNote: aligned.hypothesis.researchBrief,
        status: "planned",
        requirementIds: aligned.hypothesis.requirementIds,
        hypothesis: aligned.hypothesis,
        coverage: { supportingCount: 0, contradictingCount: 0, openGapCount: 0 },
        createdAt: now,
        updatedAt: now,
      };
      const task: TaskItem = {
        taskId: `T_${shortId(aligned.task.title)}_${hypIndex}`,
        parentTaskId: "T_root",
        reportNodeId: hypId,
        title: aligned.task.title,
        objective: aligned.task.objective,
        requirementIds: aligned.hypothesis.requirementIds,
        status: "queued",
        priority: 90 - hypIndex,
        branchId: `B_${shortId(aligned.task.title)}_${hypIndex}`,
        acceptanceCriteria: nonEmptyCriteria(aligned.task.acceptanceCriteria, aligned.task.objective || aligned.hypothesis.researchBrief),
        createdAt: now,
        updatedAt: now,
      };
      await ctx.stack.kg.upsertReportNode(hypNode);
      await traceWrite(ctx, "kg", "upsertReportNode", { node: hypNode }, { taskId: task.taskId, reportNodeId: hypNode.nodeId, branchId: task.branchId });
      await ctx.stack.ledger.upsert(task);
      await traceWrite(ctx, "ledger", "upsert", { task }, { taskId: task.taskId, reportNodeId: task.reportNodeId, branchId: task.branchId });
      reportNodes.push(hypNode);
      tasks.push(task);
    }
  }
  await ctx.emit({ eventType: "architect_tree_created", payload: { aspectCount: aspectIndex, hypothesisCount: hypIndex } });
  return { reportNodes, tasks };
}

export function compactHypothesisLabel(statement: string, maxLength = 80): string {
  const normalized = statement.replace(/\s+/gu, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  const prefix = normalized.slice(0, maxLength);
  const clauseBoundaries = Array.from(prefix.matchAll(/[。！？；，.!?;,]/gu))
    .map((match) => match.index ?? -1)
    .filter((index) => index >= Math.min(24, Math.floor(maxLength * 0.4)));
  const clauseEnd = clauseBoundaries.at(-1);
  if (clauseEnd !== undefined) return prefix.slice(0, clauseEnd).trim();

  const topicBoundary = prefix.match(/^(.{16,}?)(?:需要|应当|必须|旨在|表明|显示|规定|包括|涉及|聚焦|可从|可以从|应从|需从|is\b|are\b|requires?\b)/iu)?.[1];
  if (topicBoundary?.trim()) return topicBoundary.trim();

  const latinWordBoundary = prefix.search(/\s+\S*$/u);
  if (latinWordBoundary >= Math.min(24, Math.floor(maxLength * 0.4))) {
    return prefix.slice(0, latinWordBoundary).trim();
  }

  return `${prefix.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function requirementMappingCounts(plan: ArchitectTreePlan): Map<string, number> {
  const counts = new Map<string, number>();
  for (const hypothesis of plan.aspects.flatMap((aspect) => aspect.hypotheses)) {
    for (const requirementId of new Set(hypothesis.requirementIds ?? [])) {
      counts.set(requirementId, (counts.get(requirementId) ?? 0) + 1);
    }
  }
  return counts;
}

function alignSingleRequirementLeaf(
  hypothesis: ArchitectTreePlan["aspects"][number]["hypotheses"][number],
  task: ArchitectTreePlan["aspects"][number]["tasks"][number],
  requirements: ResearchRequirement[],
  mappingCounts: Map<string, number>,
): { hypothesis: typeof hypothesis; task: typeof task } {
  const requirementById = new Map(requirements.map((requirement) => [requirement.requirementId, requirement]));
  const substantive = (hypothesis.requirementIds ?? [])
    .map((requirementId) => requirementById.get(requirementId))
    .filter((requirement): requirement is ResearchRequirement => Boolean(
      requirement
      && requirement.evidenceRequired !== false
      && requirement.visibility !== "internal"
      && (!['constraint', 'deliverable'].includes(requirement.kind) || requirement.sourcePolicy?.mode === "named_primary_sufficient")
      && !isReportMetaRequirement(requirement),
    ));
  if (
    substantive.length !== 1
    || mappingCounts.get(substantive[0]!.requirementId) !== 1
    || substantive[0]!.sourcePolicy?.mode !== "named_primary_sufficient"
  ) {
    return { hypothesis, task };
  }
  const requirement = substantive[0]!;
  const statement = requirement.description.trim();
  const namedSource = singleNamedPrimarySource([requirement]);
  return {
    hypothesis: {
      ...hypothesis,
      statement,
      researchBrief: `Research and verify only this owned requirement: ${statement}`,
      evidenceGuidance: namedSource
        ? `Inspect the complete canonical source "${namedSource.title}" and extract directly supporting passages for this requirement.`
        : requirement.evidenceNeeds.join("; ") || hypothesis.evidenceGuidance,
    },
    task: {
      title: compactHypothesisLabel(statement, 72),
      objective: `Research and verify: ${statement}`,
      acceptanceCriteria: requirementTaskCriteria([requirement]),
    },
  };
}

function fallbackPlan(userInput: string): ArchitectTreePlan {
  return {
    aspects: [{
      label: "Core Evidence",
      scopeNote: "Verify the core research question with evidence.",
      hypotheses: [{
        statement: `${userInput.slice(0, 80)} requires evidence-backed analysis.`,
        researchBrief: "Collect evidence for the main research question and identify uncertainty.",
        evidenceGuidance: "Prefer official, primary, or high-quality secondary sources.",
      }],
      tasks: [{
        title: "Verify core research question",
        objective: "Find support, contradiction, or evidence gaps for the core research question.",
        acceptanceCriteria: ["At least one credible evidence source or explicit gap."],
      }],
    }],
  };
}

export function normalizePlan(
  plan: ArchitectTreePlan,
  userInput: string,
  rubricText: string,
  debugLimits: DebugTreeLimits = {},
  requirements: ResearchRequirement[] = [],
): ArchitectTreePlan {
  const aspects = Array.isArray(plan.aspects) && plan.aspects.length > 0 ? plan.aspects : fallbackPlan("Research task").aspects;
  const isBroad = broadResearchTask(userInput, rubricText);
  const debugMode = Boolean(debugLimits.maxInitialAgentNodes || debugLimits.maxAspects || debugLimits.maxBranchesPerAspect);
  const sectionContract = explicitSectionContract(requirements, userInput);
  const requiredSectionCount = sectionContract?.length ?? 0;
  const configuredMaxAspects = debugMode
    ? Math.min(debugLimits.maxAspects ?? DEFAULT_DEBUG_MAX_ASPECTS, DEFAULT_DEBUG_MAX_ASPECTS)
    : 6;
  // An explicit report contract is a hard structural requirement. Scheduler
  // capacity may limit how many leaves run concurrently, but it must never
  // erase named top-level sections from the tree.
  const maxAspects = Math.max(configuredMaxAspects, requiredSectionCount);
  const maxBranchesPerAspect = debugMode
    ? Math.min(debugLimits.maxBranchesPerAspect ?? DEFAULT_DEBUG_MAX_BRANCHES_PER_ASPECT, DEFAULT_DEBUG_MAX_BRANCHES_PER_ASPECT)
    : Number.POSITIVE_INFINITY;
  const debugBranchLimit = maxAspects * maxBranchesPerAspect;
  const maxInitialAgentNodes = debugMode
    ? Math.min(debugLimits.maxInitialAgentNodes ?? debugBranchLimit, debugBranchLimit)
    : debugLimits.maxInitialAgentNodes;
  const maxHypotheses = Math.max(requiredSectionCount, Math.min(
    maxInitialAgentNodes ?? (isBroad ? 18 : 8),
    debugLimits.maxSchedulableInitialNodes ?? Number.POSITIVE_INFINITY,
  ));
  const sectionRecovered = recoverExplicitTopLevelSectionPlan(
    aspects,
    sectionContract,
    requirements,
    maxAspects,
    maxHypotheses,
  );
  let remainingHypotheses = maxHypotheses;
  const normalized = sectionRecovered.slice(0, maxAspects).map((aspect) => {
    const branchLimit = Math.min(maxBranchesPerAspect, Math.max(0, remainingHypotheses));
    const hypotheses = (aspect.hypotheses ?? []).slice(0, branchLimit).map((hyp) => ({
      statement: hyp.statement || "Hypothesis requires verification.",
      researchBrief: hyp.researchBrief || "Research this hypothesis.",
      evidenceGuidance: hyp.evidenceGuidance || "Search for credible evidence.",
      requirementIds: validRequirementIds(hyp.requirementIds, requirements),
    }));
    remainingHypotheses -= hypotheses.length;
    const tasks = (aspect.tasks ?? []).slice(0, hypotheses.length).map((task) => {
      const title = stringValue(task.title) || "Research task";
      const objective = stringValue(task.objective) || "Find evidence.";
      return {
        title,
        objective,
        acceptanceCriteria: nonEmptyCriteria(task.acceptanceCriteria, objective),
      };
    });
    return {
      label: aspect.label || "Research Aspect",
      scopeNote: aspect.scopeNote || "Research scope.",
      requirementIds: validRequirementIds(aspect.requirementIds, requirements),
      hypotheses,
      tasks,
    };
  }).filter((aspect) => aspect.hypotheses.length > 0);
  const shaped = normalizedPlanWithTasks(normalized.length > 0 ? normalized : fallbackPlan("Research task").aspects);
  const assigned = assignRequirements(sanitizeUnverifiedPlanFacts(shaped, userInput), requirements);
  if (debugMode) return assigned;
  const researchShaped = removeMetaOnlyLeaves(assigned, requirements);
  const perspectiveExpanded = expandExplicitDualPerspectiveLeaves(researchShaped, requirements, maxHypotheses);
  const factorAligned = mergeInfluencingFactorQuestionDeliverableLeaves(perspectiveExpanded, requirements);
  const studyReviewExpanded = expandStudyReviewMethodologyGroups(factorAligned, requirements, maxHypotheses, `${userInput}\n${rubricText}`);
  const studyReviewAligned = mergeDuplicateStudyReviewOverallLeaves(studyReviewExpanded, requirements);
  const categoryExpanded = expandPairedCategoryDeliverables(assignRequirements(studyReviewAligned, requirements), requirements, maxHypotheses);
  const taxonomyExpanded = expandOpenTaxonomyGroups(assignRequirements(categoryExpanded, requirements), requirements, maxHypotheses);
  const entityAligned = alignEntityDistributedRequirements(assignRequirements(taxonomyExpanded, requirements), requirements);
  const entityExpanded = expandEnumeratedDeliverableEntities(
    assignRequirements(entityAligned, requirements),
    requirements,
    maxHypotheses,
  );
  const requirementExpanded = expandRequirementDenseLeaves(assignRequirements(entityExpanded, requirements), requirements, maxHypotheses);
  const taxonomyFinal = expandOpenTaxonomyGroups(assignRequirements(requirementExpanded, requirements), requirements, maxHypotheses);
  return mergeTrueDuplicateRequirementLeaves(taxonomyFinal, requirements);
}

/**
 * Collapses planner-duplicated leaves that own the exact same requirement set
 * with materially identical scope text (e.g. one "comprehensive analysis" leaf
 * re-created under every aspect). Each such duplicate used to become its own
 * evidence agent, multiplying cost for zero coverage. Entity/member-sharded
 * leaves (entityScope/exampleScope) and perspective splits are never merged:
 * they share requirement IDs by design but research different slices.
 */
function mergeTrueDuplicateRequirementLeaves(plan: ArchitectTreePlan, requirements: ResearchRequirement[]): ArchitectTreePlan {
  const partitionedRequirementIds = new Set(
    requirements
      .filter((requirement) => (requirement.entityScope?.length ?? 0) > 0 || (requirement.exampleScope?.length ?? 0) > 0)
      .map((requirement) => requirement.requirementId),
  );
  interface LeafRef { aspectIndex: number; leafIndex: number; signature: string; statementKey: string }
  const leaves: LeafRef[] = [];
  plan.aspects.forEach((aspect, aspectIndex) => {
    aspect.hypotheses.forEach((hypothesis, leafIndex) => {
      const signature = [...new Set(hypothesis.requirementIds ?? [])].sort().join("|");
      leaves.push({ aspectIndex, leafIndex, signature, statementKey: normalizedText(hypothesis.statement) });
    });
  });
  const drop = new Set<number>();
  const keptByKey = new Map<string, number>();
  leaves.forEach((leaf, index) => {
    if (!leaf.signature) return;
    if (leaf.signature.split("|").some((id) => partitionedRequirementIds.has(id))) return;
    const key = `${leaf.signature}::${leaf.statementKey}`;
    if (!keptByKey.has(key)) {
      keptByKey.set(key, index);
      return;
    }
    // Never empty an aspect: its top-level section may be a user contract.
    if ((plan.aspects[leaf.aspectIndex]?.hypotheses.length ?? 0) <= 1) return;
    drop.add(index);
  });
  if (drop.size === 0) return plan;
  const aspects = plan.aspects.flatMap((aspect, aspectIndex) => {
    const keep = aspect.hypotheses
      .map((_, leafIndex) => leaves.findIndex((leaf) => leaf.aspectIndex === aspectIndex && leaf.leafIndex === leafIndex))
      .filter((flatIndex) => flatIndex >= 0 && !drop.has(flatIndex));
    if (keep.length === 0) return [];
    return [{
      ...aspect,
      hypotheses: keep.map((flatIndex) => aspect.hypotheses[leaves[flatIndex]!.leafIndex]!),
      tasks: keep.map((flatIndex) => aspect.tasks[Math.min(leaves[flatIndex]!.leafIndex, aspect.tasks.length - 1)]!).filter(Boolean),
    }];
  });
  return { ...plan, aspects };
}

function explicitSectionContract(requirements: ResearchRequirement[], userInput: string): string[] | undefined {
  const contract = requirements.find((requirement) => requirement.requirementId === "RQ_TOP_LEVEL_SECTION_CONTRACT");
  const scoped = contract?.entityScope?.map((section) => section.trim()).filter(Boolean);
  return scoped && scoped.length >= 2 ? uniqueStrings(scoped) : explicitTopLevelSectionNames(userInput);
}

function recoverExplicitTopLevelSectionPlan(
  aspects: ArchitectTreePlan["aspects"],
  sections: string[] | undefined,
  requirements: ResearchRequirement[],
  maxAspects: number,
  maxHypotheses: number,
): ArchitectTreePlan["aspects"] {
  if (!sections || sections.length < 2 || sections.length > maxAspects || sections.length > maxHypotheses) return aspects;

  const assignments = requirementsAssignedToExplicitSections(sections, requirements);
  const recovered = sections.map((section, sectionIndex) => {
    const owned = assignments[sectionIndex] ?? [];
    const evidenceOwned = owned.filter((requirement) => requirement.evidenceRequired !== false && !isReportMetaRequirement(requirement));
    const requirementIds = uniqueStrings(owned.map((requirement) => requirement.requirementId));
    const evidenceNeeds = uniqueStrings(evidenceOwned.flatMap((requirement) => requirement.evidenceNeeds));
    const description = evidenceOwned.map((requirement) => requirement.description).join(" ");
    const existing = bestExistingSectionAspect(section, aspects);
    const fallbackHypothesis = existing?.hypotheses[0];
    const fallbackTask = existing?.tasks[0];
    const statement = description || fallbackHypothesis?.statement || `${section} requires evidence-backed analysis.`;
    const objective = description
      ? `Research and write the complete ${section} section, covering every owned requirement: ${description}`
      : fallbackTask?.objective || `Research and write the complete ${section} section.`;
    const criteria = evidenceOwned.length > 0
      ? requirementTaskCriteria(evidenceOwned)
      : nonEmptyCriteria(fallbackTask?.acceptanceCriteria, objective);
    return {
      label: section,
      scopeNote: description || existing?.scopeNote || `Research and synthesize the ${section} section.`,
      requirementIds,
      hypotheses: [{
        statement,
        researchBrief: objective,
        evidenceGuidance: evidenceNeeds.length > 0
          ? `Find direct, citable evidence for: ${evidenceNeeds.join("; ")}`
          : fallbackHypothesis?.evidenceGuidance || "Prefer official, primary, or high-quality academic sources.",
        requirementIds,
      }],
      tasks: [{
        title: `Research and write ${section}`,
        objective,
        acceptanceCriteria: criteria,
      }],
    };
  });

  // With a tight scheduler, one complete leaf per required section is the only
  // shape that preserves the user's top-level contract. Larger runs may spend
  // spare leaf capacity on the model's more detailed section sub-branches.
  let spareLeaves = maxHypotheses - recovered.length;
  if (spareLeaves <= 0) return recovered;
  const candidates = aspects.flatMap((aspect) => aspect.hypotheses.map((hypothesis, hypothesisIndex) => ({
    aspect,
    hypothesis,
    task: aspect.tasks[hypothesisIndex] ?? aspect.tasks[0],
    sectionIndex: bestSectionIndex(`${aspect.label} ${aspect.scopeNote} ${hypothesis.statement} ${hypothesis.researchBrief}`, sections),
  }))).filter((candidate) => candidate.sectionIndex >= 0);
  let candidateIndex = 0;
  while (spareLeaves > 0 && candidateIndex < candidates.length) {
    const candidate = candidates[candidateIndex++]!;
    const target = recovered[candidate.sectionIndex]!;
    if (target.hypotheses.some((hypothesis) => normalizedText(hypothesis.statement) === normalizedText(candidate.hypothesis.statement))) continue;
    target.hypotheses.push({
      ...candidate.hypothesis,
      requirementIds: validRequirementIds(candidate.hypothesis.requirementIds, requirements),
    });
    target.tasks.push(candidate.task ?? {
      title: `Research ${target.label}`,
      objective: candidate.hypothesis.researchBrief,
      acceptanceCriteria: nonEmptyCriteria([], candidate.hypothesis.researchBrief),
    });
    spareLeaves -= 1;
  }
  return recovered;
}

function requirementsAssignedToExplicitSections(
  sections: string[],
  requirements: ResearchRequirement[],
): ResearchRequirement[][] {
  const assignments = sections.map((): ResearchRequirement[] => []);
  for (const requirement of requirements) {
    if (isGlobalSourcePublicationRequirement(requirement) || isReportMetaRequirement(requirement)) continue;
    const text = [
      requirement.description,
      ...requirement.successCriteria,
      ...requirement.evidenceNeeds,
    ].join(" ");
    const sectionIndex = bestSectionIndex(text, sections);
    if (sectionIndex >= 0) assignments[sectionIndex]!.push(requirement);
  }
  return assignments;
}

function bestExistingSectionAspect(
  section: string,
  aspects: ArchitectTreePlan["aspects"],
): ArchitectTreePlan["aspects"][number] | undefined {
  return aspects
    .map((aspect, index) => ({ aspect, index, score: lexicalOverlap(section, `${aspect.label} ${aspect.scopeNote}`) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.aspect;
}

function bestSectionIndex(text: string, sections: string[]): number {
  const ranked = sections
    .map((section, index) => ({ index, score: lexicalOverlap(section, text) }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  return ranked[0]?.score ? ranked[0].index : -1;
}

function normalizedText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function sanitizeUnverifiedPlanFacts(plan: ArchitectTreePlan, userInput: string): ArchitectTreePlan {
  const sanitize = (value: string, hypothesis = false): string => {
    let changed = false;
    let output = value.replace(/\bArticle\s+\d+[A-Za-z]?(?:\(\d+\))?|第\s*\d+\s*条/giu, (match) => {
      if (userInput.toLowerCase().includes(match.toLowerCase())) return match;
      changed = true;
      return /第/u.test(match) ? "相关条款" : "the applicable article";
    });
    output = output.replace(/\b\d+(?:[.,]\d+)?\s*[%％]/gu, (match) => {
      if (userInput.replace(/\s+/gu, "").includes(match.replace(/\s+/gu, ""))) return match;
      changed = true;
      return /[\p{Script=Han}]/u.test(value) ? "待核实百分比" : "the exact percentage to verify";
    });
    output = output.replace(/\b(?:19|20)\d{2}(?:年)?/gu, (match, offset: number, full: string) => {
      if (full[offset + match.length] === "/") return match;
      const year = match.match(/(?:19|20)\d{2}/u)?.[0] ?? match;
      if (hasStandaloneUserNumber(userInput, year)) return match;
      changed = true;
      return /年/u.test(match) || /[\p{Script=Han}]/u.test(value) ? "待核实年份" : "the applicable year";
    });
    if (!changed) return output;
    output = output
      .replace(/确认/gu, "核实")
      .replace(/\bconfirm\b/giu, "verify")
      .replace(/(?:待核实年份\s*){2,}/gu, "待核实年份")
      .replace(/(?:待核实百分比\s*){2,}/gu, "待核实百分比")
      .replace(/\s+/gu, " ")
      .trim();
    return hypothesis ? `${/[\p{Script=Han}]/u.test(value) ? "待核实：" : "To verify: "}${output}` : output;
  };
  return {
    aspects: plan.aspects.map((aspect) => ({
      ...aspect,
      label: sanitize(aspect.label),
      scopeNote: sanitize(aspect.scopeNote),
      hypotheses: aspect.hypotheses.map((hypothesis) => ({
        ...hypothesis,
        statement: sanitize(hypothesis.statement, true),
        researchBrief: sanitize(hypothesis.researchBrief, true),
        evidenceGuidance: sanitize(hypothesis.evidenceGuidance, true),
      })),
      tasks: aspect.tasks.map((task) => ({
        ...task,
        title: sanitize(task.title),
        objective: sanitize(task.objective, true),
        acceptanceCriteria: task.acceptanceCriteria.map((criterion) => sanitize(criterion, true)),
      })),
    })),
  };
}

function hasStandaloneUserNumber(userInput: string, value: string): boolean {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?<![\\d/])${escaped}(?![\\d/])`, "u").test(userInput);
}

function expandExplicitDualPerspectiveLeaves(
  plan: ArchitectTreePlan,
  requirements: ResearchRequirement[],
  maxHypotheses: number,
): ArchitectTreePlan {
  const requirementById = new Map(requirements.map((requirement) => [requirement.requirementId, requirement]));
  const mappedLeafCounts = new Map<string, number>();
  for (const aspect of plan.aspects) {
    for (const hypothesis of aspect.hypotheses) {
      for (const id of hypothesis.requirementIds ?? []) mappedLeafCounts.set(id, (mappedLeafCounts.get(id) ?? 0) + 1);
    }
  }
  let totalLeaves = plan.aspects.reduce((sum, aspect) => sum + aspect.hypotheses.length, 0);
  return {
    aspects: plan.aspects.map((aspect) => {
      const hypotheses: ArchitectTreePlan["aspects"][number]["hypotheses"] = [];
      const tasks: ArchitectTreePlan["aspects"][number]["tasks"] = [];
      for (let index = 0; index < aspect.hypotheses.length; index += 1) {
        const hypothesis = aspect.hypotheses[index]!;
        const task = aspect.tasks[index] ?? aspect.tasks[0] ?? {
          title: `Research ${aspect.label}`,
          objective: hypothesis.researchBrief,
          acceptanceCriteria: [],
        };
        const owners = (hypothesis.requirementIds ?? []).flatMap((id) => {
          const requirement = requirementById.get(id);
          return requirement && isLeafOwningRequirement(requirement) ? [requirement] : [];
        });
        const requirement = owners.length === 1 ? owners[0] : undefined;
        const perspectives = requirement ? explicitPerspectiveCriteria(requirement) : [];
        if (
          !requirement
          || !["question", "comparison", "deliverable"].includes(requirement.kind)
          || (mappedLeafCounts.get(requirement.requirementId) ?? 0) !== 1
          || perspectives.length !== 2
          || totalLeaves >= maxHypotheses
        ) {
          hypotheses.push(hypothesis);
          tasks.push(task);
          continue;
        }
        totalLeaves += 1;
        for (const perspective of perspectives) {
          hypotheses.push({
            ...hypothesis,
            statement: `${requirement.requirementId} perspective: ${perspective}`,
            researchBrief: `Research and write a cited reportlet for this required analytical perspective: ${perspective}. The parent section will compare and synthesize both explicit perspectives.`,
            evidenceGuidance: `Find direct primary or authoritative evidence for ${perspective}. Establish mechanisms, historical context, consequences, and limitations where relevant. Do not substitute evidence assigned to the sibling perspective.`,
          });
          tasks.push({
            title: `${requirement.requirementId}: ${perspective}`.slice(0, 120),
            objective: `Produce an evidence-backed reportlet for this explicit perspective: ${perspective}.`,
            acceptanceCriteria: [
              `Directly substantiate this perspective: ${perspective}.`,
              "Do not treat the sibling perspective assigned to the parallel leaf as a substitute.",
              "Explain relevant mechanisms, actors, chronology, consequences, and qualifications rather than merely naming the perspective.",
              "Inspect at least one full primary, official, or authoritative scholarly source for the core claim.",
              "Write a reusable cited reportlet that the parent section can compare with its sibling without simplistic praise or condemnation.",
            ],
          });
        }
      }
      return { ...aspect, hypotheses, tasks };
    }),
  };
}

function explicitPerspectiveCriteria(requirement: ResearchRequirement): string[] {
  return requirement.successCriteria.flatMap((criterion) => {
    const match = criterion.match(/^Research this explicit perspective separately:\s*(.+?)\.?$/iu);
    return match?.[1]?.trim() ? [match[1].trim()] : [];
  }).filter((perspective, index, all) => all.findIndex((candidate) => candidate.toLocaleLowerCase() === perspective.toLocaleLowerCase()) === index);
}

function expandOpenTaxonomyGroups(
  plan: ArchitectTreePlan,
  requirements: ResearchRequirement[],
  maxHypotheses: number,
): ArchitectTreePlan {
  const requirementById = new Map(requirements.map((requirement) => [requirement.requirementId, requirement]));
  const mappedLeafCounts = new Map<string, number>();
  for (const aspect of plan.aspects) {
    for (const hypothesis of aspect.hypotheses) {
      for (const id of hypothesis.requirementIds ?? []) mappedLeafCounts.set(id, (mappedLeafCounts.get(id) ?? 0) + 1);
    }
  }
  let totalLeaves = plan.aspects.reduce((sum, aspect) => sum + aspect.hypotheses.length, 0);
  return {
    aspects: plan.aspects.map((aspect) => {
      const hypotheses: ArchitectTreePlan["aspects"][number]["hypotheses"] = [];
      const tasks: ArchitectTreePlan["aspects"][number]["tasks"] = [];
      for (let index = 0; index < aspect.hypotheses.length; index += 1) {
        const hypothesis = aspect.hypotheses[index]!;
        const task = aspect.tasks[index] ?? aspect.tasks[0] ?? {
          title: `Research ${aspect.label}`,
          objective: hypothesis.researchBrief,
          acceptanceCriteria: [],
        };
        const owners = (hypothesis.requirementIds ?? []).flatMap((id) => {
          const requirement = requirementById.get(id);
          return requirement && isLeafOwningRequirement(requirement) ? [requirement] : [];
        });
        const requirement = owners.length === 1 ? owners[0] : undefined;
        const groups = requirement?.entityScopeRole === "groups"
          ? uniqueStrings((requirement.entityScope ?? []).map((value) => value.trim()).filter(Boolean))
          : [];
        if (
          !requirement
          || !["comparison", "deliverable"].includes(requirement.kind)
          || groups.length < 2
          || groups.length > 12
          || (mappedLeafCounts.get(requirement.requirementId) ?? 0) !== 1
          || totalLeaves + groups.length - 1 > maxHypotheses
        ) {
          hypotheses.push(hypothesis);
          tasks.push(task);
          continue;
        }
        const fields = uniqueStrings(requirement.metricScope ?? []);
        const fieldText = fields.length > 0 ? fields.join(", ") : "every requested field";
        totalLeaves += groups.length - 1;
        for (const group of groups) {
          hypotheses.push({
            ...hypothesis,
            statement: `${group}: discover and verify concrete members for ${requirement.requirementId}`,
            researchBrief: `Discover multiple distinct, named members of ${group} and write complete cited row-level material for each member. The parent section will merge all category reportlets bottom-up into the requested taxonomy or comparison table.`,
            evidenceGuidance: `Search authoritative inventories, standards, official references, or primary literature for ${group}. Verify that every candidate belongs to this category, deduplicate aliases, and fill ${fieldText} for each concrete member. Do not use the category label itself as a row and do not invent a member quota.`,
          });
          tasks.push({
            title: `${requirement.requirementId}: ${group}`.slice(0, 120),
            objective: `Discover and produce complete evidence-backed member rows for ${group} under ${requirement.requirementId}.`,
            acceptanceCriteria: [
              `Identify multiple distinct, named members of ${group}; ${group} is a grouping label, not a final row.`,
              `For every discovered member, fill all requested fields in the same row: ${fieldText}.`,
              `Verify category membership and deduplicate aliases, brands, or synonymous names before counting a member.`,
              "Use authoritative inventories, standards, official references, or primary literature for the core member set.",
              "Search for material omissions and boundary cases, but do not invent a numeric member quota not stated by the user.",
              "Mark an unsupported field as an evidence gap rather than guessing or borrowing a neighboring member's value.",
              "Preserve the applicable time boundary for every ordinary source.",
              "Write one cited reusable category reportlet whose complete member rows can be merged bottom-up.",
            ],
          });
        }
      }
      return { ...aspect, hypotheses, tasks };
    }),
  };
}

function removeMetaOnlyLeaves(plan: ArchitectTreePlan, requirements: ResearchRequirement[]): ArchitectTreePlan {
  const byId = new Map(requirements.map((requirement) => [requirement.requirementId, requirement]));
  const aspects = plan.aspects.flatMap((aspect) => {
    const keep = aspect.hypotheses.flatMap((hypothesis, index) => {
      const mapped = (hypothesis.requirementIds ?? []).flatMap((id) => {
        const requirement = byId.get(id);
        return requirement ? [requirement] : [];
      });
      return mapped.length > 0 && mapped.every((requirement) => !isLeafOwningRequirement(requirement)) ? [] : [index];
    });
    if (keep.length === 0) return [];
    const hypotheses = keep.map((index) => aspect.hypotheses[index]!);
    const tasks = keep.map((index) => aspect.tasks[index] ?? aspect.tasks[0]!).filter(Boolean);
    return [{
      ...aspect,
      hypotheses,
      tasks,
      requirementIds: uniqueStrings(hypotheses.flatMap((hypothesis) => hypothesis.requirementIds ?? [])),
    }];
  });
  return aspects.some((aspect) => aspect.hypotheses.length > 0) ? { aspects } : plan;
}

function mergeInfluencingFactorQuestionDeliverableLeaves(
  plan: ArchitectTreePlan,
  requirements: ResearchRequirement[],
): ArchitectTreePlan {
  const byId = new Map(requirements.map((requirement) => [requirement.requirementId, requirement]));
  const candidates = plan.aspects.flatMap((aspect, aspectIndex) => aspect.hypotheses.flatMap((hypothesis, hypothesisIndex) => {
    const mapped = (hypothesis.requirementIds ?? []).flatMap((id) => {
      const requirement = byId.get(id);
      return requirement && isLeafOwningRequirement(requirement) ? [requirement] : [];
    });
    return mapped.length === 1 && isInfluencingFactorRequirement(mapped[0]!)
      ? [{ aspectIndex, hypothesisIndex, hypothesis, task: aspect.tasks[hypothesisIndex] ?? aspect.tasks[0]!, requirement: mapped[0]! }]
      : [];
  }));
  const question = candidates.find((candidate) => candidate.requirement.kind === "question");
  const deliverable = candidates.find((candidate) => candidate.requirement.kind === "deliverable");
  const groupsByRequirement = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const group = groupsByRequirement.get(candidate.requirement.requirementId) ?? [];
    group.push(candidate);
    groupsByRequirement.set(candidate.requirement.requirementId, group);
  }
  const duplicatesByRequirement = Array.from(groupsByRequirement.values())
    .sort((left, right) => right.length - left.length)
    .find((group) => group.length >= 2);
  const mergeCandidates = question && deliverable ? candidates : duplicatesByRequirement;
  if (!mergeCandidates || mergeCandidates.length < 2) return plan;
  const keep = mergeCandidates[0]!;
  const prepared = mergeCandidates.map((candidate, index) => ({
    ...candidate,
    task: {
      ...candidate.task,
      ...(index === 0 ? {
        title: "Analyze influencing factors with mechanisms and citations",
        objective: uniqueStrings(mergeCandidates.map((item) => item.task.objective)).join(" "),
      } : {}),
      acceptanceCriteria: [
        `${candidate.task.title}: ${candidate.task.objective} Explain the mechanism and cite specific studies where required.`,
      ],
    },
  }));
  return mergeArchitectLeaves(plan, prepared, prepared[0] ?? keep);
}

function mergeDuplicateStudyReviewOverallLeaves(
  plan: ArchitectTreePlan,
  requirements: ResearchRequirement[],
): ArchitectTreePlan {
  if (!requirements.some((requirement) => countedStudyTableMinimum(requirement) !== undefined)
    || !requirements.some(isStudyMethodologySynthesisRequirement)) return plan;
  const overall = requirements.find((requirement) => (
    requirement.kind === "question"
    && isLeafOwningRequirement(requirement)
    && /\b(?:to what extent|overall conclusion)\b[^.\n]{0,160}\beffectiv/iu.test(requirement.description)
  ));
  if (!overall) return plan;
  const byId = new Map(requirements.map((requirement) => [requirement.requirementId, requirement]));
  const candidates = plan.aspects.flatMap((aspect, aspectIndex) => aspect.hypotheses.flatMap((hypothesis, hypothesisIndex) => {
    const mapped = (hypothesis.requirementIds ?? []).flatMap((id) => {
      const requirement = byId.get(id);
      return requirement && isLeafOwningRequirement(requirement) ? [requirement] : [];
    });
    return mapped.length === 1 && mapped[0]?.requirementId === overall.requirementId
      ? [{ aspectIndex, hypothesisIndex, hypothesis, task: aspect.tasks[hypothesisIndex] ?? aspect.tasks[0]!, requirement: mapped[0]! }]
      : [];
  }));
  return candidates.length >= 2 ? mergeArchitectLeaves(plan, candidates, candidates[0]!) : plan;
}

interface ArchitectLeafMergeCandidate {
  aspectIndex: number;
  hypothesisIndex: number;
  hypothesis: ArchitectTreePlan["aspects"][number]["hypotheses"][number];
  task: ArchitectTreePlan["aspects"][number]["tasks"][number];
  requirement: ResearchRequirement;
}

function mergeArchitectLeaves(
  plan: ArchitectTreePlan,
  candidates: ArchitectLeafMergeCandidate[],
  keep: ArchitectLeafMergeCandidate,
): ArchitectTreePlan {
  const keepKey = `${keep.aspectIndex}:${keep.hypothesisIndex}`;
  const candidateKeys = new Set(candidates.map((candidate) => `${candidate.aspectIndex}:${candidate.hypothesisIndex}`));
  const mergedRequirements = uniqueRequirements(candidates.map((candidate) => candidate.requirement));

  return {
    aspects: plan.aspects.flatMap((aspect, aspectIndex) => {
      const hypotheses: typeof aspect.hypotheses = [];
      const tasks: typeof aspect.tasks = [];
      for (let hypothesisIndex = 0; hypothesisIndex < aspect.hypotheses.length; hypothesisIndex += 1) {
        const key = `${aspectIndex}:${hypothesisIndex}`;
        if (candidateKeys.has(key) && key !== keepKey) continue;
        if (key === keepKey) {
          hypotheses.push({
            ...keep.hypothesis,
            statement: uniqueStrings(candidates.map((candidate) => candidate.hypothesis.statement)).join(" "),
            researchBrief: uniqueStrings(candidates.map((candidate) => candidate.hypothesis.researchBrief)).join(" "),
            evidenceGuidance: uniqueStrings(candidates.map((candidate) => candidate.hypothesis.evidenceGuidance)).join(" "),
            requirementIds: uniqueStrings(candidates.flatMap((candidate) => candidate.hypothesis.requirementIds ?? [])),
          });
          tasks.push({
            ...keep.task,
            acceptanceCriteria: uniqueStrings([
              ...candidates.flatMap((candidate) => candidate.task.acceptanceCriteria),
              ...requirementTaskCriteria(mergedRequirements),
            ]).slice(0, 8),
          });
          continue;
        }
        hypotheses.push(aspect.hypotheses[hypothesisIndex]!);
        tasks.push(aspect.tasks[hypothesisIndex] ?? aspect.tasks[0]!);
      }
      if (hypotheses.length === 0) return [];
      return [{
        ...aspect,
        hypotheses,
        tasks,
        requirementIds: uniqueStrings(hypotheses.flatMap((hypothesis) => hypothesis.requirementIds ?? [])),
      }];
    }),
  };
}

function uniqueRequirements(requirements: ResearchRequirement[]): ResearchRequirement[] {
  const seen = new Set<string>();
  return requirements.filter((requirement) => {
    if (seen.has(requirement.requirementId)) return false;
    seen.add(requirement.requirementId);
    return true;
  });
}

function expandStudyReviewMethodologyGroups(
  plan: ArchitectTreePlan,
  requirements: ResearchRequirement[],
  maxHypotheses: number,
  sourceText: string,
): ArchitectTreePlan {
  const tableRequirement = requirements.find((requirement) => countedStudyTableMinimum(requirement) !== undefined);
  const methodologyRequirement = requirements.find((requirement) => isStudyMethodologySynthesisRequirement(requirement));
  if (!tableRequirement || !methodologyRequirement || tableRequirement.requirementId === methodologyRequirement.requirementId) return plan;
  const methodologyCategories = studyMethodologyCategories(methodologyRequirement).length >= 3
    ? studyMethodologyCategories(methodologyRequirement)
    : describedStudyMethodologyCategories(sourceText).length >= 3
      ? describedStudyMethodologyCategories(sourceText)
      : [
        "cross-sectional perceptual surveys",
        "cross-sectional comparative studies",
        "longitudinal studies",
        "randomized controlled trials",
      ];
  const categories = studyReviewSearchGroups(tableRequirement);
  const studyCount = countedStudyTableMinimum(tableRequirement)!;
  const targetIds = new Set([tableRequirement.requirementId, methodologyRequirement.requirementId]);
  const byId = new Map(requirements.map((requirement) => [requirement.requirementId, requirement]));
  const candidates = plan.aspects.flatMap((aspect, aspectIndex) => aspect.hypotheses.flatMap((hypothesis, hypothesisIndex) => {
    const researchIds = (hypothesis.requirementIds ?? []).filter((id) => {
      const requirement = byId.get(id);
      return requirement ? isLeafOwningRequirement(requirement) : false;
    });
    const localText = `${hypothesis.statement} ${hypothesis.researchBrief} ${hypothesis.evidenceGuidance}`;
    const methodologyOnlyText = /categorize studies by research methodology|methodology influenced reported results|methodology-specific effectiveness/iu.test(localText);
    const eligible = researchIds.some((id) => targetIds.has(id))
      || (researchIds.length === 0 && methodologyOnlyText);
    return eligible ? [{ aspectIndex, hypothesisIndex, hypothesis, researchIds }] : [];
  }));
  if (candidates.length === 0) return plan;
  const currentLeaves = plan.aspects.reduce((sum, aspect) => sum + aspect.hypotheses.length, 0);
  const retainedMixedCandidates = candidates.filter((candidate) => candidate.researchIds.some((id) => !targetIds.has(id))).length;
  if (currentLeaves - candidates.length + retainedMixedCandidates + categories.length > maxHypotheses) return plan;

  const first = candidates[0]!;
  const candidateByKey = new Map(candidates.map((candidate) => [`${candidate.aspectIndex}:${candidate.hypothesisIndex}`, candidate]));
  const ancillaryIds = uniqueStrings(candidates.flatMap((candidate) => candidate.hypothesis.requirementIds ?? [])
    .filter((id) => {
      const requirement = byId.get(id);
      return !targetIds.has(id) && requirement !== undefined && !isLeafOwningRequirement(requirement);
    }));
  const fieldSummary = studyTableFieldSummary(tableRequirement.description);
  const temporal = tableRequirement.temporalScope;
  const temporalSummary = temporal?.mode === "range"
    ? `${temporal.start ?? "the stated start"} through ${temporal.end ?? "the stated end"}`
    : "the stated time scope";
  const baseQuota = Math.floor(studyCount / categories.length);
  const remainder = studyCount % categories.length;
  const categoryHypotheses = categories.map((category, index) => {
    const quota = baseQuota + (index < remainder ? 1 : 0);
    return {
      statement: `${category}: evidence-backed studies for ${tableRequirement.requirementId}`,
      researchBrief: `Research distinct ${category.toLowerCase()} for the review table. Produce complete row-level material for this geographic search group; the parent section will merge all groups and synthesize effectiveness by methodology bottom-up.`,
      evidenceGuidance: `Find primary studies in ${temporalSummary}. For every study, capture every requested table field${fieldSummary ? `: ${fieldSummary}` : ""}. Classify its design using ${methodologyCategories.join(", ")}, or explicitly record another design. Do not split work by columns and do not reuse studies assigned to sibling geographic groups.`,
      requirementIds: uniqueStrings([tableRequirement.requirementId, methodologyRequirement.requirementId, ...ancillaryIds]),
      quota,
    };
  });
  const categoryTasks = categoryHypotheses.map((hypothesis, index) => {
    const category = categories[index]!;
    return {
      title: `${tableRequirement.requirementId}: ${category}`.slice(0, 120),
      objective: `Produce complete evidence-backed review-table rows for ${category}, then a cited reportlet that preserves methodology and effectiveness fields for bottom-up synthesis.`,
      acceptanceCriteria: [
        `Aim to contribute about ${hypothesis.quota} distinct ${category.toLowerCase()}; this is a search allocation, not a per-region minimum. If the named geography is sparse, add eligible cross-regional studies not owned by sibling groups. Only the collective minimum of ${studyCount} studies is mandatory.`,
        `For every study, fill every requested field${fieldSummary ? `: ${fieldSummary}` : ""}; never create column-only fragments.`,
        `Verify that every included study falls within ${temporalSummary}.`,
        `Classify each study's design as ${methodologyCategories.join(", ")}, or explicitly record another design without forcing a scarce category quota.`,
        "Distinguish an author's explicit effectiveness conclusion from a transparent classification inferred from reported outcomes.",
        "Deduplicate studies by title or DOI and exclude studies owned by sibling geographic groups.",
        "Note how the observed methodology affects the strength or direction of each reported effectiveness finding.",
        "Inspect full primary sources for core rows and write a cited reusable reportlet for bottom-up synthesis.",
      ].slice(0, 8),
    };
  });

  const aspects = plan.aspects.flatMap((aspect, aspectIndex) => {
    const hypotheses: ArchitectTreePlan["aspects"][number]["hypotheses"] = [];
    const tasks: ArchitectTreePlan["aspects"][number]["tasks"] = [];
    for (let hypothesisIndex = 0; hypothesisIndex < aspect.hypotheses.length; hypothesisIndex += 1) {
      const key = `${aspectIndex}:${hypothesisIndex}`;
      if (key === `${first.aspectIndex}:${first.hypothesisIndex}`) {
        hypotheses.push(...categoryHypotheses.map(({ quota: _quota, ...hypothesis }) => hypothesis));
        tasks.push(...categoryTasks);
      }
      const originalHypothesis = aspect.hypotheses[hypothesisIndex]!;
      const candidate = candidateByKey.get(key);
      if (candidate) {
        if (candidate.researchIds.some((id) => !targetIds.has(id))) {
          hypotheses.push({
            ...originalHypothesis,
            requirementIds: (originalHypothesis.requirementIds ?? []).filter((id) => !targetIds.has(id)),
          });
          tasks.push(aspect.tasks[hypothesisIndex] ?? aspect.tasks[0]!);
        }
        continue;
      }
      hypotheses.push(originalHypothesis);
      tasks.push(aspect.tasks[hypothesisIndex] ?? aspect.tasks[0]!);
    }
    if (hypotheses.length === 0) return [];
    return [{
      ...aspect,
      label: aspectIndex === first.aspectIndex ? "Reviewed Studies by Geography" : aspect.label,
      scopeNote: aspectIndex === first.aspectIndex
        ? `Collect complete study rows by geographic search group and synthesize effectiveness by methodology from those reportlets.`
        : aspect.scopeNote,
      hypotheses,
      tasks,
      requirementIds: uniqueStrings(hypotheses.flatMap((hypothesis) => hypothesis.requirementIds ?? [])),
    }];
  });
  return { aspects };
}

function studyReviewSearchGroups(requirement: ResearchRequirement): string[] {
  const global = (requirement.geographicScope ?? []).some((scope) => /^(?:global|worldwide)$/iu.test(scope.trim()));
  if (global) return [
    "Asia-Pacific and Middle East studies",
    "European and African studies",
    "Americas and cross-regional studies",
  ];
  return ["study discovery batch A", "study discovery batch B", "study discovery batch C"];
}

function studyMethodologyCategories(requirement: ResearchRequirement): string[] {
  if (!isLeafOwningRequirement(requirement)) return [];
  return describedStudyMethodologyCategories(requirement.description);
}

function describedStudyMethodologyCategories(text: string): string[] {
  if (!/\b(?:methodolog|research\s+design)/iu.test(text)) return [];
  for (const match of text.matchAll(/\(([^()]*)\)/gu)) {
    const enumeration = (match[1] ?? "").replace(/^\s*(?:e\.?\s*g\.?|for example)\s*[,;:]?\s*/iu, "");
    const categories = splitEntityEnumeration(enumeration);
    if (categories.length >= 3 && categories.length <= 6 && categories.every((category) => (
      /\b(?:stud(?:y|ies)|surveys?|trials?|comparative|longitudinal|cross[- ]sectional|experimental)\b/iu.test(category)
    ))) return categories;
  }
  return [];
}

function isStudyMethodologySynthesisRequirement(requirement: ResearchRequirement): boolean {
  if (requirement.priority !== "must" || !requirement.evidenceRequired || isReportMetaRequirement(requirement)) return false;
  const text = `${requirement.description} ${requirement.successCriteria.join(" ")}`;
  return /\b(?:categor(?:ize|ise|izes|ises|ized|ised|ization|isation)|classif(?:y|ies|ied|ication))\b[^.\n]{0,100}\bstud(?:y|ies)\b[^.\n]{0,100}\b(?:methodolog|research\s+design)/iu.test(text)
    || /\bstud(?:y|ies)\b[^.\n]{0,100}\b(?:methodolog|research\s+design)\b[^.\n]{0,100}\b(?:influenc|affect|compar)/iu.test(text)
    || describedStudyMethodologyCategories(text).length >= 3;
}

function studyTableFieldSummary(description: string): string {
  return description.match(/\bcolumns?\s*:\s*(.+?)(?=\.\s*(?:Cover|Include|Use|All)\b|$)/iu)?.[1]?.trim() ?? "";
}

function schedulableInitialNodeCount(ctx: PhaseContext): number | undefined {
  const dispatch = ctx.state.runtimeProfile.phases.dispatchEvidence;
  const cycles = positiveInteger(dispatch?.maxCycles);
  const parallel = positiveInteger(dispatch?.maxParallelAgents ?? dispatch?.maxConcurrentAgents);
  return cycles && parallel ? cycles * parallel : undefined;
}

function recommendedInitialNodeCount(requirements: ResearchRequirement[], userInput: string): number {
  const evidenceRequirements = requirements.filter((requirement) => (
    requirement.evidenceRequired !== false
    && requirement.visibility !== "internal"
    && !isReportMetaRequirement(requirement)
  ));
  const explicitSections = explicitSectionContract(requirements, userInput)?.length ?? 0;
  const structuredFloor = evidenceRequirements.reduce((largest, requirement) => {
    const countedRows = countedStudyTableMinimum(requirement);
    const entityCount = (requirement.entityScope ?? []).filter((item) => item.trim()).length;
    const exampleCount = (requirement.exampleScope ?? []).filter((item) => item.trim()).length;
    const ownedSlices = requirement.entityScopeRole === "groups"
      ? entityCount
      : Math.max(entityCount, exampleCount);
    return Math.max(largest, countedRows ? Math.min(6, Math.ceil(countedRows / 3)) : 0, ownedSlices);
  }, explicitSections);
  // Keep one spare aggregate leaf while entity alignment runs. It carries
  // cross-entity table requirements that are then distributed into each
  // entity leaf before the redundant aggregate leaf is removed.
  const distributedEntityCount = enumeratedEntityGroups(evidenceRequirements)[0]?.length ?? 0;
  const distributedEntityFloor = distributedEntityCount > 0 ? distributedEntityCount + 1 : 0;
  const countedTableFloor = requirements.reduce((largest, requirement) => {
    const countedRows = countedStudyTableMinimum(requirement);
    return Math.max(largest, countedRows ? Math.min(6, Math.ceil(countedRows / 3)) : 0);
  }, 0);
  const enumeratedDeliverableFloor = evidenceRequirements.reduce((total, requirement) => {
    if (!["comparison", "deliverable"].includes(requirement.kind)) return total;
    const entities = enumeratedSubjects(requirement.description);
    return total + (entities.length >= 5 ? Math.ceil(entities.length / 3) : 0);
  }, 0);
  const factorFloor = evidenceRequirements.reduce((largest, requirement) => {
    if (!isInfluencingFactorRequirement(requirement)) return largest;
    return Math.max(largest, splitEntityEnumeration(requirement.description).length);
  }, 0);
  const complexFloor = Math.max(
    structuredFloor,
    distributedEntityFloor,
    countedTableFloor,
    enumeratedDeliverableFloor,
    factorFloor,
  );
  if (complexFloor > 0) return Math.min(18, Math.max(complexFloor, evidenceRequirements.length));

  // Rubric generation can expand a short exploratory question into many
  // requirements. That richer checklist should improve coverage inside each
  // agent, not multiply agents when the user did not request a structured
  // table, comparison, chronology, or named set of deliverables.
  if (shortGeneralResearchRequest(userInput)) return 3;

  const criteriaCount = evidenceRequirements.reduce(
    (total, requirement) => total + requirement.successCriteria.filter((item) => item.trim()).length,
    0,
  );
  if (evidenceRequirements.length <= 1 && criteriaCount <= 4) return 3;
  if (evidenceRequirements.length <= 2 && criteriaCount <= 8) return 4;
  return Math.min(10, Math.max(4, evidenceRequirements.length * 2));
}

function shortGeneralResearchRequest(userInput: string): boolean {
  const text = userInput.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!text || text.length > 80) return false;
  if (/\n|(?:^|\s)[-*]\s|(?:^|\s)\d+[.)、]\s/u.test(userInput)) return false;
  return !/(?:表格|列表|清单|逐年|每年|按年|时间线|章节|小节|分别|逐一|对比|比较|排行|前\s*\d+|至少\s*\d+|不少于\s*\d+|\btables?\b|\blists?\b|\bcompare\b|\bcomparison\b|\bsections?\b|\bchapters?\b|\btop\s*\d+\b|\b(?:19|20)\d{2}\b)/iu.test(text);
}

interface PairedCategoryFocus {
  label: string;
  queryTerm: string;
  searchHints: string;
  boundaryCriterion: string;
}

function expandPairedCategoryDeliverables(
  plan: ArchitectTreePlan,
  requirements: ResearchRequirement[],
  maxHypotheses: number,
): ArchitectTreePlan {
  const requirementById = new Map(requirements.map((requirement) => [requirement.requirementId, requirement]));
  const mappedLeafCounts = new Map<string, number>();
  for (const aspect of plan.aspects) {
    for (const hypothesis of aspect.hypotheses) {
      for (const id of hypothesis.requirementIds ?? []) mappedLeafCounts.set(id, (mappedLeafCounts.get(id) ?? 0) + 1);
    }
  }
  let totalLeaves = plan.aspects.reduce((sum, aspect) => sum + aspect.hypotheses.length, 0);
  return {
    aspects: plan.aspects.map((aspect) => {
      const hypotheses: ArchitectTreePlan["aspects"][number]["hypotheses"] = [];
      const tasks: ArchitectTreePlan["aspects"][number]["tasks"] = [];
      for (let index = 0; index < aspect.hypotheses.length; index += 1) {
        const hypothesis = aspect.hypotheses[index]!;
        const task = aspect.tasks[index] ?? aspect.tasks[0] ?? {
          title: `Research ${aspect.label}`,
          objective: hypothesis.researchBrief,
          acceptanceCriteria: [],
        };
        const owners = (hypothesis.requirementIds ?? []).flatMap((id) => {
          const requirement = requirementById.get(id);
          return requirement && isLeafOwningRequirement(requirement) ? [requirement] : [];
        });
        const requirement = owners.length === 1 ? owners[0] : undefined;
        const focuses = requirement ? pairedCategoryFocuses(requirement.description) : [];
        if (
          !requirement
          || !["comparison", "deliverable"].includes(requirement.kind)
          || (mappedLeafCounts.get(requirement.requirementId) ?? 0) !== 1
          || focuses.length !== 2
          || totalLeaves >= maxHypotheses
        ) {
          hypotheses.push(hypothesis);
          tasks.push(task);
          continue;
        }
        totalLeaves += 1;
        for (const focus of focuses) {
          hypotheses.push({
            ...hypothesis,
            statement: `${focus.label}: evidence-backed rows for ${requirement.requirementId}`,
            researchBrief: `Research and write cited row-level material only for ${focus.queryTerm} under ${requirement.requirementId}. The parent section will merge both category leaves into the requested table.`,
            evidenceGuidance: `Search directly for named ${focus.queryTerm}, including concept families such as ${focus.searchHints}. Verify the category boundary for every method, its objective, specific sensing scenario, and every other requested table field. Do not claim coverage of the sibling category.`,
          });
          tasks.push({
            title: `${requirement.requirementId}: ${focus.label}`,
            objective: `Produce multiple evidence-backed table rows for ${focus.queryTerm} under ${requirement.requirementId}.`,
            acceptanceCriteria: [
              `Identify multiple distinct, named ${focus.queryTerm} rather than one generic category.`,
              `For every ${focus.queryTerm} row, fill all applicable fields requested by ${requirement.requirementId}.`,
              `Name a specific application or sensing scenario for every ${focus.queryTerm} row.`,
              focus.boundaryCriterion,
              `Inspect full primary or authoritative sources for the core ${focus.queryTerm}.`,
              "Record source-visible publication dates for time-bounded techniques and do not guess missing dates.",
              `Do not invent a numeric method quota that ${requirement.requirementId} does not state; maximize distinct directly evidenced methods within the available budget.`,
              "Write a cited reusable reportlet that the parent table can merge.",
            ],
          });
        }
      }
      return { ...aspect, hypotheses, tasks };
    }),
  };
}

function pairedCategoryFocuses(description: string): PairedCategoryFocus[] {
  const sentences = description.split(/[.!?。；;\n]/u).map((sentence) => sentence.trim()).filter(Boolean);
  const sentence = sentences.find((candidate) => {
    const hasEnglishPair = /\bboth\b/iu.test(candidate) && /\bactive\b/iu.test(candidate) && /\bpassive\b/iu.test(candidate);
    const hasChinesePair = /(?:主动.*被动|被动.*主动)/u.test(candidate) && /(?:两(?:类|种)|均|都|包括|覆盖)/u.test(candidate);
    return (hasEnglishPair || hasChinesePair) && /\battacks?\b|\bdefen[cs]es?\b|攻击|防御/iu.test(candidate);
  });
  if (!sentence) return [];
  const isAttack = /\battacks?\b|攻击/iu.test(sentence);
  const isDefense = /\bdefen[cs]es?\b|防御/iu.test(sentence);
  if (isAttack === isDefense) return [];
  const chinese = /[\p{Script=Han}]/u.test(sentence);
  if (chinese) {
    const noun = isAttack ? "攻击" : "防御";
    return isAttack ? [
      {
        label: `主动${noun}`,
        queryTerm: `主动${noun}技术`,
        searchHints: "干扰、欺骗、对抗扰动、信号或数据包注入",
        boundaryCriterion: "只收录会操纵、注入或扰动目标信号或系统的攻击；不要把纯观察或推断归入本类。",
      },
      {
        label: `被动${noun}`,
        queryTerm: `被动${noun}技术`,
        searchHints: "窃听、行为或位置窥探、侧信道推断、流量观察",
        boundaryCriterion: "只收录不操纵目标信号、依靠观察或推断的攻击。",
      },
    ] : [
      {
        label: `主动${noun}`,
        queryTerm: `主动${noun}技术`,
        searchHints: "信道混淆、人工噪声、对抗训练、欺骗或干扰检测",
        boundaryCriterion: "要求方法主动改变、检测或加固感知过程；不要把仅观察或仅加密的隐私控制归入本类。",
      },
      {
        label: `被动${noun}`,
        queryTerm: `被动${noun}技术`,
        searchHints: "隐私保护定位、加密、匿名化、观察感知或认证",
        boundaryCriterion: "排除依靠注入、干扰或扰动信道工作的防御；这些属于兄弟类别。",
      },
    ];
  }
  const noun = isAttack ? "attack" : "defense";
  return isAttack ? [
    {
      label: `Active ${noun} methods`,
      queryTerm: `active ${noun} methods`,
      searchHints: "jamming, spoofing, adversarial perturbation, and signal or packet injection",
      boundaryCriterion: "Include only attacks that manipulate, inject, or perturb target signals or systems; exclude observation-only inference.",
    },
    {
      label: `Passive ${noun} methods`,
      queryTerm: `passive ${noun} methods`,
      searchHints: "eavesdropping, behavioral or location snooping, side-channel inference, and traffic observation",
      boundaryCriterion: "Include only observation or inference attacks that do not manipulate target signals.",
    },
  ] : [
    {
      label: `Active ${noun} methods`,
      queryTerm: `active ${noun} methods`,
      searchHints: "channel obfuscation, artificial noise, adversarial training, and spoofing or jamming detection",
      boundaryCriterion: "Require an intervention that changes, detects, or hardens the sensing process; exclude observation-only or encryption-only privacy controls.",
    },
    {
      label: `Passive ${noun} methods`,
      queryTerm: `passive ${noun} methods`,
      searchHints: "privacy-preserving localization, encryption, anonymization, and observation awareness or authentication",
      boundaryCriterion: "Exclude defenses that inject, jam, or perturb the channel; those belong to the sibling category.",
    },
  ];
}

function expandEnumeratedDeliverableEntities(
  plan: ArchitectTreePlan,
  requirements: ResearchRequirement[],
  maxHypotheses: number,
): ArchitectTreePlan {
  const requirementById = new Map(requirements.map((requirement) => [requirement.requirementId, requirement]));
  const mappedLeafCounts = new Map<string, number>();
  for (const aspect of plan.aspects) {
    for (const hypothesis of aspect.hypotheses) {
      for (const id of hypothesis.requirementIds ?? []) mappedLeafCounts.set(id, (mappedLeafCounts.get(id) ?? 0) + 1);
    }
  }
  let totalLeaves = plan.aspects.reduce((sum, aspect) => sum + aspect.hypotheses.length, 0);
  return {
    aspects: plan.aspects.map((aspect) => {
      const hypotheses: ArchitectTreePlan["aspects"][number]["hypotheses"] = [];
      const tasks: ArchitectTreePlan["aspects"][number]["tasks"] = [];
      for (let index = 0; index < aspect.hypotheses.length; index += 1) {
        const hypothesis = aspect.hypotheses[index]!;
        const task = aspect.tasks[index] ?? aspect.tasks[0] ?? {
          title: `Research ${aspect.label}`,
          objective: hypothesis.researchBrief,
          acceptanceCriteria: [],
        };
        const owner = (hypothesis.requirementIds ?? []).flatMap((id) => {
          const requirement = requirementById.get(id);
          return requirement && isLeafOwningRequirement(requirement) ? [requirement] : [];
        });
        const requirement = owner.length === 1 ? owner[0] : undefined;
        const declaredEntities = requirement?.entityScopeRole !== "groups"
          ? uniqueStrings((requirement?.entityScope ?? []).map((entity) => entity.trim()).filter(Boolean))
          : [];
        const entities = declaredEntities.length >= 5 && declaredEntities.length <= 20
          ? declaredEntities
          : requirement ? enumeratedSubjects(requirement.description) : [];
        const extraCapacity = Math.max(0, maxHypotheses - totalLeaves);
        const desiredGroups = Math.max(1, Math.ceil(entities.length / 3));
        const groupCount = Math.min(desiredGroups, extraCapacity + 1);
        if (
          !requirement
          || !["comparison", "deliverable"].includes(requirement.kind)
          || (mappedLeafCounts.get(requirement.requirementId) ?? 0) !== 1
          || entities.length < 5
          || groupCount <= 1
        ) {
          hypotheses.push(hypothesis);
          tasks.push(task);
          continue;
        }
        const groups = balancedGroups(entities, groupCount);
        totalLeaves += groups.length - 1;
        for (const group of groups) {
          const entityLabel = group.join(", ");
          const focus = `${requirement.requirementId}: ${entityLabel}`;
          hypotheses.push({
            ...hypothesis,
            statement: `${requirement.description.slice(0, 70)} — ${entityLabel}`,
            researchBrief: `Research and write cited row-level material only for this entity group: ${focus}. The parent section will merge all groups into the requested table.`,
            evidenceGuidance: `Find direct product, technical, or authoritative evidence for every entity in: ${entityLabel}. Do not claim coverage of entities assigned to sibling leaves.`,
          });
          tasks.push({
            title: `${requirement.requirementId}: ${entityLabel}`.slice(0, 120),
            objective: `Produce evidence-backed table rows for ${entityLabel} under ${requirement.requirementId}.`,
            acceptanceCriteria: [
              ...group.map((entity) => `Provide a cited, specific row for ${entity}.`),
              `Use the exact requested fields for ${requirement.requirementId}; mark a field as an explicit evidence gap rather than guessing.`,
              "Inspect at least one full authoritative or primary source for this entity group.",
              "Write the findings as a reusable reportlet that the parent table can merge.",
            ].slice(0, 8),
          });
        }
      }
      return { ...aspect, hypotheses, tasks };
    }),
  };
}

function balancedGroups(values: string[], count: number): string[][] {
  const groups: string[][] = [];
  let offset = 0;
  for (let index = 0; index < count; index += 1) {
    const remaining = values.length - offset;
    const slots = count - index;
    const size = Math.ceil(remaining / slots);
    groups.push(values.slice(offset, offset + size));
    offset += size;
  }
  return groups.filter((group) => group.length > 0);
}

function enumeratedSubjects(description: string): string[] {
  const parenthetical = Array.from(description.matchAll(/\(([^()]{8,240})\)/gu))
    .map((match) => splitEntityEnumeration(match[1] ?? ""))
    .find((items) => items.length >= 5);
  if (parenthetical) return parenthetical;
  const marker = /(?:\b(?:compare|include|including|cover|covering|contains?)\b|比较|包含|覆盖)\s*[:：]?\s*/giu;
  for (const match of description.matchAll(marker)) {
    const start = (match.index ?? 0) + match[0].length;
    const segment = description.slice(start).split(/[。.;；\n]/u, 1)[0] ?? "";
    const items = splitEntityEnumeration(segment)
      .map((item) => item
        .replace(/(?:这|以上)[一二三四五六七八九十百\d]+(?:种|个|家)?(?:传感器|公司|制造商|产品|对象)?[^\p{L}\p{N}+.-]*$/u, "")
        .replace(/\s+(?:these|the)\s+\d+\s+(?:companies|manufacturers|products|sensors).*$/iu, "")
        .trim())
      .filter(Boolean);
    if (items.length >= 5 && items.length <= 20) return uniqueStrings(items);
  }
  return [];
}

interface EntityLeafRef {
  aspect: ArchitectTreePlan["aspects"][number];
  hypothesis: ArchitectTreePlan["aspects"][number]["hypotheses"][number];
  task: ArchitectTreePlan["aspects"][number]["tasks"][number];
  hypothesisIndex: number;
  text: string;
}

function alignEntityDistributedRequirements(
  plan: ArchitectTreePlan,
  requirements: ResearchRequirement[],
): ArchitectTreePlan {
  const requirementById = new Map(requirements.map((requirement) => [requirement.requirementId, requirement]));
  const leaves = plan.aspects.flatMap((aspect) => aspect.hypotheses.map((hypothesis, hypothesisIndex): EntityLeafRef => {
    const task = aspect.tasks[hypothesisIndex] ?? aspect.tasks[0] ?? {
      title: `Research ${aspect.label}`,
      objective: hypothesis.researchBrief,
      acceptanceCriteria: [],
    };
    return {
      aspect,
      hypothesis,
      hypothesisIndex,
      task,
      // Aspect scope often lists every entity and therefore cannot identify
      // which sibling leaf owns one entity. Match only leaf/task-local text.
      text: `${hypothesis.statement} ${hypothesis.researchBrief} ${hypothesis.evidenceGuidance} ${task.title} ${task.objective}`,
    };
  }));
  if (leaves.length < 3) return plan;

  const selectedLeaves = new Set<EntityLeafRef>();
  const alignedRequirementIds = new Set<string>();
  for (const entities of enumeratedEntityGroups(requirements)) {
    const targets = entities.map((entity) => {
      const matches = leaves.filter((leaf) => containsNormalizedPhrase(leaf.text, entity));
      return matches.sort((left, right) => mappedResearchRequirementCount(right, requirementById)
        - mappedResearchRequirementCount(left, requirementById))[0];
    });
    if (targets.some((target) => !target) || new Set(targets).size !== entities.length) continue;
    const distributed = requirements.filter((requirement) => isDistributedAcrossEntities(requirement, entities));
    if (distributed.length === 0) continue;

    for (let index = 0; index < entities.length; index += 1) {
      const entity = entities[index]!;
      const target = targets[index]!;
      selectedLeaves.add(target);
      const currentIds = new Set(target.hypothesis.requirementIds ?? []);
      const newlyMapped = distributed.filter((requirement) => !currentIds.has(requirement.requirementId));
      target.hypothesis.requirementIds = uniqueStrings([
        ...(target.hypothesis.requirementIds ?? []),
        ...distributed.map((requirement) => requirement.requirementId),
      ]);
      if (newlyMapped.length > 0) {
        const contribution = newlyMapped.map((requirement) => requirement.requirementId).join(", ");
        target.hypothesis.researchBrief = `${target.hypothesis.researchBrief} Also produce the ${entity}-specific contribution for ${contribution}.`;
        target.hypothesis.evidenceGuidance = `${target.hypothesis.evidenceGuidance} Collect direct evidence for the ${entity}-specific fields in ${contribution}.`;
        target.task.objective = `${target.task.objective} Also research and write the ${entity}-specific contribution for ${contribution}.`;
        target.task.acceptanceCriteria = mergeEntityAlignedCriteria(target.task.acceptanceCriteria, newlyMapped, entity);
      }
    }
    for (const requirement of distributed) alignedRequirementIds.add(requirement.requirementId);
  }
  if (selectedLeaves.size === 0) return plan;

  const aspects = plan.aspects.flatMap((aspect) => {
    const keepIndexes = aspect.hypotheses.flatMap((hypothesis, hypothesisIndex) => {
      const leaf = leaves.find((candidate) => candidate.aspect === aspect && candidate.hypothesis === hypothesis);
      if (!leaf || selectedLeaves.has(leaf)) return [hypothesisIndex];
      const mappedResearchIds = (hypothesis.requirementIds ?? []).filter((id) => {
        const requirement = requirementById.get(id);
        return requirement ? isLeafOwningRequirement(requirement) : false;
      });
      const redundant = mappedResearchIds.length > 0 && mappedResearchIds.every((id) => alignedRequirementIds.has(id));
      return redundant ? [] : [hypothesisIndex];
    });
    if (keepIndexes.length === 0) return [];
    const hypotheses = keepIndexes.map((index) => aspect.hypotheses[index]!);
    const tasks = keepIndexes.map((index) => aspect.tasks[index] ?? aspect.tasks[0]!).filter(Boolean);
    return [{
      ...aspect,
      hypotheses,
      tasks,
      requirementIds: uniqueStrings(hypotheses.flatMap((hypothesis) => hypothesis.requirementIds ?? [])),
    }];
  });
  return { aspects };
}

function mappedResearchRequirementCount(
  leaf: EntityLeafRef,
  requirementById: Map<string, ResearchRequirement>,
): number {
  return (leaf.hypothesis.requirementIds ?? []).filter((id) => {
    const requirement = requirementById.get(id);
    return requirement ? isLeafOwningRequirement(requirement) : false;
  }).length;
}

function mergeEntityAlignedCriteria(
  existing: string[],
  requirements: ResearchRequirement[],
  entity: string,
): string[] {
  const aligned = requirements.map((requirement) => {
    const localSuccess = requirement.successCriteria.filter((criterion) => (
      !/\b(?:all|each|every)\b|全部|每(?:个|一)|各(?:个)?/iu.test(criterion)
    ));
    const success = localSuccess.length > 0 ? ` Apply to this row: ${localSuccess.join("; ")}` : "";
    return `For ${entity}, contribute its evidence-backed portion of ${requirement.requirementId}: ${requirement.description}${success}`;
  });
  return uniqueStrings([...aligned, ...existing]).slice(0, 8);
}

function enumeratedEntityGroups(requirements: ResearchRequirement[]): string[][] {
  const groups: string[][] = [];
  for (const requirement of requirements) {
    for (const match of requirement.description.matchAll(/\(([^()]*)\)/gu)) {
      const entities = splitEntityEnumeration(match[1] ?? "");
      if (entities.length >= 3) groups.push(entities);
    }
  }
  const seen = new Set<string>();
  return groups.filter((group) => {
    const key = group.map(normalizedPhrase).join("|");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => right.length - left.length);
}

function splitEntityEnumeration(value: string): string[] {
  const items = value.split(/\s*[,;、，；]\s*|\s+(?:and|or)\s+|\s*(?:以及|和|或)\s*/iu)
    .map((item) => item.replace(/^(?:and|or|以及|和|或)\s+/iu, "").replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim())
    .filter((item) => item.length >= 2 && item.length <= 50 && item.split(/\s+/).length <= 5)
    .filter((item) => !/^(?:none|other|others|etc\.?|无|其他)$/iu.test(item));
  return uniqueStrings(items);
}

function isDistributedAcrossEntities(requirement: ResearchRequirement, entities: string[]): boolean {
  if (!isLeafOwningRequirement(requirement)) return false;
  const description = requirement.description;
  const namesEveryEntity = entities.every((entity) => containsNormalizedPhrase(description, entity));
  const usesDistributiveLanguage = /\b(?:for\s+each|each|every|all|per)\b|每(?:个|一)|各(?:个)?|分别|逐一/iu.test(description);
  return namesEveryEntity || usesDistributiveLanguage;
}

function containsNormalizedPhrase(text: string, phrase: string): boolean {
  const haystack = ` ${normalizedPhrase(text)} `;
  const needle = normalizedPhrase(phrase);
  return needle.length >= 2 && haystack.includes(` ${needle} `);
}

function normalizedPhrase(value: string): string {
  return value.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function expandRequirementDenseLeaves(
  plan: ArchitectTreePlan,
  requirements: ResearchRequirement[],
  maxHypotheses: number,
): ArchitectTreePlan {
  const byId = new Map(requirements.map((requirement) => [requirement.requirementId, requirement]));
  let totalLeaves = plan.aspects.reduce((sum, aspect) => sum + aspect.hypotheses.length, 0);
  return {
    aspects: plan.aspects.map((aspect) => {
      const hypotheses: ArchitectTreePlan["aspects"][number]["hypotheses"] = [];
      const tasks: ArchitectTreePlan["aspects"][number]["tasks"] = [];
      for (let index = 0; index < aspect.hypotheses.length; index += 1) {
        const hypothesis = aspect.hypotheses[index]!;
        const originalTask = aspect.tasks[index] ?? aspect.tasks[0] ?? {
          title: `Research ${aspect.label}`,
          objective: hypothesis.researchBrief,
          acceptanceCriteria: [],
        };
        const mapped = (hypothesis.requirementIds ?? []).flatMap((id) => {
          const requirement = byId.get(id);
          return requirement ? [requirement] : [];
        });
        const researchRequirements = mapped.filter(isLeafOwningRequirement);
        const ancillaryIds = mapped.filter((requirement) => !isLeafOwningRequirement(requirement)).map((requirement) => requirement.requirementId);
        const extraCapacity = Math.max(0, maxHypotheses - totalLeaves);
        const splitCount = Math.min(researchRequirements.length, extraCapacity + 1);
        if (
          researchRequirements.length <= 1
          || splitCount <= 1
          || preservesEntityDistributedLeaf(hypothesis, researchRequirements, requirements)
          || preservesStudyReviewMethodologyLeaf(hypothesis, researchRequirements)
          || preservesInfluencingFactorQuestionDeliverable(researchRequirements)
        ) {
          hypotheses.push(hypothesis);
          tasks.push(originalTask);
          continue;
        }

        const groups = researchRequirements.slice(0, splitCount - 1).map((requirement) => [requirement]);
        groups.push(researchRequirements.slice(splitCount - 1));
        totalLeaves += groups.length - 1;
        for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
          const group = groups[groupIndex]!;
          const focus = group.map((requirement) => `${requirement.requirementId}: ${requirement.description}`).join(" ");
          const evidenceNeeds = uniqueStrings(group.flatMap((requirement) => requirement.evidenceNeeds));
          hypotheses.push({
            ...hypothesis,
            statement: group.length === 1 ? group[0]!.description : hypothesis.statement,
            researchBrief: `Research and write cited material only for this focused requirement: ${focus}`,
            evidenceGuidance: `Collect evidence specifically for: ${focus}${evidenceNeeds.length > 0 ? `\nRequired evidence: ${evidenceNeeds.join("; ")}` : ""}`,
            requirementIds: uniqueStrings([
              ...group.map((requirement) => requirement.requirementId),
              ...(groupIndex === 0 ? ancillaryIds : []),
            ]),
          });
          tasks.push({
            title: group.length === 1
              ? `${group[0]!.requirementId}: ${group[0]!.description}`.slice(0, 120)
              : originalTask.title,
            objective: `Research and write cited reportlet material for ${focus}`,
            acceptanceCriteria: requirementTaskCriteria(group),
          });
        }
      }
      return { ...aspect, hypotheses, tasks };
    }),
  };
}

function preservesStudyReviewMethodologyLeaf(
  hypothesis: ArchitectTreePlan["aspects"][number]["hypotheses"][number],
  mappedRequirements: ResearchRequirement[],
): boolean {
  if (!/parent section will merge all (?:methodology )?groups|synthesize effectiveness by methodology bottom-up|methodology-specific effectiveness reportlet/iu.test(`${hypothesis.researchBrief} ${hypothesis.evidenceGuidance}`)) return false;
  return mappedRequirements.every((requirement) => (
    countedStudyTableMinimum(requirement) !== undefined || isStudyMethodologySynthesisRequirement(requirement)
  ))
    && mappedRequirements.some((requirement) => countedStudyTableMinimum(requirement) !== undefined)
    && mappedRequirements.some((requirement) => isStudyMethodologySynthesisRequirement(requirement));
}

function preservesInfluencingFactorQuestionDeliverable(mappedRequirements: ResearchRequirement[]): boolean {
  if (mappedRequirements.length !== 2) return false;
  const kinds = new Set(mappedRequirements.map((requirement) => requirement.kind));
  if (!kinds.has("question") || !kinds.has("deliverable")) return false;
  return mappedRequirements.every(isInfluencingFactorRequirement);
}

function isInfluencingFactorRequirement(requirement: ResearchRequirement): boolean {
  return /\b(?:factors?\s+influenc|influencing\s+factors?)\b/iu.test(requirement.description);
}

function preservesEntityDistributedLeaf(
  hypothesis: ArchitectTreePlan["aspects"][number]["hypotheses"][number],
  mappedRequirements: ResearchRequirement[],
  allRequirements: ResearchRequirement[],
): boolean {
  const text = `${hypothesis.statement} ${hypothesis.researchBrief}`;
  return enumeratedEntityGroups(allRequirements).some((entities) => {
    const matchingEntities = entities.filter((entity) => containsNormalizedPhrase(text, entity));
    return matchingEntities.length === 1
      && mappedRequirements.every((requirement) => isDistributedAcrossEntities(requirement, entities));
  });
}

function isLeafOwningRequirement(requirement: ResearchRequirement): boolean {
  return requirement.priority === "must"
    && requirement.evidenceRequired === true
    && (["question", "comparison", "deliverable"].includes(requirement.kind) || isStudyMethodologySynthesisRequirement(requirement))
    && !isReportMetaRequirement(requirement);
}

function isReportMetaRequirement(requirement: ResearchRequirement): boolean {
  const text = `${requirement.description} ${requirement.successCriteria.join(" ")}`;
  const substantiveEvidenceNeed = requirement.evidenceNeeds.some((need) => (
    need.trim().length > 0
    && !/^direct evidence(?: addressing this requirement)?\.?$/iu.test(need.trim())
  ));
  if (
    requirement.evidenceRequired === true
    && ["question", "comparison"].includes(requirement.kind)
    && substantiveEvidenceNeed
  ) return false;
  return /\b(?:each|all|every)(?:\s+of\s+the)?[^.!\n]{0,40}\bsections?\b[^.!\n]{0,100}(?:bulleted?|clear\s+language|species\s+names?|gene\s+names?)|(?:^|\b)(?:do not|must not|never)\s+(?:search|open|save|use|cite)|(?:final\s+)?report\s+(?:must|should)[^.!\n]{0,100}(?:citation|references?|bibliography|language|English|Chinese|format|headings?|sections?|structure|organization)|(?:headings?|sections?)\s+(?:for|covering|corresponding\s+to)\s+(?:all|each|every|the)\b|(?:include|provide|add|list|use|contain)\s+(?:a\s+)?(?:standard\s+|consistent\s+|in-text\s+)?(?:citations?|references?|bibliography)(?:\s+(?:for|to)\s+(?:all|every|each)\b)?|citations?\s+for\s+(?:all|every|each)\b|citation\s+(?:format|style|requirements?)|报告必须[^。\n]{0,60}(?:引用|参考文献|来源列表|标题|章节|结构)|(?:包括|包含|提供|使用)[^。\n]{0,20}(?:引用|参考文献|来源列表)|不得(?:搜索|打开|保存|使用|引用)|禁止(?:来源|文献|链接)|最终报告必须(?:使用|以)[^。\n]{0,20}(?:中文|英文|语言)/iu.test(text);
}

function requirementTaskCriteria(requirements: ResearchRequirement[]): string[] {
  const namedSource = singleNamedPrimarySource(requirements);
  return uniqueStrings([
    ...requirements.flatMap((requirement) => requirement.successCriteria),
    ...requirements.flatMap((requirement) => requirement.evidenceNeeds.map((need) => `Find direct evidence for: ${need}`)),
    namedSource
      ? `Inspect the complete canonical source "${namedSource.title}" and save focused passages for every consequential claim.`
      : "Inspect at least one full authoritative or primary source for the focused requirement.",
    namedSource
      ? "Record unresolved source passages or interpretation boundaries instead of searching merely to increase source count."
      : "Corroborate consequential claims with an independent source and record unresolved boundaries.",
  ]).slice(0, 8);
}

function singleNamedPrimarySource(requirements: ResearchRequirement[]): NonNullable<ResearchRequirement["sourcePolicy"]>["sources"][number] | undefined {
  const substantive = requirements.filter((requirement) => (
    requirement.evidenceRequired !== false
    && requirement.visibility !== "internal"
    && (!['constraint', 'deliverable'].includes(requirement.kind) || requirement.sourcePolicy?.mode === "named_primary_sufficient")
  ));
  if (substantive.length === 0) return undefined;
  const policies = substantive.map((requirement) => requirement.sourcePolicy);
  if (policies.some((sourcePolicy) => sourcePolicy?.mode !== "named_primary_sufficient" || sourcePolicy.sources.length !== 1)) {
    return undefined;
  }
  const sources = policies.map((sourcePolicy) => sourcePolicy!.sources[0]!);
  const keys = sources.map((source) => (source.identifiers ?? []).join("|").toLocaleLowerCase() || source.title.toLocaleLowerCase());
  return keys[0] && keys.every((key) => key === keys[0]) ? sources[0] : undefined;
}

export function assignRequirements(plan: ArchitectTreePlan, requirements: ResearchRequirement[]): ArchitectTreePlan {
  if (requirements.length === 0) return plan;
  const validIds = new Set(requirements.map((requirement) => requirement.requirementId));
  const out: ArchitectTreePlan = {
    aspects: plan.aspects.map((aspect) => ({
      ...aspect,
      requirementIds: (aspect.requirementIds ?? []).filter((id) => validIds.has(id)),
      hypotheses: aspect.hypotheses.map((hypothesis) => ({
        ...hypothesis,
        requirementIds: (hypothesis.requirementIds ?? []).filter((id) => validIds.has(id)),
      })),
      tasks: [...aspect.tasks],
    })),
  };
  const leaves = out.aspects.flatMap((aspect, aspectIndex) => aspect.hypotheses.map((hypothesis, hypothesisIndex) => ({
    aspect,
    aspectIndex,
    hypothesis,
    hypothesisIndex,
    text: `${aspect.label} ${aspect.scopeNote} ${hypothesis.statement} ${hypothesis.researchBrief} ${hypothesis.evidenceGuidance}`,
  })));
  if (leaves.length === 0) return out;
  const globalSourcePublicationIds = requirements
    .filter((requirement) => (
      isGlobalSourcePublicationRequirement(requirement)
      || requirement.requirementId === "RQ_GLOBAL_TEMPORAL_CUTOFF"
      || requirement.requirementId === "RQ_TOP_LEVEL_SECTION_CONTRACT"
      || isReportMetaRequirement(requirement)
    ))
    .map((requirement) => requirement.requirementId);
  if (globalSourcePublicationIds.length > 0) {
    for (const leaf of leaves) {
      leaf.hypothesis.requirementIds = uniqueStrings([
        ...(leaf.hypothesis.requirementIds ?? []),
        ...globalSourcePublicationIds,
      ]);
    }
  }
  for (let index = 0; index < requirements.length; index++) {
    const requirement = requirements[index]!;
    const alreadyMapped = leaves.some((leaf) => leaf.hypothesis.requirementIds?.includes(requirement.requirementId));
    if (alreadyMapped) continue;
    const ranked = leaves
      .map((leaf, leafIndex) => ({ leaf, leafIndex, score: lexicalOverlap(requirement.description, leaf.text) }))
      .sort((a, b) => b.score - a.score || a.leafIndex - b.leafIndex);
    const target = ranked[0]?.score ? ranked[0]!.leaf : leaves[index % leaves.length]!;
    target.hypothesis.requirementIds = uniqueStrings([...(target.hypothesis.requirementIds ?? []), requirement.requirementId]);
  }
  for (const aspect of out.aspects) {
    aspect.requirementIds = uniqueStrings([
      ...(aspect.requirementIds ?? []),
      ...aspect.hypotheses.flatMap((hypothesis) => hypothesis.requirementIds ?? []),
    ]);
  }
  return out;
}

function validRequirementIds(value: unknown, requirements: ResearchRequirement[]): string[] {
  const valid = new Set(requirements.map((requirement) => requirement.requirementId));
  return uniqueStrings((Array.isArray(value) ? value : []).filter((item): item is string => typeof item === "string" && valid.has(item)));
}

function lexicalOverlap(a: string, b: string): number {
  const left = lexicalTokens(a);
  const right = lexicalTokens(b);
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap += token.length > 2 ? 2 : 1;
  return overlap;
}

function lexicalTokens(value: string): Set<string> {
  const normalized = value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const tokens = normalized.split(/\s+/).filter((token) => token.length >= 2);
  const chinese = Array.from(normalized.matchAll(/[\p{Script=Han}]{2,}/gu)).flatMap((match) => {
    const chars = Array.from(match[0]);
    return chars.slice(0, -1).map((char, index) => `${char}${chars[index + 1]}`);
  });
  return new Set([...tokens, ...chinese]);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizedPlanWithTasks(aspects: ArchitectTreePlan["aspects"]): ArchitectTreePlan {
  return {
    aspects: aspects.map((aspect) => ({
      ...aspect,
      tasks: aspect.tasks.slice(0, aspect.hypotheses.length),
    })),
  };
}

function nonEmptyCriteria(value: unknown, objective: string): string[] {
  const criteria = stringArrayValue(value);
  if (criteria.length > 0) return criteria.slice(0, 8);
  const target = stringValue(objective) || "this research branch";
  return [
    `Find directly relevant supporting or contradicting evidence for: ${target}`,
    `Define the key concepts, scope, and time/place boundaries for: ${target}`,
    `Find concrete data points, dates, quantities, or comparable indicators for: ${target}`,
    `Explain the core causal mechanism or institutional process behind: ${target}`,
    "Save/link credible evidence to this exact ReportNode.",
    "Write findings so they can become a cited reportlet fragment, and record high-impact gaps if evidence is missing.",
  ];
}

function stringArrayValue(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return raw
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        return stringValue(record.criterion)
          || stringValue(record.text)
          || stringValue(record.description)
          || stringValue(record.title)
          || stringValue(record.requirement);
      }
      return String(item ?? "");
    })
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function positiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(1, Math.floor(value));
}

function broadResearchTask(userInput: string, rubricText: string): boolean {
  const text = `${userInput}\n${rubricText}`;
  if (/(研究|报告|路线|历程|发展|演变|系统梳理|全面|综合|脉络|阶段)/i.test(text)) return true;
  if (/(deep research|trajectory|development route|historical route|evolution|comprehensive|systematic review|full report)/i.test(text)) return true;
  return /[\u4e00-\u9fff]/u.test(text) && text.length > 80;
}
