import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { ReportArtifact, ReportBundle, TaskItem, ToolCallRequest, ToolCallResult, ToolDefinition, ToolRegistry } from "@deepresearch/contracts";
import { runAgentRuntime } from "../agent-runtime.js";
import { evidenceRuntimeHistoryMaxChars } from "./evidence-budget.js";
import { truncate } from "../infra/ai.js";
import { isoNow, shortId } from "../infra/ids.js";
import { REPORT_SOURCE_INSPECTOR_SYSTEM_PROMPT, REPORT_WRITER_SYSTEM_PROMPT } from "../prompts.js";
import { traceWrite, tracedFetchPage, tracedLlmChat } from "../trace.js";
import type { PhaseContext } from "../types.js";
import {
  REPORT_CLAIM_TEXT_CHARS,
  REPORT_NODE_EVIDENCE_LIMIT,
  REPORT_NODE_GAP_LIMIT,
  REPORT_SOURCE_EXCERPT_CHARS,
  REPORT_SOURCE_EXCERPT_TOTAL_CHARS,
  REPORT_SOURCE_SUMMARY_CHARS,
  citationForKnowledge,
  citationIdsForEvidence,
  citationIdsForReportlets,
  citationIdsFromMarkdown,
  citationMapFromBundle,
  compactKnowledgeMetadata,
  compactNodeBundle,
  diagnosticsForBundle,
  formatCitationList,
  formatReportlets,
  leafEvidenceBatches,
  limitReportPrompt,
  nearestContainingAspect,
  positiveOptional,
  readerFacingRequirements,
  relatedSupplementalEvidence,
  reportContextBudget,
  reportableLowImpactGaps,
  requirementsForNode,
  sectionNodeSummary,
  writerConstraints,
  writerConstraintsForNode,
  type LeafEvidenceBatch,
  type LeafFirstPlan,
  type ReportEvidenceItem,
} from "./report-bundle.js";
import { assembleLeafFirstReport, assembleSectionWithLeafDrafts, isChineseReportLanguage, reportSectionLabels } from "./report-assembly.js";

interface WriterSourceInspectionPlan {
  citationIds?: string[];
  reasoningSummary?: string;
}

interface WriterSourceExcerpt {
  citationId: string;
  title: string;
  url: string;
  contentExcerpt: string;
}

type WriterDraftKind = "leaf" | "section" | "synthesis";

interface WriterDraftCacheEntry {
  version: 1;
  kind: WriterDraftKind;
  nodeId: string;
  fingerprint: string;
  markdown: string;
  savedAt: string;
}

async function generateLeafFirstLlmReport(ctx: PhaseContext, bundle: ReportBundle, plan: LeafFirstPlan): Promise<ReportArtifact> {
  const citationMap = citationMapFromBundle(bundle);
  const leafDrafts = new Map<string, { title: string; markdown: string }>();
  const context = reportContextBudget(ctx);
  const concurrency = writerDraftConcurrency(ctx);

  const completedLeaves = await mapConcurrentOrdered(plan.leaves, concurrency, async (leaf) => {
    if (bundle.constraints.citationRequired && leaf.evidence.length === 0) {
      await createWriterRepairTask(ctx, leaf, "Citation-required leaf report node has no evidence attached.");
    }
    const leafFingerprint = writerDraftFingerprint(ctx, bundle, "leaf", leaf.node.nodeId, {
      node: leaf.node,
      evidence: leaf.evidence.map((item) => ({
        link: item.link,
        knowledge: {
          nodeId: item.knowledge.nodeId,
          contentHash: item.knowledge.contentHash,
          title: item.knowledge.title,
          url: item.knowledge.url,
          sourceTier: item.knowledge.sourceTier,
          summary: item.knowledge.summary,
          metadata: compactKnowledgeMetadata(item.knowledge.metadata),
        },
      })),
      reportlets: leaf.reportlets,
      openGaps: reportableLowImpactGaps(leaf.openGaps),
      requirements: requirementsForNode(bundle, leaf.node.nodeId),
    });
    let leafMarkdown = await readWriterDraftCache(ctx, bundle, "leaf", leaf.node.nodeId, leafFingerprint);
    if (!leafMarkdown) {
      leafMarkdown = await draftLeafWithEvidenceBatches(ctx, bundle, leaf, context);
      await writeWriterDraftCache(ctx, "leaf", leaf.node.nodeId, leafFingerprint, leafMarkdown);
    }
    return { nodeId: leaf.node.nodeId, title: leaf.node.label, markdown: leafMarkdown.trim() };
  });
  for (const leaf of completedLeaves) leafDrafts.set(leaf.nodeId, { title: leaf.title, markdown: leaf.markdown });

  const sections = await mapConcurrentOrdered(plan.sections, concurrency, async (section) => {
    const leafSections = section.leafNodeIds.flatMap((nodeId) => {
      const draft = leafDrafts.get(nodeId);
      return draft ? [draft] : [];
    });
    if (leafSections.length === 1) {
      return { title: section.title, markdown: assembleSectionWithLeafDrafts(section.title, "", leafSections) };
    }
    const sectionFingerprint = writerDraftFingerprint(ctx, bundle, "section", section.nodeId, {
      section: sectionNodeSummary(bundle, section.nodeId),
      requirements: requirementsForNode(bundle, section.nodeId, true),
      leafSections,
    });
    const cachedSectionMarkdown = await readWriterDraftCache(ctx, bundle, "section", section.nodeId, sectionFingerprint);
    const sectionMarkdown = cachedSectionMarkdown ?? await runWriterDraftAgent(ctx, {
      phase: "report.section",
      reportNodeId: section.nodeId,
      title: `SectionWriterAgent ${section.title}`,
      objective: `Draft section synthesis for ${section.title}`,
      language: bundle.constraints.language,
      prompt: limitReportPrompt(`Draft one top-level section overview by merging only the already-drafted leaf-node subsections below.
Treat those leaf drafts as the complete writing context for this aspect. Do not inspect or re-process raw evidence, reportlets, source summaries, or omitted subtree material.
The supplied leaf drafts will be appended after your aspect synthesis, so focus on the aspect-level route, transitions, and cross-leaf interpretation.

Global constraints:
${JSON.stringify(writerConstraints(bundle), null, 2)}

Aspect node:
${JSON.stringify(sectionNodeSummary(bundle, section.nodeId), null, 2)}

Requirements owned by this aspect subtree:
${JSON.stringify(requirementsForNode(bundle, section.nodeId, true), null, 2)}

Merged child leaf drafts:
${leafSections.map((section, index) => `\n--- LEAF ${index + 1}: ${section.title} ---\n${section.markdown}`).join("\n")}

Available citations:
${formatCitationList(bundle, citationIdsFromMarkdown(leafSections.map((section) => section.markdown).join("\n\n")))}

Requirements:
- Start with a level-2 heading using the aspect title.
- Write a concise but substantive aspect-level synthesis that merges the child leaf drafts, explains transitions, evidence balance, and disagreements.
- Preserve the concrete claims and citations already present in child drafts; do not invent new cited facts.
- Every evidence-dependent synthesis sentence must carry the supporting [C#] citation locally, including repeated dates, percentages, and conclusions derived from the child drafts.
- Synthesize how the child drafts answer every owned requirement and its successCriteria; do not print internal requirement IDs.
- Do not rewrite the supplied leaf drafts as separate standalone subsections; they will be appended unchanged after your synthesis.
- Do not include internal "存在的开放性问题", "证据缺口", "待补证" or similar debug-style blocks. If evidence conflicts, resolve it analytically by narrowing the claim and citing both sides.
- Target 900-1500 Chinese characters when the output language is zh-CN.
- Use citations exactly as [C1], [C2], etc. Return Markdown only.`, context.sectionPromptChars),
    });
    if (!cachedSectionMarkdown) await writeWriterDraftCache(ctx, "section", section.nodeId, sectionFingerprint, sectionMarkdown);
    return { title: section.title, markdown: assembleSectionWithLeafDrafts(section.title, sectionMarkdown.trim(), leafSections) };
  });

  const synthesisFingerprint = writerDraftFingerprint(ctx, bundle, "synthesis", bundle.root.nodeId, {
    requirements: readerFacingRequirements(bundle).filter((requirement) => requirement.priority === "must"),
    sections,
  });
  const cachedSynthesisMarkdown = await readWriterDraftCache(ctx, bundle, "synthesis", bundle.root.nodeId, synthesisFingerprint);
  const synthesisMarkdown = cachedSynthesisMarkdown ?? await runWriterDraftAgent(ctx, {
    phase: "report.synthesize",
    reportNodeId: bundle.root.nodeId,
    title: "SynthesisWriterAgent",
    objective: "Draft executive summary and conclusion",
    language: bundle.constraints.language,
    prompt: limitReportPrompt(`Write only the opening executive summary and final conclusion from already-drafted aspect sections only.
Treat the aspect drafts below as the complete writing context for the root. Do not inspect or re-process raw evidence, reportlets, source summaries, or omitted subtree material.

Constraints:
${JSON.stringify(writerConstraints(bundle), null, 2)}

Must-cover requirements for final synthesis:
${JSON.stringify(readerFacingRequirements(bundle).filter((requirement) => requirement.priority === "must"), null, 2)}

Merged child aspect drafts:
${sections.map((section, index) => `\n--- SECTION ${index + 1}: ${section.title} ---\n${section.markdown}`).join("\n")}

Available citations:
${formatCitationList(bundle, citationIdsFromMarkdown(sections.map((section) => section.markdown).join("\n\n")))}

Final requirements:
- Return exactly two or three Markdown sections: "## ${reportSectionLabels(bundle.constraints.language).executiveSummary}", optional "## ${reportSectionLabels(bundle.constraints.language).scopeAndEvidence}", and "## ${reportSectionLabels(bundle.constraints.language).conclusion}".
- The executive summary should be 500-900 Chinese characters when language is zh-CN, or comparable depth in other languages.
- The conclusion should synthesize the route and evidence confidence in 400-800 Chinese characters when language is zh-CN.
- Do not rewrite the body aspect sections; they will be appended after the executive summary and before the conclusion.
- Do not describe unfinished agent work or internal evidence defects in the final report. If evidence is uneven but publishable, add one concise reader-facing "${reportSectionLabels(bundle.constraints.language).scopeAndEvidence}" section that narrows strong claims and names source/coverage boundaries. If a medium/high-impact gap remains, the completion/publish gates should stop publication instead of asking you to publish caveats.
- Keep concrete claims grounded with available [C#] citations where useful.
- Every evidence-dependent sentence in both the executive summary and conclusion must carry its supporting [C#] citation locally; do not leave repeated dates, percentages, legal requirements, or source-derived conclusions uncited.
- Confirm that the executive summary and conclusion collectively answer every must-cover requirement, without exposing internal requirement IDs.
- End the conclusion with a complete final sentence and punctuation appropriate for ${bundle.constraints.language}. Do not stop mid-sentence.

Return Markdown only.`, context.synthesisPromptChars),
  });
  if (!cachedSynthesisMarkdown) await writeWriterDraftCache(ctx, "synthesis", bundle.root.nodeId, synthesisFingerprint, synthesisMarkdown);
  const reportMd = assembleLeafFirstReport(bundle, sections, synthesisMarkdown.trim());
  if (!reportMd) throw new Error("report phase expected Markdown from the LLM but received an empty payload");
  return {
    episodeId: bundle.episodeId,
    reportMd: reportMd.endsWith("\n") ? reportMd : `${reportMd}\n`,
    citationMap,
    evidenceIndex: bundle.globalEvidenceIndex,
    diagnostics: diagnosticsForBundle(bundle),
    generatedAt: new Date(ctx.now()).toISOString(),
  };
}

function writerDraftConcurrency(ctx: PhaseContext): number {
  const configured = ctx.state.runtimeProfile.phases.report?.maxConcurrentAgents;
  return typeof configured === "number" && Number.isFinite(configured)
    ? Math.max(1, Math.floor(configured))
    : 1;
}

async function mapConcurrentOrdered<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  const errors: Array<{ index: number; error: unknown }> = [];
  let nextIndex = 0;
  let stopped = false;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (!stopped && nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await fn(items[index]!, index);
      } catch (error) {
        errors.push({ index, error });
        stopped = true;
      }
    }
  }));
  if (errors.length > 0) {
    errors.sort((left, right) => left.index - right.index);
    throw errors[0]!.error;
  }
  return results;
}

function writerDraftFingerprint(
  ctx: PhaseContext,
  bundle: ReportBundle,
  kind: WriterDraftKind,
  nodeId: string,
  input: unknown,
): string {
  return createHash("sha256").update(JSON.stringify({
    version: 1,
    kind,
    nodeId,
    constraints: bundle.constraints,
    reportLlm: ctx.state.runtimeProfile.llm.report,
    writerAgent: ctx.state.runtimeProfile.agents.writer,
    input,
  })).digest("hex");
}

async function readWriterDraftCache(
  ctx: PhaseContext,
  bundle: ReportBundle,
  kind: WriterDraftKind,
  nodeId: string,
  fingerprint: string,
): Promise<string | undefined> {
  try {
    const entry = JSON.parse(await readFile(writerDraftCachePath(ctx, kind, nodeId), "utf8")) as Partial<WriterDraftCacheEntry>;
    if (entry.version !== 1 || entry.kind !== kind || entry.nodeId !== nodeId || entry.fingerprint !== fingerprint) return undefined;
    const markdown = typeof entry.markdown === "string" ? entry.markdown.trim() : "";
    if (!markdown) return undefined;
    const allowedCitations = new Set(bundle.globalEvidenceIndex.map((item) => item.citationId));
    if (citationIdsFromMarkdown(markdown).some((citationId) => !allowedCitations.has(citationId))) return undefined;
    await ctx.emit({
      eventType: "writer_draft_cache_hit",
      reportNodeId: nodeId,
      payload: { kind, nodeId, fingerprint, path: writerDraftCachePath(ctx, kind, nodeId), bytes: markdown.length },
    });
    return markdown;
  } catch {
    return undefined;
  }
}

async function writeWriterDraftCache(
  ctx: PhaseContext,
  kind: WriterDraftKind,
  nodeId: string,
  fingerprint: string,
  markdown: string,
): Promise<void> {
  const normalized = markdown.trim();
  if (!normalized) return;
  const path = writerDraftCachePath(ctx, kind, nodeId);
  await mkdir(join(ctx.state.runtimeProfile.artifactDir, ctx.state.episodeId, "report-work"), { recursive: true });
  const entry: WriterDraftCacheEntry = {
    version: 1,
    kind,
    nodeId,
    fingerprint,
    markdown: normalized,
    savedAt: new Date(ctx.now()).toISOString(),
  };
  await writeFile(path, `${JSON.stringify(entry)}\n`, "utf8");
  await ctx.emit({
    eventType: "writer_draft_cached",
    reportNodeId: nodeId,
    payload: { kind, nodeId, fingerprint, path, bytes: normalized.length },
  });
}

function writerDraftCachePath(ctx: PhaseContext, kind: WriterDraftKind, nodeId: string): string {
  const readable = shortId(nodeId).slice(0, 48);
  const identity = createHash("sha1").update(nodeId).digest("hex").slice(0, 10);
  return join(ctx.state.runtimeProfile.artifactDir, ctx.state.episodeId, "report-work", `${kind}-${readable}-${identity}.json`);
}

async function draftLeafWithEvidenceBatches(
  ctx: PhaseContext,
  bundle: ReportBundle,
  leaf: ReportBundle["tree"][number],
  context: ReturnType<typeof reportContextBudget>,
): Promise<string> {
  if (leaf.reportlets.length > 0) {
    return draftLeafFromReportlets(ctx, bundle, leaf, context);
  }
  const batches = leafEvidenceBatches(leaf);
  let markdown = "";
  for (const batch of batches) {
    const sourceExcerpts = await inspectLeafSources(ctx, bundle, leaf, batch.evidence);
    const citationIds = citationIdsForEvidence(bundle, batch.evidence);
    const prompt = batch.batchIndex === 1
      ? leafInitialDraftPrompt(bundle, leaf, batch, sourceExcerpts, citationIds)
      : leafRevisionPrompt(bundle, leaf, batch, markdown, sourceExcerpts, citationIds);
    markdown = await runWriterDraftAgent(ctx, {
      phase: "report.leaf",
      reportNodeId: leaf.node.nodeId,
      title: `LeafWriterAgent ${leaf.node.label}`,
      objective: batch.totalBatches === 1
        ? `Draft leaf section for ${leaf.node.label}`
        : `Draft leaf section for ${leaf.node.label}; evidence batch ${batch.batchIndex} of ${batch.totalBatches}`,
      language: bundle.constraints.language,
      prompt: limitReportPrompt(prompt, context.leafPromptChars),
    });
  }
  return markdown;
}

async function draftLeafFromReportlets(
  ctx: PhaseContext,
  bundle: ReportBundle,
  leaf: ReportBundle["tree"][number],
  context: ReturnType<typeof reportContextBudget>,
): Promise<string> {
  const citationIds = citationIdsForReportlets(bundle, leaf.reportlets);
  const supplementalEvidence = relatedSupplementalEvidence(bundle, leaf, new Set(citationIds));
  const supplementalCitationIds = citationIdsForEvidence(bundle, supplementalEvidence);
  return await runWriterDraftAgent(ctx, {
    phase: "report.leaf",
    reportNodeId: leaf.node.nodeId,
    title: `LeafWriterAgent ${leaf.node.label}`,
    objective: `Draft leaf section for ${leaf.node.label} from pre-written evidence reportlets`,
    language: bundle.constraints.language,
    prompt: limitReportPrompt(`Draft one focused subsection for this leaf ReportNode using pre-written cited reportlets.

Constraints owned by this leaf:
${JSON.stringify(writerConstraintsForNode(bundle, leaf.node.nodeId), null, 2)}

Nearest containing aspect:
${JSON.stringify(nearestContainingAspect(bundle, leaf.node.nodeId)?.node ?? bundle.root, null, 2)}

Leaf node:
${JSON.stringify({ node: leaf.node, openGaps: reportableLowImpactGaps(leaf.openGaps).slice(0, REPORT_NODE_GAP_LIMIT) }, null, 2)}

Requirements owned by this leaf:
${JSON.stringify(requirementsForNode(bundle, leaf.node.nodeId), null, 2)}

Pre-written atomic reportlets for this leaf:
${formatReportlets(bundle, leaf.reportlets)}

Coverage-diverse supplemental evidence selected across the owned requirement's requested dimensions:
${JSON.stringify(leafCitationCandidates(bundle, supplementalEvidence), null, 2)}

Available citations used by these reportlets:
${formatCitationList(bundle, [...citationIds, ...supplementalCitationIds])}

Requirements:
- Start with a level-3 heading using the leaf node topic.
- Merge all reportlets from this leaf node's tasks into one coherent subsection. Do not leave task-by-task fragments.
- Treat reportlets as the primary evidence-grounded material. Preserve their concrete details and citations, but merge duplication.
- This leaf is one subsection of the current final report. Never call a sibling leaf "another report", promise that a topic appears in another report, or write a local scope sentence that contradicts the containing aspect.
- Answer every active owned requirement from available evidence. For a downplayed requirement, render the verified subset and say exactly what coverage was established; never imply that an unmet count, field, entity, example, or time span is complete. Do not print internal requirement IDs.
- Use supplemental evidence only when it directly addresses an owned requirement or fills an explicit deliverable cell; do not import unrelated claims.
- Review the supplemental candidates dimension by dimension instead of relying only on the first or most general source. Prefer direct official/primary support and use each citation only for the cell or sentence it actually supports.
- If an owned requirement asks for a table, comparison matrix, or list, render that deliverable even when some values are unavailable. Fill unsupported cells with "Not established by cited evidence" instead of omitting the table.
- Never fill a numeric or factual table cell from model memory or uncited "typical" engineering knowledge. Every concrete value must have a local [C#] citation.
- Every list item or table row containing a number, percentage, or date must carry its supporting [C#] citation on that same item or row, even when the introductory sentence is already cited.
- Write a resolved analytical subsection. Do not create standalone or repeated "证据缺口/开放性问题/局限" blocks inside leaf sections.
- Target 700-1000 Chinese characters when language is zh-CN.
- Use citations exactly as [C1], [C2], etc. Return Markdown only.`, context.leafPromptChars),
  });
}

function leafInitialDraftPrompt(
  bundle: ReportBundle,
  leaf: ReportBundle["tree"][number],
  batch: LeafEvidenceBatch,
  sourceExcerpts: WriterSourceExcerpt[],
  citationIds: string[],
): string {
  return `Draft one focused subsection for this leaf ReportNode.

Constraints owned by this leaf:
${JSON.stringify(writerConstraintsForNode(bundle, leaf.node.nodeId), null, 2)}

Nearest containing aspect:
${JSON.stringify(nearestContainingAspect(bundle, leaf.node.nodeId)?.node ?? bundle.root, null, 2)}

Leaf node bundle:
${JSON.stringify(compactNodeBundle(bundle, leaf.node.nodeId, batch), null, 2)}

Requirements owned by this leaf:
${JSON.stringify(requirementsForNode(bundle, leaf.node.nodeId), null, 2)}

Fetched source excerpts selected for this leaf evidence batch:
${formatSourceExcerpts(sourceExcerpts)}

Available citations for this evidence batch:
${formatCitationList(bundle, citationIds)}

Requirements:
- Start with a level-3 heading using the leaf node topic.
- Use evidence attached to this leaf node and the fetched source excerpts above. If the leaf has little or no evidence, write only the narrow claim supported by attached evidence and do not borrow unrelated-node evidence.
- This may be batch ${batch.batchIndex} of ${batch.totalBatches}; review every visible citation in this batch, cite all material sources, and do not cite weak or irrelevant sources just to mention them.
- Prefer concrete details from fetched source excerpts over shallow source summaries when they are available.
- Answer every active owned requirement using this leaf's evidence. For a downplayed requirement, preserve the supported subset and state the exact coverage boundary without claiming full completion. Do not print internal requirement IDs.
- If an owned requirement asks for a table, comparison matrix, or list, render it and use "Not established by cited evidence" for unsupported cells. Never invent uncited numeric or factual values.
- Write a resolved analytical subsection. Do not create standalone or repeated "证据缺口/开放性问题/局限" blocks inside leaf sections.
- Target 700-1000 Chinese characters when language is zh-CN.
- Use citations exactly as [C1], [C2], etc. Return Markdown only.`;
}

function leafRevisionPrompt(
  bundle: ReportBundle,
  leaf: ReportBundle["tree"][number],
  batch: LeafEvidenceBatch,
  currentMarkdown: string,
  sourceExcerpts: WriterSourceExcerpt[],
  citationIds: string[],
): string {
  return `Revise the existing focused subsection for this same leaf ReportNode by integrating the next evidence batch.
Return the full revised subsection, not a diff and not an addendum.

Constraints owned by this leaf:
${JSON.stringify(writerConstraintsForNode(bundle, leaf.node.nodeId), null, 2)}

Nearest containing aspect:
${JSON.stringify(nearestContainingAspect(bundle, leaf.node.nodeId)?.node ?? bundle.root, null, 2)}

Existing subsection draft:
${currentMarkdown}

Next leaf evidence batch:
${JSON.stringify(compactNodeBundle(bundle, leaf.node.nodeId, batch), null, 2)}

Fetched source excerpts selected for this evidence batch:
${formatSourceExcerpts(sourceExcerpts)}

Available citations for this evidence batch:
${formatCitationList(bundle, citationIds)}

Requirements:
- Preserve the existing level-3 heading and keep one coherent subsection.
- Integrate material new evidence from batch ${batch.batchIndex} of ${batch.totalBatches}; do not append a separate "补充证据" block.
- Review every visible citation in this batch, cite all material sources, and do not cite weak or irrelevant sources just to mention them.
- Preserve useful existing citations unless the new evidence makes them redundant or weaker.
- Prefer concrete details from fetched source excerpts over shallow source summaries when they are available.
- Preserve any required table, comparison matrix, or list. Every concrete value must have a local citation; use "Not established by cited evidence" where support is absent.
- Keep the subsection analytically resolved and concise; do not create standalone "证据缺口/开放性问题/局限" blocks.
- Use citations exactly as [C1], [C2], etc. Return Markdown only.`;
}

async function inspectLeafSources(
  ctx: PhaseContext,
  bundle: ReportBundle,
  leaf: ReportBundle["tree"][number],
  evidence: ReportEvidenceItem[] = leaf.evidence.slice(0, REPORT_NODE_EVIDENCE_LIMIT),
): Promise<WriterSourceExcerpt[]> {
  const writerCfg = ctx.state.runtimeProfile.agents.writer;
  const maxFetchCalls = Math.max(0, writerCfg?.maxFetchCalls ?? 0);
  if (maxFetchCalls === 0 || !ctx.stack.fetch || evidence.length === 0) return [];
  const candidates = leafCitationCandidates(bundle, evidence);
  if (candidates.length === 0) return [];

  const reportLlm = ctx.state.runtimeProfile.llm.report;
  if (!reportLlm) throw new Error("RuntimeProfile.llm.report is required for writer source inspection");
  const registry = new WriterCitationToolRegistry(ctx, bundle, leaf, candidates, maxFetchCalls);
  const runtime = await runAgentRuntime({
    agent: {
      agentId: "leaf_writer_source_inspector",
      agentRunId: `A_writer_inspect_${leaf.node.nodeId}`,
      role: "reporter",
      title: `LeafWriterSourceInspector ${leaf.node.label}`,
      objective: `Inspect cited sources for ${leaf.node.label}`,
      episodeId: ctx.state.episodeId,
      reportNodeId: leaf.node.nodeId,
    },
    llm: ctx.stack.llm,
    system: `${REPORT_SOURCE_INSPECTOR_SYSTEM_PROMPT}
Use fetch_citation_source tool only for citations that need full source inspection.
Finish when no more citation sources need to be opened.`,
    context: {
      instruction: "Choose which cited source URLs should be opened before drafting this leaf subsection.",
      constraints: bundle.constraints,
      nearestContainingAspect: nearestContainingAspect(bundle, leaf.node.nodeId)?.node ?? bundle.root,
      leafNode: leaf.node,
      summaryCatalog: candidates,
      selectionRules: [
        `Select at most ${maxFetchCalls} citationIds across all tool calls.`,
        "Treat the summary catalog as the first-pass context. Do not fetch every URL by default.",
        "Prefer sources whose summary is too broad for the leaf claim, sources with official or primary tiers, and sources needed for chronology, definitions, or disputed details.",
        "Return finish if the existing summaries are already enough.",
      ],
    },
    tools: registry,
    budget: {
      maxReactSteps: Math.max(1, writerCfg?.maxReactSteps ?? 2),
      maxToolCalls: maxFetchCalls,
      maxFetchCalls,
      targetReactSteps: positiveOptional(writerCfg?.targetReactSteps),
      targetToolCalls: positiveOptional(writerCfg?.targetFetchCalls ?? writerCfg?.targetToolCalls),
      targetFetchCalls: positiveOptional(writerCfg?.targetFetchCalls),
    },
    outputSchema: { reasoningSummary: "string" },
    ...reportLlm,
    maxTokens: Math.min(reportLlm.maxTokens, 1024),
    historyMaxChars: evidenceRuntimeHistoryMaxChars(),
    outputRepairAttempts: writerCfg?.outputRepairAttempts ?? 1,
    signal: ctx.signal,
    chat: async (request) => adaptWriterInspectionResponse(
      await tracedLlmChat(ctx, "report.leaf.inspect", request, { reportNodeId: leaf.node.nodeId, agentRunId: `A_writer_inspect_${leaf.node.nodeId}` }),
      request.user,
    ),
  });
  await traceWrite(ctx, "writer", "sourceInspectionPlan", {
    reportNodeId: leaf.node.nodeId,
    fetchedCitationIds: registry.excerpts.map((excerpt) => excerpt.citationId),
    runtimeStatus: runtime.status,
    steps: runtime.steps.length,
  }, { reportNodeId: leaf.node.nodeId, agentRunId: `A_writer_inspect_${leaf.node.nodeId}` });
  return registry.excerpts;
}

async function runWriterDraftAgent(ctx: PhaseContext, opts: {
  phase: "report.leaf" | "report.section" | "report.synthesize" | "report.organize";
  reportNodeId: string;
  title: string;
  objective: string;
  language: string;
  prompt: string;
}): Promise<string> {
  const writerCfg = ctx.state.runtimeProfile.agents.writer;
  const llmCfg = ctx.state.runtimeProfile.llm.report;
  const runtime = await runAgentRuntime({
    agent: {
      agentId: opts.phase,
      agentRunId: `A_${opts.phase.replace(/\W+/g, "_")}_${opts.reportNodeId}`,
      role: "reporter",
      title: opts.title,
      objective: opts.objective,
      episodeId: ctx.state.episodeId,
      reportNodeId: opts.reportNodeId,
    },
    llm: ctx.stack.llm,
    system: `${REPORT_WRITER_SYSTEM_PROMPT}
Return a finish action whose finish.markdown contains the requested Markdown draft.`,
    context: {
      instruction: opts.prompt,
    },
    tools: emptyToolRegistry,
    budget: {
      maxReactSteps: Math.max(1, Math.min(writerCfg?.maxReactSteps ?? 1, 2)),
      maxToolCalls: 0,
      targetReactSteps: 1,
      targetToolCalls: 0,
    },
    outputSchema: { markdown: "string" },
    ...llmCfg,
    historyMaxChars: evidenceRuntimeHistoryMaxChars(),
    outputRepairAttempts: writerCfg?.outputRepairAttempts ?? 1,
    signal: ctx.signal,
    chat: async (request) => adaptWriterMarkdownResponse(
      await tracedLlmChat(ctx, opts.phase, request, { reportNodeId: opts.reportNodeId, agentRunId: `A_${opts.phase.replace(/\W+/g, "_")}_${opts.reportNodeId}` }),
      opts,
    ),
  });
  if (runtime.status !== "completed") {
    throw new Error(`Writer runtime failed for ${opts.phase}: ${runtime.error ?? runtime.status}`);
  }
  const finish = object(runtime.finish);
  const markdown = typeof finish.markdown === "string" ? finish.markdown : "";
  if (!markdown.trim()) throw new Error(`Writer runtime produced empty markdown for ${opts.phase}`);
  return markdown;
}

const emptyToolRegistry: ToolRegistry = {
  listTools: () => [],
  invoke: async (req) => ({ toolName: req.toolName, ok: false, error: "No writer tools are available for this draft step." }),
};

function adaptWriterMarkdownResponse(
  response: { content: string; reasoning?: string },
  opts: {
    phase: "report.leaf" | "report.section" | "report.synthesize" | "report.organize";
    reportNodeId: string;
    title: string;
    objective: string;
    language: string;
    prompt: string;
  },
): { content: string; reasoning?: string } {
  const parsed = parseJsonObject(response.content);
  if (parsed && parsed.action === "finish") return response;
  if (parsed && parsed.action === "tool") {
    return {
      ...response,
      content: JSON.stringify({
        thoughtSummary: "Writer draft used deterministic fallback after a non-writer tool request.",
        action: "finish",
        finish: { markdown: fallbackWriterMarkdown(opts) },
      }),
    };
  }
  if (parsed && typeof parsed.markdown === "string") {
    return {
      ...response,
      content: JSON.stringify({
        thoughtSummary: "Writer draft completed.",
        action: "finish",
        finish: { markdown: parsed.markdown },
      }),
    };
  }
  if (parsed && Object.keys(parsed).length === 0) {
    return {
      ...response,
      content: JSON.stringify({
        thoughtSummary: "Writer draft used deterministic fallback after an empty JSON response.",
        action: "finish",
        finish: { markdown: fallbackWriterMarkdown(opts) },
      }),
    };
  }
  // A malformed AgentRuntime envelope must reach the runtime's compact JSON
  // repair path. Wrapping it as Markdown would make the outer decision valid
  // while leaking thoughtSummary/action/finish protocol JSON into the report.
  if (!parsed && resemblesWriterFinishEnvelope(response.content)) return response;
  return {
    ...response,
    content: JSON.stringify({
      thoughtSummary: "Writer draft completed.",
      action: "finish",
      finish: { markdown: response.content },
    }),
  };
}

function resemblesWriterFinishEnvelope(value: string): boolean {
  return /^\s*(?:```(?:json)?\s*)?\{[\s\S]*["']action["']\s*:\s*["']finish["'][\s\S]*["']finish["']\s*:/iu.test(value);
}

function fallbackWriterMarkdown(opts: {
  phase: "report.leaf" | "report.section" | "report.synthesize" | "report.organize";
  title: string;
  objective: string;
  language: string;
}): string {
  const labels = reportSectionLabels(opts.language);
  if (opts.phase === "report.synthesize") {
    return isChineseReportLanguage(opts.language)
      ? `## ${labels.executiveSummary}\n\n本报告依据当前 ReportBundle 中已经保存的证据和分节草稿完成综合。正文按最小 report node 先写局部论证，再由上层 section 汇总，避免最终阶段压缩掉关键证据。\n\n## ${labels.conclusion}\n\n本报告已基于当前证据完成综合分析，并将结论限定在已有引用能够支持的范围内。`
      : `## ${labels.executiveSummary}\n\nThis report synthesizes the evidence and leaf drafts retained in the current ReportBundle. The body is written from leaf findings upward so supporting detail is preserved.\n\n## ${labels.conclusion}\n\nThe conclusions are limited to claims supported by the cited evidence.`;
  }
  if (opts.phase === "report.section") {
    return isChineseReportLanguage(opts.language)
      ? `## ${cleanWriterTitle(opts.title)}\n\n本节汇总其下属最小 report node 的证据草稿，重点保留各 leaf 的具体论证、引用和限制，不在 section 层重写或覆盖 leaf 内容。`
      : `## ${cleanWriterTitle(opts.title)}\n\nThis section synthesizes its leaf drafts while preserving their evidence, citations, and stated boundaries.`;
  }
  return isChineseReportLanguage(opts.language)
    ? `### ${cleanWriterTitle(opts.title)}\n\n${opts.objective}。当前 writer 未获得可用 Markdown 草稿，系统保留该最小 report node 的位置，并要求依据已附加证据继续完善。`
    : `### ${cleanWriterTitle(opts.title)}\n\n${opts.objective}. The writer did not receive usable Markdown, so this leaf remains limited to the attached evidence.`;
}

function cleanWriterTitle(title: string): string {
  return title.replace(/^(LeafWriterAgent|SectionWriterAgent|SynthesisWriterAgent)\s*/u, "").trim() || title;
}

async function createWriterRepairTask(ctx: PhaseContext, leaf: ReportBundle["tree"][number], reason: string): Promise<void> {
  const existing = await ctx.stack.ledger.listByReportNode(leaf.node.nodeId);
  if (existing.some((task) => ["queued", "running"].includes(task.status) && task.taskId.startsWith("T_writer_repair_"))) return;
  const now = isoNow(ctx.now);
  const suffix = shortId(`${leaf.node.nodeId}_${reason}_${now}`);
  const task: TaskItem = {
    taskId: `T_writer_repair_${suffix}`,
    parentTaskId: "T_root",
    reportNodeId: leaf.node.nodeId,
    title: `Writer repair: ${leaf.node.label}`,
    objective: reason,
    status: "queued",
    priority: 96,
    branchId: `B_writer_repair_${suffix}`,
    acceptanceCriteria: [
      "Find evidence directly attached to this report node, or downplay the node before final publication.",
      "Do not let the writer invent uncited support for this leaf.",
    ],
    createdAt: now,
    updatedAt: now,
  };
  await ctx.stack.ledger.upsert(task);
  await traceWrite(ctx, "ledger", "upsert", { task, source: "writer_gap" }, { taskId: task.taskId, reportNodeId: task.reportNodeId, branchId: task.branchId });
  await ctx.emit({
    eventType: "writer_gap_repair",
    reportNodeId: leaf.node.nodeId,
    payload: { reason, repairTaskId: task.taskId },
  });
}

function leafCitationCandidates(bundle: ReportBundle, evidence: ReportEvidenceItem[]): Array<Record<string, unknown>> {
  return evidence.slice(0, REPORT_NODE_EVIDENCE_LIMIT).flatMap((item) => {
    const citationId = citationForKnowledge(bundle, item.knowledge);
    if (!citationId || !item.knowledge.url) return [];
    return [{
      citationId,
      relation: item.link.relation,
      claimText: truncate(item.link.claimText, REPORT_CLAIM_TEXT_CHARS),
      source: {
        title: truncate(item.knowledge.title, REPORT_SOURCE_SUMMARY_CHARS),
        url: item.knowledge.url,
        sourceTier: item.knowledge.sourceTier,
        summary: truncate(item.knowledge.summary ?? "", REPORT_SOURCE_SUMMARY_CHARS),
        metadata: compactKnowledgeMetadata(item.knowledge.metadata),
      },
    }];
  });
}

class WriterCitationToolRegistry implements ToolRegistry {
  readonly excerpts: WriterSourceExcerpt[] = [];
  private readonly fetchedCitationIds = new Set<string>();
  private readonly candidateById: Map<string, Record<string, unknown>>;

  constructor(
    private readonly ctx: PhaseContext,
    private readonly bundle: ReportBundle,
    private readonly leaf: ReportBundle["tree"][number],
    candidates: Array<Record<string, unknown>>,
    private readonly maxFetchCalls: number,
  ) {
    this.candidateById = new Map(candidates
      .map((candidate) => [typeof candidate.citationId === "string" ? candidate.citationId : "", candidate] as const)
      .filter(([citationId]) => citationId.length > 0));
  }

  listTools(): ToolDefinition[] {
    return [{
      toolName: "fetch_citation_source",
      description: "Fetch full source content for one citationId already attached to this leaf report node.",
      inputSchema: { citationId: "string" },
    }];
  }

  async invoke(req: ToolCallRequest): Promise<ToolCallResult> {
    const startedAt = Date.now();
    try {
      if (req.toolName !== "fetch_citation_source") throw new Error(`Unsupported writer tool: ${req.toolName}`);
      const args = object(req.args);
      const citationId = typeof args.citationId === "string" ? args.citationId : "";
      if (!citationId) throw new Error("citationId is required");
      if (!this.candidateById.has(citationId)) throw new Error(`Citation is not available for this leaf: ${citationId}`);
      if (this.fetchedCitationIds.has(citationId)) {
        return { toolName: req.toolName, ok: true, output: { citationId, skipped: true, reason: "already_fetched" }, durationMs: Date.now() - startedAt };
      }
      if (this.excerpts.length >= this.maxFetchCalls) {
        return { toolName: req.toolName, ok: false, error: `Writer source fetch budget exceeded: ${this.maxFetchCalls}`, durationMs: Date.now() - startedAt };
      }
      const excerpt = await this.fetchCitation(citationId, req.agentRunId);
      this.fetchedCitationIds.add(citationId);
      if (excerpt) this.excerpts.push(excerpt);
      return { toolName: req.toolName, ok: true, output: excerpt ?? { citationId, skipped: true, reason: "fetch_failed_or_empty" }, durationMs: Date.now() - startedAt };
    } catch (err) {
      return { toolName: req.toolName, ok: false, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - startedAt };
    }
  }

  private async fetchCitation(citationId: string, agentRunId?: string): Promise<WriterSourceExcerpt | undefined> {
    const citation = this.bundle.globalEvidenceIndex.find((item) => item.citationId === citationId);
    if (!citation?.url) return undefined;
    const fetchCfg = this.ctx.state.runtimeProfile.tools.fetch_page;
    const reportSourceCfg = this.ctx.state.runtimeProfile.tools.report_source;
    const configuredMaxChars = reportSourceCfg?.maxChars ?? Math.max(fetchCfg?.maxChars ?? 12000, 20000);
    const maxChars = Math.min(configuredMaxChars, REPORT_SOURCE_EXCERPT_CHARS);
    const page = await tracedFetchPage(this.ctx, "report.leaf.inspect", citation.url, {
      timeoutMs: reportSourceCfg?.timeoutMs ?? fetchCfg?.timeoutMs,
      maxChars,
    }, { reportNodeId: this.leaf.node.nodeId, agentRunId });
    if (!page) return undefined;
    return {
      citationId,
      title: page.title || citation.title,
      url: page.url || citation.url,
      contentExcerpt: truncate(page.content, maxChars),
    };
  }
}

function adaptWriterInspectionResponse(response: { content: string; reasoning?: string }, prompt: string): { content: string; reasoning?: string } {
  const parsed = parseJsonObject(response.content);
  if (!parsed || typeof parsed.action === "string") return response;
  const citationIds = Array.isArray(parsed.citationIds)
    ? parsed.citationIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : undefined;
  if (!citationIds) return response;
  const alreadyFetched = prompt.includes("\"step\": 1") && prompt.includes("\"toolName\": \"fetch_citation_source\"");
  if (citationIds.length === 0 || alreadyFetched) {
    return {
      ...response,
      content: JSON.stringify({
        thoughtSummary: typeof parsed.reasoningSummary === "string" ? parsed.reasoningSummary : "Writer source inspection finished.",
        action: "finish",
        finish: { reasoningSummary: parsed.reasoningSummary ?? "" },
      }),
    };
  }
  return {
    ...response,
    content: JSON.stringify({
      thoughtSummary: typeof parsed.reasoningSummary === "string" ? parsed.reasoningSummary : "Fetch selected citation source.",
      action: "tool",
      toolName: "fetch_citation_source",
      args: { citationId: citationIds[0] },
    }),
  };
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value);
    return object(parsed);
  } catch {
    return undefined;
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function formatSourceExcerpts(excerpts: WriterSourceExcerpt[]): string {
  if (excerpts.length === 0) return "[]";
  let remaining = REPORT_SOURCE_EXCERPT_TOTAL_CHARS;
  return JSON.stringify(excerpts.map((excerpt) => ({
    citationId: excerpt.citationId,
    title: excerpt.title,
    url: excerpt.url,
    contentExcerpt: takeExcerpt(excerpt.contentExcerpt),
  })), null, 2);

  function takeExcerpt(value: string): string {
    const limit = Math.max(0, Math.min(REPORT_SOURCE_EXCERPT_CHARS, remaining));
    const out = truncate(value, limit);
    remaining -= out.length;
    return out;
  }
}

export { generateLeafFirstLlmReport, runWriterDraftAgent };
