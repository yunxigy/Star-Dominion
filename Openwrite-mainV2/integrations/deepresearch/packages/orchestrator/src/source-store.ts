import type { EvidenceLink, KnowledgeNode } from "@deepresearch/contracts";
import { isoNow } from "./infra/ids.js";
import { assessSourceQuality, calibrateSourceQualityScore } from "./source-quality.js";
import { buildSourceSummary, canonicalizeSourceUrl, inferSourceCoveragePeriod, knowledgeNodeIdForUrl, sourceContentHash } from "./source-identity.js";
import { traceWrite } from "./trace.js";
import type { PhaseContext } from "./types.js";

export interface SaveKnowledgeSourceInput {
  taskId: string;
  reportNodeId: string;
  branchId?: string;
  agentRunId?: string;
  index: number;
  title: string;
  url: string;
  snippet?: string;
  description?: string;
  content?: string;
  publishedAt?: string;
  publisher?: string;
  authors?: string[];
  sourceTier?: KnowledgeNode["sourceTier"];
  qualityScore: number;
}

export interface SaveSourceInput extends SaveKnowledgeSourceInput {
  relation: EvidenceLink["relation"];
  claimText: string;
  confidence: number;
}

export interface SaveKnowledgeSourceResult {
  knowledgeNodeId: string;
  reused: boolean;
}

export interface SaveSourceResult {
  knowledgeNodeId: string;
  evidenceLinkId: string;
  reused: boolean;
}

const LOW_SIGNAL_BACKGROUND_CONFIDENCE = 0.25;

export async function saveKnowledgeSource(ctx: PhaseContext, input: SaveKnowledgeSourceInput): Promise<SaveKnowledgeSourceResult | undefined> {
  const fetchedPage = cachedFetchedPage(ctx, input.url, input.content);
  const trustedContent = fetchedPage?.content ?? (!ctx.stack.fetch ? input.content : undefined);
  const focusedPassages = extractFocusedSourcePassages(trustedContent);
  const publishedAt = verifiedSourcePublishedAt(input.publishedAt, [
    input.title,
    input.url,
    input.snippet,
    input.description,
    trustedContent,
  ]);
  const contentProvenance = fetchedPage ? "fetch_cache" : trustedContent ? "provided_without_fetch_provider" : undefined;
  const sourceText = trustedContent || input.snippet || input.title;
  const coverage = inferSourceCoveragePeriod({
    title: input.title,
    url: input.url,
    snippet: input.snippet,
    description: input.description,
    content: trustedContent,
  });
  const quality = assessSourceQuality({
    title: input.title,
    url: input.url,
    snippet: input.snippet,
    description: input.description,
    content: trustedContent,
  });
  const meta = {
    taskId: input.taskId,
    reportNodeId: input.reportNodeId,
    branchId: input.branchId,
    agentRunId: input.agentRunId,
  };
  if (!quality.usable) {
    await traceWrite(ctx, "kg", "skipKnowledgeNode", {
      reason: quality.reason,
      title: input.title,
      url: input.url,
    }, meta);
    return undefined;
  }

  const now = isoNow(ctx.now);
  const canonicalUrl = canonicalizeSourceUrl(input.url);
  const storedUrl = sourceUrlForStorage(input.url, canonicalUrl);
  const credibility = calibrateSourceQualityScore({
    url: canonicalUrl || input.url,
    declaredTier: input.sourceTier,
    declaredScore: input.qualityScore,
    fetched: Boolean(trustedContent),
  });
  const nodeId = knowledgeNodeIdForUrl(canonicalUrl, `${input.title}\n${sourceText}`);
  const existing = await ctx.stack.kg.getKnowledgeNode(nodeId);
  let reused = false;
  if (existing) {
    reused = true;
    // Re-run calibration over the merged record so a newly introduced host
    // policy can downgrade primary/high-score nodes restored from a checkpoint.
    const mergedCredibility = calibrateSourceQualityScore({
      url: canonicalUrl || input.url,
      declaredTier: preferSourceTier(existing.sourceTier, credibility.sourceTier),
      declaredScore: Math.max(existing.qualityScore, credibility.qualityScore),
      fetched: Boolean(existing.metadata.fetched) || Boolean(trustedContent),
    });
    const next: KnowledgeNode = {
      ...existing,
      title: preferredReusedSourceTitle(existing, input.title),
      // Keep a URL that was actually fetched. The canonical identity may
      // intentionally normalize tracking parameters and trailing slashes, but
      // some origins (notably EUR-Lex) do not serve the normalized path.
      url: storedUrl || existing.url || canonicalUrl,
      summary: preferLonger(existing.summary, buildSourceSummary({ ...input, content: trustedContent })),
      sourceTier: mergedCredibility.sourceTier,
      qualityScore: mergedCredibility.qualityScore,
      metadata: {
        ...existing.metadata,
        canonicalUrl,
        aliases: uniqueStrings([...(asStringArray(existing.metadata.aliases)), input.url, canonicalUrl]),
        reusedByTaskIds: uniqueStrings([...(asStringArray(existing.metadata.reusedByTaskIds)), input.taskId]),
        searchSnippet: preferLonger(String(existing.metadata.searchSnippet ?? ""), input.snippet ?? ""),
        description: existing.metadata.description || input.description,
        publishedAt: existing.metadata.publishedAt || publishedAt,
        coverageStart: existing.metadata.coverageStart || coverage.coverageStart,
        coverageEnd: existing.metadata.coverageEnd || coverage.coverageEnd,
        discardedUnverifiedPublishedAt: publishedAt ? existing.metadata.discardedUnverifiedPublishedAt : input.publishedAt,
        publisher: existing.metadata.publisher || input.publisher,
        authors: uniqueStrings([...(asStringArray(existing.metadata.authors)), ...(input.authors ?? [])]),
        fetched: Boolean(existing.metadata.fetched) || Boolean(trustedContent),
        fetchProvider: existing.metadata.fetchProvider || (fetchedPage ? ctx.stack.fetch?.name : undefined),
        contentPreview: preferLonger(String(existing.metadata.contentPreview ?? ""), trustedContent ? trustedContent.slice(0, 12000) : ""),
        focusedPassages: uniqueStrings([
          ...asStringArray(existing.metadata.focusedPassages),
          ...focusedPassages,
        ]).slice(-16),
        contentProvenance: existing.metadata.contentProvenance || contentProvenance,
        latestDeclaredSourceTier: input.sourceTier,
        latestDeclaredQualityScore: input.qualityScore,
        qualitySignals: uniqueStrings([...(asStringArray(existing.metadata.qualitySignals)), ...mergedCredibility.signals]),
      },
    };
    await ctx.stack.kg.upsertKnowledgeNode(next);
    await traceWrite(ctx, "kg", "reuseKnowledgeNode", { knowledge: next, knowledgeNodeId: nodeId, url: input.url, canonicalUrl }, meta);
  } else {
    const knowledge: KnowledgeNode = {
      nodeId,
      nodeType: "WebPage",
      title: input.title || input.url,
      url: storedUrl,
      contentHash: sourceContentHash(canonicalUrl || input.url, sourceText),
      summary: buildSourceSummary({ ...input, content: trustedContent }),
      sourceTier: credibility.sourceTier,
      qualityScore: credibility.qualityScore,
      retrievedByTaskId: input.taskId,
      retrievedAt: now,
      metadata: {
        canonicalUrl,
        aliases: uniqueStrings([input.url, canonicalUrl]),
        searchTitle: input.title,
        searchSnippet: input.snippet,
        fetched: Boolean(trustedContent),
        fetchProvider: fetchedPage ? ctx.stack.fetch?.name : undefined,
        contentPreview: trustedContent ? trustedContent.slice(0, 12000) : undefined,
        focusedPassages,
        contentProvenance,
        ignoredUnverifiedAgentContent: Boolean(input.content && !trustedContent) || undefined,
        description: input.description,
        publishedAt,
        coverageStart: coverage.coverageStart,
        coverageEnd: coverage.coverageEnd,
        discardedUnverifiedPublishedAt: input.publishedAt && !publishedAt ? input.publishedAt : undefined,
        publisher: input.publisher,
        authors: input.authors,
        declaredSourceTier: input.sourceTier,
        declaredQualityScore: input.qualityScore,
        qualitySignals: credibility.signals,
      },
    };
    await ctx.stack.kg.upsertKnowledgeNode(knowledge);
    await traceWrite(ctx, "kg", "upsertKnowledgeNode", { knowledge }, meta);
  }

  return { knowledgeNodeId: nodeId, reused };
}

function preferredReusedSourceTitle(existing: KnowledgeNode, incomingTitle: string): string {
  const searchTitle = typeof existing.metadata.searchTitle === "string" ? existing.metadata.searchTitle.trim() : "";
  const focusedLegalTitle = /\b(?:article\s+\d+|annex\s+[ivxlcdm]+(?:\s+part\s+[a-z0-9]+)?)\b/iu;
  if (searchTitle && focusedLegalTitle.test(incomingTitle) && !focusedLegalTitle.test(searchTitle)) return searchTitle;
  if (focusedLegalTitle.test(incomingTitle) && !focusedLegalTitle.test(existing.title)) return existing.title;
  return preferLonger(existing.title, incomingTitle);
}

function sourceUrlForStorage(fetchedUrl: string, canonicalUrl: string): string {
  if (!canonicalUrl || canonicalUrl === fetchedUrl) return fetchedUrl;
  try {
    const fetched = new URL(fetchedUrl);
    const canonical = new URL(canonicalUrl);
    // Removing tracking parameters does not change the retrievable resource,
    // so expose the stable URL. Preserve other canonicalization differences
    // such as a trailing-slash path because some origins route them differently.
    if (fetched.origin === canonical.origin && fetched.pathname === canonical.pathname) {
      const canonicalEntries = Array.from(canonical.searchParams.entries());
      const canonicalIsSubset = canonicalEntries.every(([key, value]) => fetched.searchParams.getAll(key).includes(value));
      if (canonicalIsSubset) return canonicalUrl;
    }
  } catch {
    // Keep the actually fetched representation for non-standard URL strings.
  }
  return fetchedUrl;
}

/** Only retain a model-supplied publication date when the source exposes it. */
export function verifiedSourcePublishedAt(
  value: string | undefined,
  sourceParts: Array<string | undefined>,
): string | undefined {
  const candidate = value?.trim();
  if (!candidate) return undefined;
  const parsed = Date.parse(candidate);
  if (!Number.isFinite(parsed)) return undefined;
  const text = sourceParts.filter(Boolean).join(" ").normalize("NFKC").toLowerCase();
  const iso = new Date(parsed).toISOString().slice(0, 10);
  const [year, month, day] = iso.split("-");
  if (/^\d{4}$/.test(candidate)) {
    return new RegExp(`(?:^|\\D)${candidate}(?:\\D|$)`).test(text) ? candidate : undefined;
  }
  const exposedForms = [
    iso,
    `${year}/${month}/${day}`,
    `${year}.${month}.${day}`,
    `${year}-${Number(month)}-${Number(day)}`,
    `${year}/${Number(month)}/${Number(day)}`,
  ];
  return exposedForms.some((form) => text.includes(form.toLowerCase())) ? candidate : undefined;
}

function cachedFetchedPage(ctx: PhaseContext, url: string, preferredContent?: string): { url: string; title: string; content: string; description?: string } | undefined {
  const canonical = canonicalizeSourceUrl(url);
  if (!canonical) return undefined;
  const matches = Array.from(ctx.state.fetchCache.entries()).flatMap(([key, page]) => {
    if (!page) return [];
    const keyUrl = key.split("::", 1)[0] ?? "";
    return canonicalizeSourceUrl(page.url) === canonical || canonicalizeSourceUrl(keyUrl) === canonical ? [page] : [];
  });
  return matches.find((page) => preferredContent !== undefined && page.content === preferredContent)
    ?? matches.sort((a, b) => b.content.length - a.content.length)[0];
}

export function extractFocusedSourcePassages(content: string | undefined): string[] {
  if (!content) return [];
  const markers = Array.from(content.matchAll(/---\s*Focused source passage\s+\d+[^\n]*---/giu));
  return markers.flatMap((marker, index) => {
    const start = marker.index ?? 0;
    const end = markers[index + 1]?.index ?? content.length;
    const passage = content.slice(start, end).trim().slice(0, 5_000);
    return passage ? [passage] : [];
  });
}

export async function saveSourceEvidence(ctx: PhaseContext, input: SaveSourceInput): Promise<SaveSourceResult | undefined> {
  const metricMismatch = await evidenceClaimMetricMismatch(ctx, input.reportNodeId, input.relation, input.claimText);
  if (metricMismatch) {
    await traceWrite(ctx, "kg", "skipEvidenceLink", {
      reason: "claim_metric_mismatch",
      detail: metricMismatch,
      claimText: input.claimText,
      relation: input.relation,
    }, {
      taskId: input.taskId,
      reportNodeId: input.reportNodeId,
      branchId: input.branchId,
      agentRunId: input.agentRunId,
    });
    return undefined;
  }
  if (isLowSignalBackground(input)) {
    recordSourceGuard(ctx, input, "low_signal_background");
    await traceWrite(ctx, "kg", "skipEvidenceLink", {
      reason: "low_signal_background",
      title: input.title,
      url: input.url,
      relation: input.relation,
      confidence: input.confidence,
      claimText: input.claimText,
    }, {
      taskId: input.taskId,
      reportNodeId: input.reportNodeId,
      branchId: input.branchId,
      agentRunId: input.agentRunId,
    });
    return undefined;
  }
  const guard = findSourceGuard(ctx, input);
  if (guard?.sameClaim && input.relation === "background") {
    await traceWrite(ctx, "kg", "skipEvidenceLink", {
      reason: "guarded_low_signal_source",
      previousReason: guard.guard.reason,
      title: input.title,
      url: input.url,
      canonicalUrl: guard.guard.canonicalUrl,
      reportNodeId: input.reportNodeId,
      claimText: input.claimText,
    }, {
      taskId: input.taskId,
      reportNodeId: input.reportNodeId,
      branchId: input.branchId,
      agentRunId: input.agentRunId,
    });
    return undefined;
  }
  if (guard) {
    await traceWrite(ctx, "kg", "sourceGuardNotice", {
      reason: "previous_low_signal_source",
      previousReason: guard.guard.reason,
      sameReportNode: guard.sameReportNode,
      sameClaim: guard.sameClaim,
      title: input.title,
      url: input.url,
      canonicalUrl: guard.guard.canonicalUrl,
      previousClaimText: guard.guard.claimText,
      currentClaimText: input.claimText,
    }, {
      taskId: input.taskId,
      reportNodeId: input.reportNodeId,
      branchId: input.branchId,
      agentRunId: input.agentRunId,
    });
  }
  const saved = await saveKnowledgeSource(ctx, input);
  if (!saved) return undefined;

  const now = isoNow(ctx.now);
  const meta = {
    taskId: input.taskId,
    reportNodeId: input.reportNodeId,
    branchId: input.branchId,
    agentRunId: input.agentRunId,
  };

  const evidenceLinkId = `E_${input.taskId}_${input.index}`;
  const duplicate = await findDuplicateEvidenceLink(ctx, input, saved.knowledgeNodeId);
  if (duplicate) {
    await traceWrite(ctx, "kg", "reuseEvidenceLink", { link: duplicate, reason: "same_task_source_claim" }, meta);
    return { knowledgeNodeId: saved.knowledgeNodeId, evidenceLinkId: duplicate.linkId, reused: true };
  }
  const link: EvidenceLink = {
    linkId: evidenceLinkId,
    reportNodeId: input.reportNodeId,
    knowledgeNodeId: saved.knowledgeNodeId,
    relation: input.relation,
    claimText: input.claimText,
    confidence: input.confidence,
    createdByTaskId: input.taskId,
    createdAt: now,
  };
  await ctx.stack.kg.upsertEvidenceLink(link);
  await traceWrite(ctx, "kg", "upsertEvidenceLink", { link }, meta);
  return { knowledgeNodeId: saved.knowledgeNodeId, evidenceLinkId, reused: saved.reused };
}

export async function evidenceClaimMetricMismatch(
  ctx: PhaseContext,
  reportNodeId: string,
  relation: EvidenceLink["relation"],
  claimText: string,
): Promise<string | undefined> {
  if (relation !== "supports") return undefined;
  const reportNode = await ctx.stack.kg.getReportNode(reportNodeId);
  const requirementIds = new Set(reportNode?.requirementIds ?? []);
  const requirementTexts = (ctx.state.globalRubric?.requirements ?? [])
    .filter((requirement) => requirementIds.has(requirement.requirementId))
    .map((requirement) => [requirement.description, ...requirement.evidenceNeeds, ...requirement.successCriteria, ...(requirement.metricScope ?? [])].join(" "));
  const materialRecoveryPattern = /材料回收(?:率|目标)|material\s+recovery\s+rate|recovery\s+of\s+materials/iu;
  const requiresMaterialRecovery = requirementTexts.some((value) => materialRecoveryPattern.test(value));
  const separatelyRequiresRecyclingEfficiency = requirementTexts.some((value) => (
    /(?:电池)?回收效率|recycling\s+efficiency/iu.test(value) && !materialRecoveryPattern.test(value)
  ));
  const claimIsOnlyRecyclingEfficiency = /(?:电池|锂基电池)?(?:的)?回收效率|recycling\s+efficiency/iu.test(claimText)
    && !/材料回收(?:率|目标)|材料的回收|material\s+recovery\s+rate|recovery\s+of\s+materials/iu.test(claimText);
  return requiresMaterialRecovery && !separatelyRequiresRecyclingEfficiency && claimIsOnlyRecyclingEfficiency
    ? "The owned requirement asks for recovery of a material, but the supporting claim reports whole-battery recycling efficiency. These are distinct metrics."
    : undefined;
}

async function findDuplicateEvidenceLink(ctx: PhaseContext, input: SaveSourceInput, knowledgeNodeId: string): Promise<EvidenceLink | undefined> {
  const links = await ctx.stack.kg.listEvidenceLinksByKnowledgeNode(knowledgeNodeId);
  return links.find((link) => (
    link.reportNodeId === input.reportNodeId
    && link.createdByTaskId === input.taskId
    && link.relation === input.relation
    && normalizeClaim(link.claimText) === normalizeClaim(input.claimText)
  ));
}

function isLowSignalBackground(input: SaveSourceInput): boolean {
  return input.relation === "background" && input.confidence < LOW_SIGNAL_BACKGROUND_CONFIDENCE;
}

export function recordSourceGuard(ctx: PhaseContext, input: SaveSourceInput, reason: string): void {
  const canonicalUrl = canonicalizeSourceUrl(input.url) || input.url;
  const claimKey = normalizeClaim(input.claimText);
  const existing = ctx.state.sourceGuards.find((guard) => (
    guard.canonicalUrl === canonicalUrl
    && guard.reportNodeId === input.reportNodeId
    && guard.claimKey === claimKey
  ));
  if (existing) return;
  ctx.state.sourceGuards.push({
    canonicalUrl,
    url: input.url,
    title: input.title,
    reportNodeId: input.reportNodeId,
    taskId: input.taskId,
    relation: input.relation,
    claimKey,
    claimText: input.claimText,
    reason,
    confidence: input.confidence,
    createdAt: isoNow(ctx.now),
  });
}

function findSourceGuard(ctx: PhaseContext, input: SaveSourceInput): { guard: PhaseContext["state"]["sourceGuards"][number]; sameReportNode: boolean; sameClaim: boolean } | undefined {
  const canonicalUrl = canonicalizeSourceUrl(input.url) || input.url;
  const claimKey = normalizeClaim(input.claimText);
  const guard = ctx.state.sourceGuards.find((item) => item.canonicalUrl === canonicalUrl);
  if (!guard) return undefined;
  return {
    guard,
    sameReportNode: guard.reportNodeId === input.reportNodeId,
    sameClaim: guard.reportNodeId === input.reportNodeId && guard.claimKey === claimKey,
  };
}

function normalizeClaim(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function preferLonger(a: string, b: string): string {
  return b.length > a.length ? b : a;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function preferSourceTier(a: KnowledgeNode["sourceTier"], b: KnowledgeNode["sourceTier"]): KnowledgeNode["sourceTier"] {
  const rank = (tier: KnowledgeNode["sourceTier"]): number => tier === "official" ? 4 : tier === "primary" ? 3 : tier === "secondary" ? 2 : 1;
  return rank(b) > rank(a) ? b : a;
}
