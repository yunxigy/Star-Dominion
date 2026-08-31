import { createHash } from "node:crypto";
import type { AgentNodePartPlan, EvidenceLink, KnowledgeNode, NewTaskRequest, OpenGap, StructurePatchSuggestion, TaskItem, ToolCallRequest, ToolCallResult, ToolDefinition, ToolRegistry } from "@deepresearch/contracts";
import { isCompleteStudyRowReportlet } from "./counted-rows.js";
import { parseLlmJson } from "./infra/ai.js";
import { isoNow, shortId } from "./infra/ids.js";
import { canonicalizeSourceUrl, sourcePublisherDomain } from "./source-identity.js";
import { assessSourceUrlPolicy } from "./source-quality.js";
import { evidenceClaimMetricMismatch, extractFocusedSourcePassages, saveKnowledgeSource, saveSourceEvidence } from "./source-store.js";
import { traceWrite, tracedFetchPage, tracedLlmChat, tracedSearch } from "./trace.js";
import type { PhaseContext } from "./types.js";

const MAX_BACKGROUND_SAVES_PER_AGENT = 2;

export const scoutTools: ToolDefinition[] = [
  { toolName: "web_search", description: "Search the web for initial source mapping." },
  { toolName: "fetch_page", description: "Fetch readable page content." },
  { toolName: "save_knowledge_node", description: "Save a source as a KnowledgeNode and auto-link it." },
  { toolName: "link_evidence", description: "Create an EvidenceLink between report and knowledge. claimText must state the concrete supported, qualified, or contradicted claim." },
  { toolName: "finish_scout", description: "Finish scout and summarize findings." },
];

export const evidenceTools: ToolDefinition[] = [
  { toolName: "web_search", description: "Search for evidence for the current task." },
  { toolName: "fetch_page", description: "Fetch readable page content. Pass query or focusTerms for long documents so the returned excerpt is centered on the exact article, metric, entity, or value being researched." },
  { toolName: "calculate_distribution_indices", description: "Deterministically calculate Atkinson, Hoover, and Theil inequality indices from exact source-grounded weight and value arrays; returns normalized shares and per-entry ratios for audit." },
  { toolName: "inspect_knowledge_node", description: "Inspect a previously saved source, including its cached full-content preview, before searching or fetching it again." },
  { toolName: "inspect_knowledge_nodes", description: "Batch-inspect up to four previously saved sources and extract query-relevant cached pages without network requests." },
  { toolName: "refresh_knowledge_node", description: "Force-refresh one previously saved source whose inspection shows insufficient cached content, then upgrade the same KnowledgeNode." },
  { toolName: "save_knowledge_node", description: "Save a source and auto-link it to the current report node." },
  { toolName: "link_evidence", description: "Link saved knowledge to a report node with a concrete claimText. Pass a K_ KnowledgeNode id; an existing E_ EvidenceLink id is also accepted and resolved safely." },
  { toolName: "open_gap", description: "Record a missing evidence gap." },
  { toolName: "suggest_patch", description: "Suggest a structure patch without applying it." },
];

export const countedRowHarvestTool: ToolDefinition = {
  toolName: "harvest_counted_rows",
  description: "Atomically search, fetch, extract, validate, deduplicate, and save complete counted study rows. Returns saved KnowledgeNode/EvidenceLink IDs and cited reportlet markdown.",
};

export const runtimeTools: ToolDefinition[] = [
  ...evidenceTools,
  { toolName: "create_task", description: "Create a queued follow-up task through the ledger." },
  { toolName: "list_report_tree", description: "List the current report tree with status and coverage." },
  { toolName: "list_relevant_evidence", description: "List evidence links and sources for a report node." },
];

export interface PhaseToolRegistryOptions {
  tools?: ToolDefinition[];
  phase?: string;
  taskId?: string;
  reportNodeId?: string;
  branchId?: string;
  agentRunId?: string;
  countedRowReportNodeIds?: string[];
  countedRowHarvest?: {
    query: string;
    target: number;
    excludedUrls: string[];
    excludedTitles: string[];
    acceptanceCriteria: string[];
    plannedReportlets: Array<Pick<AgentNodePartPlan, "partId" | "expectedHeading">>;
  };
}

interface CountedRowCandidate {
  title: string;
  url: string;
  snippet: string;
  description?: string;
  content: string;
}

interface ExtractedCountedRow {
  candidateUrl?: string;
  title?: string;
  authors?: string[] | string;
  country?: string;
  sampleSize?: string;
  researchDesign?: string;
  outcomeVariable?: string;
  findingLabel?: string;
  findingExplanation?: string;
  publicationYear?: number | string;
  publishedAt?: string;
  publisher?: string;
  eligiblePrimaryStudy?: boolean;
}

interface NormalizedCountedRow {
  candidate: CountedRowCandidate;
  url: string;
  title: string;
  authors: string[];
  country: string;
  sampleSize: string;
  researchDesign: string;
  outcomeVariable: string;
  findingLabel: "Effective" | "Ineffective" | "Neutral";
  findingExplanation: string;
  publicationYear: number;
  publishedAt?: string;
  publisher?: string;
}

export function createPhaseToolRegistry(ctx: PhaseContext, opts: PhaseToolRegistryOptions = {}): ToolRegistry {
  return new PhaseToolRegistry(ctx, opts);
}

class PhaseToolRegistry implements ToolRegistry {
  private readonly tools: ToolDefinition[];
  private saveIndex = 0;
  private backgroundSaveCount = 0;
  private countedRowHarvestResult?: Record<string, unknown>;

  constructor(private readonly ctx: PhaseContext, private readonly opts: PhaseToolRegistryOptions) {
    this.tools = opts.tools ?? runtimeTools;
  }

  listTools(): ToolDefinition[] {
    return this.tools;
  }

  async invoke(req: ToolCallRequest): Promise<ToolCallResult> {
    const startedAt = Date.now();
    const definition = this.tools.find((tool) => tool.toolName === req.toolName);
    if (!definition) {
      return this.result(req.toolName, startedAt, false, undefined, `Tool is not available in this registry: ${req.toolName}`);
    }
    try {
      const output = await this.invokeKnown(req);
      return this.result(req.toolName, startedAt, true, output);
    } catch (err) {
      return this.result(req.toolName, startedAt, false, undefined, err instanceof Error ? err.message : String(err));
    }
  }

  private async invokeKnown(req: ToolCallRequest): Promise<unknown> {
    switch (req.toolName) {
      case "web_search":
        return this.webSearch(req);
      case "fetch_page":
        return this.fetchPage(req);
      case "calculate_distribution_indices":
        return this.calculateDistributionIndices(req);
      case "harvest_counted_rows":
        return this.harvestCountedRows(req);
      case "save_knowledge_node":
        return this.saveKnowledgeNode(req);
      case "link_evidence":
        return this.linkEvidence(req);
      case "open_gap":
        return this.openGap(req);
      case "suggest_patch":
        return this.suggestPatch(req);
      case "create_task":
        return this.createTask(req);
      case "inspect_knowledge_node":
        return this.inspectKnowledgeNode(req);
      case "inspect_knowledge_nodes":
        return this.inspectKnowledgeNodes(req);
      case "refresh_knowledge_node":
        return this.refreshKnowledgeNode(req);
      case "list_report_tree":
        return this.listReportTree();
      case "list_relevant_evidence":
        return this.listRelevantEvidence(req);
      default:
        throw new Error(`No handler implemented for tool: ${req.toolName}`);
    }
  }

  private async webSearch(req: ToolCallRequest): Promise<unknown> {
    const args = object(req.args);
    const query = requiredString(args.query, "query");
    const topK = numberOr(args.topK, this.ctx.state.runtimeProfile.tools.web_search?.topK ?? 10);
    const results = await tracedSearch(this.ctx, this.phase(), query, topK, this.meta(req));
    await this.emitSourceGuardSearchNotices(query, results, this.meta(req));
    return results;
  }

  private async emitSourceGuardSearchNotices(
    query: string,
    results: Array<{ url: string; title: string; snippet: string }>,
    meta: { taskId?: string; reportNodeId?: string; branchId?: string; agentRunId?: string },
  ): Promise<void> {
    const reportNodeId = meta.reportNodeId;
    const guarded = results.flatMap((result) => {
      const canonicalUrl = canonicalizeSourceUrl(result.url) || result.url;
      const guard = this.ctx.state.sourceGuards.find((item) => item.canonicalUrl === canonicalUrl);
      return guard ? [{ result, guard, sameReportNode: Boolean(reportNodeId && guard.reportNodeId === reportNodeId) }] : [];
    }).slice(0, 5);
    if (!guarded.length) return;
    await traceWrite(this.ctx, "kg", "sourceGuardNotice", {
      reason: "search_returned_guarded_source",
      query,
      guardedCount: guarded.length,
      guardedSources: guarded.map((item) => ({
        title: item.result.title,
        url: item.result.url,
        previousReason: item.guard.reason,
        previousReportNodeId: item.guard.reportNodeId,
        previousClaimText: item.guard.claimText,
        sameReportNode: item.sameReportNode,
      })),
    }, meta);
  }

  private async fetchPage(req: ToolCallRequest): Promise<unknown> {
    const args = object(req.args);
    const url = requiredString(args.url, "url");
    const fetchCfg = this.ctx.state.runtimeProfile.tools.fetch_page;
    const explicitFocus = uniqueStrings([
      ...(typeof args.focusTerms === "string" && args.focusTerms.trim()
        ? [args.focusTerms.trim()]
        : stringArrayOr(args.focusTerms, [])),
      ...[stringOrUndefined(args.query)].filter((item): item is string => Boolean(item)),
    ]).map((value) => sanitizeUnverifiedToolFocusNumbers(value, this.ctx.state.submission.userInput)).filter(Boolean).slice(0, 16);
    const page = await tracedFetchPage(this.ctx, this.phase(), url, {
      timeoutMs: numberOrUndefined(args.timeoutMs) ?? fetchCfg?.timeoutMs,
      maxChars: numberOrUndefined(args.maxChars) ?? fetchCfg?.maxChars,
      focusTerms: explicitFocus.length > 0 ? explicitFocus : undefined,
    }, this.meta(req));
    if (page) await this.persistFocusedPassagesForKnownSource(url, page, req);
    if (!page || explicitFocus.length === 0) return page;
    const selected = selectRelevantSourceExcerpt(page.content, explicitFocus.join(" "), 12_000);
    return {
      ...page,
      content: selected.excerpt,
      fullContentChars: page.content.length,
      focusedExcerptOffsets: selected.offsets,
    };
  }

  private async persistFocusedPassagesForKnownSource(
    requestedUrl: string,
    page: { url: string; title: string; content: string; description?: string },
    req: ToolCallRequest,
  ): Promise<void> {
    const fetchedPassages = extractFocusedSourcePassages(page.content);
    if (fetchedPassages.length === 0) return;
    const fetchedIdentities = new Set([
      canonicalizeSourceUrl(requestedUrl),
      canonicalizeSourceUrl(page.url),
    ].filter(Boolean));
    const knowledge = (await this.ctx.stack.kg.listKnowledgeNodes()).find((node) => {
      const aliases = Array.isArray(node.metadata.aliases)
        ? node.metadata.aliases.filter((value): value is string => typeof value === "string")
        : [];
      return [node.url, typeof node.metadata.canonicalUrl === "string" ? node.metadata.canonicalUrl : "", ...aliases]
        .map(canonicalizeSourceUrl)
        .some((identity) => fetchedIdentities.has(identity));
    });
    if (!knowledge) return;
    const existingPassages = Array.isArray(knowledge.metadata.focusedPassages)
      ? knowledge.metadata.focusedPassages.filter((value): value is string => typeof value === "string")
      : [];
    const focusedPassages = uniqueStrings([...existingPassages, ...fetchedPassages]).slice(-16);
    if (focusedPassages.length === existingPassages.length
      && focusedPassages.every((passage, index) => passage === existingPassages[index])) return;
    const aliases = Array.isArray(knowledge.metadata.aliases)
      ? knowledge.metadata.aliases.filter((value): value is string => typeof value === "string")
      : [];
    const taskId = this.opts.taskId;
    const reusedByTaskIds = Array.isArray(knowledge.metadata.reusedByTaskIds)
      ? knowledge.metadata.reusedByTaskIds.filter((value): value is string => typeof value === "string")
      : [];
    const next: KnowledgeNode = {
      ...knowledge,
      metadata: {
        ...knowledge.metadata,
        aliases: uniqueStrings([...aliases, requestedUrl, page.url]),
        fetched: true,
        fetchProvider: knowledge.metadata.fetchProvider || this.ctx.stack.fetch?.name,
        focusedPassages,
        reusedByTaskIds: taskId ? uniqueStrings([...reusedByTaskIds, taskId]) : reusedByTaskIds,
      },
    };
    await this.ctx.stack.kg.upsertKnowledgeNode(next);
    const bundle = this.ctx.state.reportBundle;
    if (bundle) {
      for (const entry of bundle.tree) {
        for (const evidence of entry.evidence) {
          if (evidence.knowledge.nodeId === next.nodeId) evidence.knowledge = next;
        }
      }
    }
    await traceWrite(this.ctx, "kg", "enrichKnowledgeNodeFromFetch", {
      knowledgeNodeId: knowledge.nodeId,
      addedFocusedPassageCount: focusedPassages.length - existingPassages.length,
      focusedPassageCount: focusedPassages.length,
      requestedUrl,
      fetchedUrl: page.url,
    }, this.meta(req));
  }

  private calculateDistributionIndices(req: ToolCallRequest): unknown {
    const args = object(req.args);
    const weights = distributionNumberArray(args.weights, "weights");
    const values = distributionNumberArray(args.values, "values");
    if (weights.length < 2 || weights.length > 64) {
      throw new Error("weights and values must contain between 2 and 64 entries");
    }
    if (values.length !== weights.length) {
      throw new Error("weights and values must have the same number of entries");
    }
    if (weights.some((value) => value <= 0)) {
      throw new Error("every weight must be strictly positive");
    }
    if (values.some((value) => value < 0)) {
      throw new Error("every value must be nonnegative");
    }
    if (!values.some((value) => value > 0)) {
      throw new Error("values must contain at least one positive entry");
    }
    const labels = distributionLabels(args.labels, weights.length);
    const atkinsonEpsilon = args.atkinsonEpsilon === undefined ? 1 : finiteDistributionNumber(args.atkinsonEpsilon, "atkinsonEpsilon");
    if (atkinsonEpsilon < 0) {
      throw new Error("atkinsonEpsilon must be nonnegative");
    }

    const weightTotal = finiteDistributionSum(weights, "weight total");
    const valueTotal = finiteDistributionSum(values, "value total");
    const entries = weights.map((weight, index) => {
      const value = values[index]!;
      const weightShare = weight / weightTotal;
      const valueShare = value / valueTotal;
      const logRelativeConcentration = value === 0
        ? Number.NEGATIVE_INFINITY
        : Math.log(value) - Math.log(valueTotal) - Math.log(weight) + Math.log(weightTotal);
      const relativeConcentration = value === 0 ? 0 : Math.exp(logRelativeConcentration);
      if (!Number.isFinite(weightShare) || !Number.isFinite(valueShare) || !Number.isFinite(relativeConcentration)) {
        throw new Error(`entry ${index + 1} produces a derived value outside the supported numeric range`);
      }
      return {
        index,
        ...(labels ? { label: labels[index] } : {}),
        weight,
        value,
        weightShare,
        valueShare,
        relativeConcentration,
        logRelativeConcentration,
      };
    });

    const hooverRatio = entries.reduce((sum, entry) => sum + Math.abs(entry.valueShare - entry.weightShare), 0) / 2;
    const theil = entries.reduce((sum, entry) => entry.valueShare === 0
      ? sum
      : sum + entry.valueShare * entry.logRelativeConcentration, 0);
    const atkinson = atkinsonIndex(entries, atkinsonEpsilon);
    return {
      entryCount: entries.length,
      weightTotal,
      valueTotal,
      atkinsonEpsilon,
      atkinson: roundDistributionMetric(clampDistributionUnit(atkinson)),
      hooverRatio: roundDistributionMetric(clampDistributionUnit(hooverRatio)),
      hooverPercent: roundDistributionMetric(clampDistributionUnit(hooverRatio) * 100),
      theil: roundDistributionMetric(Math.max(0, theil)),
      entries: entries.map(({ logRelativeConcentration: _log, ...entry }) => ({
        ...entry,
        weightShare: roundDistributionMetric(entry.weightShare),
        valueShare: roundDistributionMetric(entry.valueShare),
        relativeConcentration: roundDistributionMetric(entry.relativeConcentration),
      })),
    };
  }

  private async harvestCountedRows(req: ToolCallRequest): Promise<unknown> {
    const config = this.opts.countedRowHarvest;
    if (!config) throw new Error("harvest_counted_rows is available only for counted-row tasks");
    if (this.countedRowHarvestResult) {
      await this.ctx.emit({
        eventType: "counted_row_harvest_reused",
        ...this.meta(req),
        payload: { savedRowCount: numberOr(this.countedRowHarvestResult.savedRowCount, 0) },
      });
      return { ...this.countedRowHarvestResult, reused: true };
    }
    const args = object(req.args);
    const requestedQuery = stringOrUndefined(args.query) ?? config.query;
    const target = Math.max(1, Math.min(8, Math.floor(numberOr(args.target, config.target))));
    const regionQualifier = countedRowRegionQualifier(requestedQuery);
    const regionalQuery = [requestedQuery, regionQualifier].filter(Boolean).join(" ");
    const queries = uniqueStrings([
      regionalQuery,
      `${regionalQuery} authors sample size methods results`,
      `${regionalQuery} peer-reviewed journal DOI full text primary study participants results`,
    ]).slice(0, 3);
    const topK = Math.max(6, target * 2);
    const meta = this.meta(req);
    let batches = await Promise.all(queries.map((query) => (
      tracedSearch(this.ctx, `${this.phase()}.row-harvest`, query, topK, meta)
    )));
    const excluded = new Set(config.excludedUrls.map(countedRowUrlIdentity));
    const excludedTitleKeys = new Set(config.excludedTitles.map(normalizedStudyTitle).filter(Boolean));
    let hits = selectCountedRowHits(batches.flat(), excluded, excludedTitleKeys, Math.min(target + 4, 12));
    const fetchCfg = this.ctx.state.runtimeProfile.tools.fetch_page;
    let fetched = await Promise.all(hits.map(async (hit): Promise<CountedRowCandidate | undefined> => {
      try {
        const page = await tracedFetchPage(this.ctx, `${this.phase()}.row-harvest`, hit.url, {
          timeoutMs: fetchCfg?.timeoutMs,
          maxChars: Math.min(fetchCfg?.maxChars ?? 60_000, 24_000),
        }, meta);
        if (!page) throw new Error("fetch returned no readable page");
        return {
          title: page.title || hit.title,
          url: page.url || hit.url,
          snippet: hit.snippet,
          description: page.description,
          content: compactRowCandidateContent(page.content),
        };
      } catch {
        return undefined;
      }
    }));
    let candidates = fetched.filter((candidate): candidate is CountedRowCandidate => (
      Boolean(candidate?.content.trim()) && countedRowCandidateHasPrimaryMethodsAndResults(candidate!)
    ));
    let extraction = candidates.length > 0
      ? await this.extractCountedRows(candidates, config, meta)
      : { rows: [] as ExtractedCountedRow[], extractionError: "No readable candidate pages were fetched." };
    const temporalScope = countedRowYearRange(config.acceptanceCriteria);
    let candidateByUrl = countedRowCandidateMap(candidates);
    // Search once more only when the first extraction cannot plausibly fill the
    // requested slots. This keeps the common path fast while escaping repeated
    // low-quality portal results when the initial batch is short or rejected.
    if (countPotentialCountedRows(extraction.rows, candidateByUrl, temporalScope, config.excludedTitles) < target) {
      // Long task objectives are useful context for the extractor but are poor
      // search queries: providers may truncate the topical terms and return
      // unrelated regional policy or economics pages. Keep the one recovery
      // search concise while retaining the region qualifier and row fields.
      const fallbackQuery = `online learning higher education COVID-19 pandemic ${regionalQuery} peer-reviewed empirical study DOI full text methods sample size outcomes -review -meta-analysis -site:oalib.com -site:scirp.org -site:researchgate.net -site:academia.edu`;
      const fallbackBatch = await tracedSearch(this.ctx, `${this.phase()}.row-harvest.fallback`, fallbackQuery, Math.max(8, target * 2), meta);
      batches = [...batches, fallbackBatch];
      const extraHits = selectCountedRowHits(fallbackBatch, new Set([
        ...excluded,
        ...hits.map((hit) => countedRowUrlIdentity(hit.url)),
      ]), excludedTitleKeys, Math.min(target + 3, 8));
      const extraFetched = await Promise.all(extraHits.map(async (hit): Promise<CountedRowCandidate | undefined> => {
        try {
          const page = await tracedFetchPage(this.ctx, `${this.phase()}.row-harvest.fallback`, hit.url, {
            timeoutMs: fetchCfg?.timeoutMs,
            maxChars: Math.min(fetchCfg?.maxChars ?? 60_000, 24_000),
          }, meta);
          if (!page) return undefined;
          return {
            title: page.title || hit.title,
            url: page.url || hit.url,
            snippet: hit.snippet,
            description: page.description,
            content: compactRowCandidateContent(page.content),
          };
        } catch {
          return undefined;
        }
      }));
      fetched = [...fetched, ...extraFetched];
      candidates = [...candidates, ...extraFetched.filter((candidate): candidate is CountedRowCandidate => (
        Boolean(candidate?.content.trim()) && countedRowCandidateHasPrimaryMethodsAndResults(candidate!)
      ))];
      extraction = candidates.length > 0
        ? await this.extractCountedRows(candidates, config, meta, "row-harvest.fallback.extract")
        : extraction;
      candidateByUrl = countedRowCandidateMap(candidates);
    }
    const acceptedTitles = new Set(excludedTitleKeys);
    const savedRows: Array<{
      partId: string;
      title: string;
      markdown: string;
      citedEvidenceLinkIds: string[];
      citedKnowledgeNodeIds: string[];
      reasoningSummary: string;
      knowledgeNodeId: string;
      evidenceLinkId: string;
      url: string;
    }> = [];
    const rejectedRows: Array<{ title?: string; url?: string; reason: string }> = [];
    for (const [index, extracted] of extraction.rows.slice(0, target * 2).entries()) {
      if (savedRows.length >= target) break;
      const normalized = normalizeExtractedCountedRow(extracted, candidateByUrl, temporalScope);
      if (!normalized.ok) {
        rejectedRows.push({ title: extracted.title, url: extracted.candidateUrl, reason: normalized.reason });
        continue;
      }
      const titleKey = normalizedStudyTitle(normalized.row.title);
      if (!titleKey || acceptedTitles.has(titleKey)) {
        rejectedRows.push({ title: normalized.row.title, url: normalized.row.url, reason: "duplicate_study_title" });
        continue;
      }
      const duplicate = await this.existingCountedRowSource(normalized.row.url, normalized.row.title);
      if (duplicate) {
        rejectedRows.push({ title: normalized.row.title, url: normalized.row.url, reason: "counted_row_source_already_used" });
        continue;
      }
      const taskId = requiredString(meta.taskId, "taskId");
      const reportNodeId = requiredString(meta.reportNodeId, "reportNodeId");
      const saved = await saveSourceEvidence(this.ctx, {
        taskId,
        reportNodeId,
        branchId: meta.branchId,
        agentRunId: meta.agentRunId,
        index: index + 1,
        title: normalized.row.title,
        url: normalized.row.url,
        snippet: normalized.row.candidate.snippet,
        description: normalized.row.candidate.description,
        content: normalized.row.candidate.content,
        publishedAt: normalized.row.publishedAt ?? String(normalized.row.publicationYear),
        publisher: normalized.row.publisher,
        authors: normalized.row.authors,
        sourceTier: "primary",
        qualityScore: 0.82,
        relation: "supports",
        claimText: `${normalized.row.title} is an eligible primary study with a complete counted row classified ${normalized.row.findingLabel}.`,
        confidence: 0.82,
      });
      if (!saved) {
        rejectedRows.push({ title: normalized.row.title, url: normalized.row.url, reason: "source_quality_or_policy_rejected" });
        continue;
      }
      const part = config.plannedReportlets[savedRows.length];
      const markdown = countedRowMarkdown(normalized.row, saved.evidenceLinkId);
      if (!isCompleteStudyRowReportlet({ markdown, citedKnowledgeNodeIds: [saved.knowledgeNodeId] })) {
        rejectedRows.push({ title: normalized.row.title, url: normalized.row.url, reason: "strict_complete_row_validation_failed" });
        continue;
      }
      acceptedTitles.add(titleKey);
      savedRows.push({
        partId: part?.partId ?? `P_${savedRows.length + 1}`,
        title: part?.expectedHeading || normalized.row.title,
        markdown,
        citedEvidenceLinkIds: [saved.evidenceLinkId],
        citedKnowledgeNodeIds: [saved.knowledgeNodeId],
        reasoningSummary: `Atomically extracted and validated a complete counted row from ${normalized.row.title}.`,
        knowledgeNodeId: saved.knowledgeNodeId,
        evidenceLinkId: saved.evidenceLinkId,
        url: normalized.row.url,
      });
    }
    await traceWrite(this.ctx, "kg", "countedRowHarvest", {
      queryCount: batches.length,
      searchHitCount: batches.reduce((sum, batch) => sum + batch.length, 0),
      candidateCount: candidates.length,
      extractedRowCount: extraction.rows.length,
      savedRowCount: savedRows.length,
      rejectedRows,
      extractionError: extraction.extractionError,
    }, meta);
    await this.ctx.emit({
      eventType: "counted_row_harvest_finished",
      ...meta,
      payload: {
        queryCount: batches.length,
        searchHitCount: batches.reduce((sum, batch) => sum + batch.length, 0),
        candidateCount: candidates.length,
        extractedRowCount: extraction.rows.length,
        savedRowCount: savedRows.length,
        rejectedRows,
        extractionError: extraction.extractionError,
      },
    });
    const output = {
      queryCount: batches.length,
      searchHitCount: batches.reduce((sum, batch) => sum + batch.length, 0),
      excludedExistingCount: batches.flat().filter((hit) => excluded.has(countedRowUrlIdentity(hit.url))).length,
      excludedExistingTitleCount: batches.flat().filter((hit) => countedRowTitleMatchesAny(normalizedStudyTitle(hit.title), excludedTitleKeys)).length,
      fetchAttemptCount: fetched.length,
      fetchFailedCount: fetched.filter((candidate) => !candidate).length,
      candidateCount: candidates.length,
      extractedRowCount: extraction.rows.length,
      savedRowCount: savedRows.length,
      rows: savedRows,
      rejectedRows,
      extractionError: extraction.extractionError,
      instruction: "Rows in this result are already saved and contain real KnowledgeNode/EvidenceLink IDs plus cited reportlet markdown. Do not save or link them again. Finish using these rows; use direct search/fetch only when savedRowCount is below the requested target.",
    };
    this.countedRowHarvestResult = output;
    return output;
  }

  private async extractCountedRows(
    candidates: CountedRowCandidate[],
    config: NonNullable<PhaseToolRegistryOptions["countedRowHarvest"]>,
    meta: { taskId?: string; reportNodeId?: string; branchId?: string; agentRunId?: string },
    phaseSuffix = "row-harvest.extract",
  ): Promise<{ rows: ExtractedCountedRow[]; extractionError?: string }> {
    try {
      const llmCfg = this.ctx.state.runtimeProfile.llm.evidence;
      const response = await tracedLlmChat(this.ctx, `${this.phase()}.${phaseSuffix}`, {
        ...llmCfg,
        system: `You extract complete study-table rows only from fetched primary empirical source packets.
Return JSON only. Never infer or guess missing metadata. Reject reviews, editorials, repositories without article content, and sources outside the requested time window.
Every accepted row must have: candidateUrl, title, authors, country, sampleSize with a concrete participant count of at least 10, researchDesign, outcomeVariable, findingLabel (exactly Effective, Ineffective, or Neutral), findingExplanation, publicationYear, and eligiblePrimaryStudy=true.
Use Neutral for mixed findings and explain the mixture. The candidateUrl must exactly match one supplied packet.`,
        user: `Research task: ${config.query}

Acceptance criteria:
${config.acceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n")}

Requested rows: ${config.target}

Fetched candidate packets:
${JSON.stringify(candidates, null, 2)}

Output schema:
{"rows":[{"candidateUrl":string,"title":string,"authors":string[],"country":string,"sampleSize":string,"researchDesign":string,"outcomeVariable":string,"findingLabel":"Effective"|"Ineffective"|"Neutral","findingExplanation":string,"publicationYear":number,"publishedAt":string?,"publisher":string?,"eligiblePrimaryStudy":true}]}`,
        json: true,
        maxTokens: Math.min(llmCfg?.maxTokens ?? 6_000, 6_000),
        temperature: 0,
      }, meta);
      const parsed = parseLlmJson<{ rows?: ExtractedCountedRow[] }>("counted-row-harvest", this.ctx.stack.llm.name, response, () => ({ rows: [] }));
      return { rows: Array.isArray(parsed.rows) ? parsed.rows : [] };
    } catch (error) {
      return { rows: [], extractionError: error instanceof Error ? error.message : String(error) };
    }
  }

  private async saveKnowledgeNode(req: ToolCallRequest): Promise<unknown> {
    const args = object(req.args);
    const meta = this.meta(req);
    const taskId = requiredString(meta.taskId, "taskId");
    const reportNodeId = requiredString(meta.reportNodeId, "reportNodeId");
    const url = requiredString(args.url, "url");
    const duplicate = await this.existingCountedRowSource(url, stringOrUndefined(args.title));
    if (duplicate) {
      await traceWrite(this.ctx, "kg", "skipEvidenceLink", {
        reason: "counted_row_source_already_used",
        knowledgeNodeId: duplicate.nodeId,
        title: duplicate.title,
        url,
        countedRowReportNodeIds: this.opts.countedRowReportNodeIds,
      }, meta);
      return {
        skipped: true,
        reason: "counted_row_source_already_used",
        knowledgeNodeId: duplicate.nodeId,
        title: duplicate.title,
        url: duplicate.url,
      };
    }
    this.saveIndex += 1;
    const relation = stringOr(args.relation, "supports") as EvidenceLink["relation"];
    const confidence = clamp01(numberOr(args.confidence, 0.6));
    if (relation === "background" && this.backgroundSaveCount >= MAX_BACKGROUND_SAVES_PER_AGENT) {
      await traceWrite(this.ctx, "kg", "skipEvidenceLink", {
        reason: "background_save_limit",
        maxBackgroundSaves: MAX_BACKGROUND_SAVES_PER_AGENT,
        title: stringOr(args.title, stringOr(args.url, "Untitled source")),
        url: stringOrUndefined(args.url),
      }, meta);
      return { skipped: true, reason: "background_save_limit", maxBackgroundSaves: MAX_BACKGROUND_SAVES_PER_AGENT };
    }
    return await saveSourceEvidence(this.ctx, {
      taskId,
      reportNodeId,
      branchId: meta.branchId,
      agentRunId: meta.agentRunId,
      index: numberOr(args.index, this.saveIndex),
      title: stringOr(args.title, stringOr(args.url, "Untitled source")),
      url,
      snippet: stringOrUndefined(args.snippet),
      description: stringOrUndefined(args.description),
      content: stringOrUndefined(args.content),
      publishedAt: stringOrUndefined(args.publishedAt),
      publisher: stringOrUndefined(args.publisher),
      authors: stringArrayOr(args.authors, []),
      sourceTier: stringOr(args.sourceTier, "secondary") as KnowledgeNode["sourceTier"],
      qualityScore: clamp01(numberOr(args.qualityScore, 0.6)),
      relation,
      claimText: stringOr(args.claimText, "Evidence saved by tool."),
      confidence,
    }).then((saved) => {
      if (saved && relation === "background") this.backgroundSaveCount += 1;
      return saved;
    });
  }

  private async linkEvidence(req: ToolCallRequest): Promise<unknown> {
    const args = object(req.args);
    const meta = this.meta(req);
    const taskId = requiredString(meta.taskId, "taskId");
    const reportNodeId = stringOr(args.reportNodeId, requiredString(meta.reportNodeId, "reportNodeId"));
    const requestedKnowledgeNodeId = stringOrUndefined(args.knowledgeNodeId)
      ?? stringOrUndefined(args.evidenceLinkId)
      ?? requiredString(args.knowledgeNodeId, "knowledgeNodeId");
    const knowledgeNodeId = await this.resolveKnowledgeNodeId(requestedKnowledgeNodeId);
    const duplicate = await this.existingCountedRowKnowledgeNode(knowledgeNodeId);
    if (duplicate) {
      await traceWrite(this.ctx, "kg", "skipEvidenceLink", {
        reason: "counted_row_source_already_used",
        knowledgeNodeId,
        title: duplicate.title,
        countedRowReportNodeIds: this.opts.countedRowReportNodeIds,
      }, meta);
      return {
        skipped: true,
        reason: "counted_row_source_already_used",
        knowledgeNodeId,
        title: duplicate.title,
        url: duplicate.url,
      };
    }
    const now = isoNow(this.ctx.now);
    const relation = stringOr(args.relation, "supports") as EvidenceLink["relation"];
    const claimText = requiredString(args.claimText, "claimText");
    const metricMismatch = await evidenceClaimMetricMismatch(this.ctx, reportNodeId, relation, claimText);
    if (metricMismatch) {
      await traceWrite(this.ctx, "kg", "skipEvidenceLink", {
        reason: "claim_metric_mismatch",
        detail: metricMismatch,
        knowledgeNodeId,
        claimText,
        relation,
      }, meta);
      return { skipped: true, reason: "claim_metric_mismatch", detail: metricMismatch, knowledgeNodeId };
    }
    const link: EvidenceLink = {
      linkId: stringOr(args.linkId, generatedEvidenceLinkId(taskId, reportNodeId, knowledgeNodeId)),
      reportNodeId,
      knowledgeNodeId,
      relation,
      claimText,
      confidence: clamp01(numberOr(args.confidence, 0.6)),
      createdByTaskId: taskId,
      createdAt: now,
    };
    await this.ctx.stack.kg.upsertEvidenceLink(link);
    await traceWrite(this.ctx, "kg", "upsertEvidenceLink", { link }, meta);
    return {
      evidenceLinkId: link.linkId,
      knowledgeNodeId,
      resolvedFromEvidenceLinkId: knowledgeNodeId !== requestedKnowledgeNodeId ? requestedKnowledgeNodeId : undefined,
      link,
    };
  }

  private async resolveKnowledgeNodeId(value: string): Promise<string> {
    if (await this.ctx.stack.kg.getKnowledgeNode(value)) return value;
    const links = await this.ctx.stack.kg.listEvidenceLinks();
    const linked = links.find((link) => link.linkId === value);
    if (linked && await this.ctx.stack.kg.getKnowledgeNode(linked.knowledgeNodeId)) return linked.knowledgeNodeId;
    throw new Error(`invalid knowledgeNodeId: ${value}. Pass the K_ id returned by save_knowledge_node, or an existing E_ EvidenceLink id.`);
  }

  private async existingCountedRowSource(url: string, title?: string): Promise<KnowledgeNode | undefined> {
    const reportNodeIds = this.opts.countedRowReportNodeIds;
    if (!reportNodeIds?.length) return undefined;
    const canonicalUrl = canonicalizeSourceUrl(url) || url;
    const knowledgeNodes = await this.ctx.stack.kg.listKnowledgeNodes();
    const linkedIds = await this.countedRowLinkedKnowledgeNodeIds(reportNodeIds);
    const titleKey = title ? normalizedStudyTitle(title) : "";
    return knowledgeNodes.find((node) => linkedIds.has(node.nodeId) && (
      (Boolean(node.url) && (canonicalizeSourceUrl(node.url!) || node.url) === canonicalUrl)
      || (Boolean(titleKey) && normalizedStudyTitle(node.title) === titleKey)
    ));
  }

  private async existingCountedRowKnowledgeNode(knowledgeNodeId: string): Promise<KnowledgeNode | undefined> {
    const reportNodeIds = this.opts.countedRowReportNodeIds;
    if (!reportNodeIds?.length) return undefined;
    const linkedIds = await this.countedRowLinkedKnowledgeNodeIds(reportNodeIds);
    return linkedIds.has(knowledgeNodeId)
      ? await this.ctx.stack.kg.getKnowledgeNode(knowledgeNodeId) ?? undefined
      : undefined;
  }

  private async countedRowLinkedKnowledgeNodeIds(reportNodeIds: string[]): Promise<Set<string>> {
    const reportNodeIdSet = new Set(reportNodeIds);
    return new Set((await this.ctx.stack.kg.listEvidenceLinks())
      .filter((link) => reportNodeIdSet.has(link.reportNodeId))
      .map((link) => link.knowledgeNodeId));
  }

  private async openGap(req: ToolCallRequest): Promise<unknown> {
    const args = object(req.args);
    const meta = this.meta(req);
    const gap: OpenGap = {
      gapType: stringOr(args.gapType, "missing_source"),
      description: requiredString(args.description, "description"),
      suggestedQuery: stringOr(args.suggestedQuery, stringOr(args.query, requiredString(args.description, "description"))),
      reportNodeId: stringOrUndefined(args.reportNodeId) ?? meta.reportNodeId,
      taskId: stringOrUndefined(args.taskId) ?? meta.taskId,
      impact: impactOr(args.impact),
      status: "open",
    };
    await this.ctx.stack.kg.addOpenGap?.(gap);
    await traceWrite(this.ctx, "kg", "addOpenGap", { gap }, meta);
    return { gap };
  }

  private async suggestPatch(req: ToolCallRequest): Promise<unknown> {
    const args = object(req.args);
    const patch = normalizePatchArgs(args);
    const suggestion: StructurePatchSuggestion = {
      patch: patch as StructurePatchSuggestion["patch"],
      rationale: stringOr(args.rationale, "Suggested by agent tool call."),
      confidence: clamp01(numberOr(args.confidence, 0.5)),
    };
    if (!("op" in suggestion.patch)) {
      const meta = this.meta(req);
      const gap: OpenGap = {
        gapType: "invalid_structure_patch",
        description: "Agent attempted to suggest a structure patch without patch.op; the suggestion was ignored without failing the evidence run.",
        suggestedQuery: stringOr(args.rationale, stringOr(args.reason, "Review the report structure manually.")),
        reportNodeId: meta.reportNodeId,
        taskId: meta.taskId,
        impact: "low",
        status: "open",
      };
      await this.ctx.stack.kg.addOpenGap?.(gap);
      await traceWrite(this.ctx, "kg", "addOpenGap", { gap }, meta);
      return { ignored: true, reason: "suggest_patch missing patch.op", gap };
    }
    await traceWrite(this.ctx, "structure", "suggestPatch", { suggestion }, this.meta(req));
    return { suggestion };
  }

  private async createTask(req: ToolCallRequest): Promise<unknown> {
    const args = object(req.args);
    const request: NewTaskRequest = {
      parentTaskId: stringOrUndefined(args.parentTaskId) ?? this.meta(req).taskId ?? "T_root",
      reportNodeId: stringOr(args.reportNodeId, requiredString(this.meta(req).reportNodeId, "reportNodeId")),
      title: requiredString(args.title, "title"),
      objective: requiredString(args.objective, "objective"),
      priority: numberOr(args.priority, 80),
      acceptanceCriteria: stringArrayOr(args.acceptanceCriteria, ["Complete the requested evidence task."]),
    };
    const task = taskFromRequest(this.ctx, request);
    await this.ctx.stack.ledger.upsert(task);
    await traceWrite(this.ctx, "ledger", "upsert", { task, source: "tool.create_task" }, {
      taskId: task.taskId,
      reportNodeId: task.reportNodeId,
      branchId: task.branchId,
      agentRunId: this.meta(req).agentRunId,
    });
    return { task };
  }

  private async inspectKnowledgeNode(req: ToolCallRequest): Promise<unknown> {
    const args = object(req.args);
    const knowledgeNodeId = requiredString(args.knowledgeNodeId, "knowledgeNodeId");
    const knowledge = await this.ctx.stack.kg.getKnowledgeNode(knowledgeNodeId);
    if (!knowledge) return null;
    const query = stringOrUndefined(args.query) ?? await this.defaultInspectionQuery();
    const maxChars = Math.max(1_000, Math.min(24_000, Math.floor(numberOr(args.maxChars, 12_000))));
    return inspectKnowledgeOutput(this.ctx, knowledge, query, maxChars);
  }

  private async inspectKnowledgeNodes(req: ToolCallRequest): Promise<unknown> {
    const args = object(req.args);
    const knowledgeNodeIds = uniqueStrings(stringArrayOr(args.knowledgeNodeIds, [])).slice(0, 4);
    if (knowledgeNodeIds.length === 0) throw new Error("knowledgeNodeIds must contain at least one id");
    const query = stringOrUndefined(args.query) ?? await this.defaultInspectionQuery();
    const maxCharsPerSource = Math.max(1_000, Math.min(6_000, Math.floor(numberOr(args.maxCharsPerSource, 4_000))));
    const sources = await Promise.all(
      knowledgeNodeIds.map(async (knowledgeNodeId) => {
        const knowledge = await this.ctx.stack.kg.getKnowledgeNode(knowledgeNodeId);
        return knowledge
          ? inspectKnowledgeOutput(this.ctx, knowledge, query, maxCharsPerSource)
          : { knowledgeNodeId, notFound: true };
      }),
    );
    return { query, sources };
  }

  private async refreshKnowledgeNode(req: ToolCallRequest): Promise<unknown> {
    const args = object(req.args);
    const knowledgeNodeId = requiredString(args.knowledgeNodeId, "knowledgeNodeId");
    const knowledge = await this.ctx.stack.kg.getKnowledgeNode(knowledgeNodeId);
    if (!knowledge?.url) throw new Error(`KnowledgeNode ${knowledgeNodeId} has no refreshable URL`);
    const query = stringOrUndefined(args.query) ?? await this.defaultInspectionQuery();
    const fetchCfg = this.ctx.state.runtimeProfile.tools.fetch_page;
    const meta = this.meta(req);
    const storedAliases = Array.isArray(knowledge.metadata.aliases)
      ? knowledge.metadata.aliases.filter((item): item is string => typeof item === "string" && /^https?:\/\//iu.test(item))
      : [];
    const refreshUrl = storedAliases[0] ?? knowledge.url;
    const page = await tracedFetchPage(this.ctx, `${this.phase()}.refresh-knowledge`, refreshUrl, {
      timeoutMs: numberOrUndefined(args.timeoutMs) ?? fetchCfg?.timeoutMs,
      maxChars: numberOrUndefined(args.maxChars) ?? fetchCfg?.maxChars,
      focusTerms: [query],
      forceRefresh: true,
    }, meta);
    if (!page) return { knowledgeNodeId, refreshed: false, reason: "source could not be fetched" };
    const reportNodeId = requiredString(meta.reportNodeId, "reportNodeId");
    const taskId = meta.taskId ?? knowledge.retrievedByTaskId;
    const saved = await saveKnowledgeSource(this.ctx, {
      taskId,
      reportNodeId,
      branchId: meta.branchId,
      agentRunId: meta.agentRunId,
      index: 0,
      title: page.title || knowledge.title,
      url: page.url || refreshUrl,
      snippet: knowledge.summary,
      description: page.description,
      content: page.content,
      publishedAt: typeof knowledge.metadata.publishedAt === "string" ? knowledge.metadata.publishedAt : undefined,
      publisher: typeof knowledge.metadata.publisher === "string" ? knowledge.metadata.publisher : undefined,
      authors: Array.isArray(knowledge.metadata.authors)
        ? knowledge.metadata.authors.filter((author): author is string => typeof author === "string")
        : undefined,
      sourceTier: knowledge.sourceTier,
      qualityScore: knowledge.qualityScore,
    });
    const updated = saved ? await this.ctx.stack.kg.getKnowledgeNode(saved.knowledgeNodeId) : knowledge;
    return {
      ...inspectKnowledgeOutput(this.ctx, updated ?? knowledge, query, Math.max(1_000, Math.min(24_000, Math.floor(numberOr(args.excerptMaxChars, 12_000))))),
      refresh: {
        refreshed: Boolean(saved),
        reusedKnowledgeNode: saved?.reused ?? false,
        requestedKnowledgeNodeId: knowledgeNodeId,
        resultingKnowledgeNodeId: saved?.knowledgeNodeId ?? knowledgeNodeId,
        fetchedContentChars: page.content.length,
      },
    };
  }

  private async defaultInspectionQuery(): Promise<string> {
    const task = this.opts.taskId ? await this.ctx.stack.ledger.getById(this.opts.taskId) : null;
    if (task) return [task.title, task.objective, ...task.acceptanceCriteria].join(" ");
    const reportNode = this.opts.reportNodeId ? await this.ctx.stack.kg.getReportNode(this.opts.reportNodeId) : null;
    return [reportNode?.label, reportNode?.scopeNote, reportNode?.hypothesis?.statement].filter(Boolean).join(" ");
  }

  private async listReportTree(): Promise<unknown> {
    const nodes = await this.ctx.stack.kg.listReportNodes();
    return nodes.map((node) => ({
      nodeId: node.nodeId,
      parentNodeId: node.parentNodeId,
      nodeKind: node.nodeKind,
      label: node.label,
      status: node.status,
      coverage: node.coverage,
    }));
  }

  private async listRelevantEvidence(req: ToolCallRequest): Promise<unknown> {
    const reportNodeId = stringOrUndefined(object(req.args).reportNodeId) ?? this.meta(req).reportNodeId;
    const links = await this.ctx.stack.kg.listEvidenceLinks(reportNodeId);
    const knowledgeByNodeId = new Map(
      await Promise.all(
        [...new Set(links.map((link) => link.knowledgeNodeId))].map(async (knowledgeNodeId) =>
          [knowledgeNodeId, await this.ctx.stack.kg.getKnowledgeNode(knowledgeNodeId)] as const,
        ),
      ),
    );
    return links.map((link) => ({ link, knowledge: knowledgeByNodeId.get(link.knowledgeNodeId) }));
  }

  private meta(req: ToolCallRequest): { taskId?: string; reportNodeId?: string; branchId?: string; agentRunId?: string } {
    return {
      taskId: req.taskId ?? this.opts.taskId,
      reportNodeId: req.reportNodeId ?? this.opts.reportNodeId,
      branchId: this.opts.branchId,
      agentRunId: req.agentRunId ?? this.opts.agentRunId,
    };
  }

  private phase(): string {
    return this.opts.phase ?? "agent-runtime";
  }

  private result(toolName: string, startedAt: number, ok: boolean, output?: unknown, error?: string): ToolCallResult {
    return { toolName, ok, output, error, durationMs: Date.now() - startedAt };
  }
}

function generatedEvidenceLinkId(taskId: string, reportNodeId: string, knowledgeNodeId: string): string {
  const identity = `${taskId}\n${reportNodeId}\n${knowledgeNodeId}`;
  const readable = shortId(`${taskId}_${reportNodeId}`);
  const hash = createHash("sha1").update(identity).digest("hex").slice(0, 10);
  return `E_${readable}_${hash}`;
}

function sanitizeUnverifiedToolFocusNumbers(value: string, userInput: string): string {
  return value.replace(/\b\d+(?:\.\d+)?\s*%?/gu, (token, offset: number) => {
    const compact = token.replace(/\s+/gu, "");
    if (userInput.includes(compact) || userInput.includes(token.trim())) return token;
    const prefix = value.slice(Math.max(0, offset - 24), offset);
    if (/(?:article|section|clause|paragraph|annex|第)\s*$/iu.test(prefix) || /(?:条|款|项)\s*$/u.test(prefix)) return token;
    return " ";
  }).replace(/\s+/gu, " ").trim();
}

function inspectKnowledgeOutput(
  ctx: PhaseContext,
  knowledge: KnowledgeNode,
  query: string,
  maxChars: number,
): Record<string, unknown> {
  const cached = cachedPageForKnowledge(ctx, knowledge);
  const storedPreview = typeof knowledge.metadata.contentPreview === "string" ? knowledge.metadata.contentPreview : "";
  const content = cached?.content || storedPreview;
  const selected = selectRelevantSourceExcerpt(content, query, maxChars);
  return {
    ...knowledge,
    metadata: {
      ...knowledge.metadata,
      contentPreview: selected.excerpt,
    },
      inspection: {
        query,
        fetchCacheAvailable: Boolean(cached?.content),
        fullContentAvailable: Boolean(cached?.content && cached.content.length >= Math.max(1_000, storedPreview.length)),
      contentChars: content.length,
      excerptChars: selected.excerpt.length,
      excerptOffsets: selected.offsets,
    },
  };
}

function cachedPageForKnowledge(
  ctx: PhaseContext,
  knowledge: KnowledgeNode,
): { url: string; title: string; content: string; description?: string } | undefined {
  const identities = new Set([
    canonicalizeSourceUrl(knowledge.url),
    typeof knowledge.metadata.canonicalUrl === "string" ? canonicalizeSourceUrl(knowledge.metadata.canonicalUrl) : "",
    ...(Array.isArray(knowledge.metadata.aliases)
      ? knowledge.metadata.aliases.flatMap((alias) => typeof alias === "string" ? [canonicalizeSourceUrl(alias)] : [])
      : []),
  ].filter(Boolean));
  return Array.from(ctx.state.fetchCache.entries())
    .flatMap(([key, page]) => {
      if (!page) return [];
      const keyUrl = key.split("::", 1)[0] ?? "";
      const matches = [canonicalizeSourceUrl(page.url), canonicalizeSourceUrl(keyUrl)].some((identity) => identities.has(identity));
      return matches ? [page] : [];
    })
    .sort((a, b) => b.content.length - a.content.length)[0];
}

interface SourceExcerpt {
  excerpt: string;
  offsets: Array<{ start: number; end: number; score: number }>;
}

function selectRelevantSourceExcerpt(content: string, query: string, maxChars: number): SourceExcerpt {
  if (content.length <= maxChars) {
    return { excerpt: content, offsets: content ? [{ start: 0, end: content.length, score: 0 }] : [] };
  }
  const terms = inspectionTerms(query);
  const segments = sourceContentSegments(content).map((segment) => ({
    ...segment,
    score: inspectionSegmentScore(segment.text, terms),
  }));
  const ranked = segments
    .filter((segment) => segment.score > 0)
    .sort((a, b) => b.score - a.score || a.start - b.start);
  const selected = (ranked.length > 0 ? ranked : segments.slice(0, 1)).slice(0, 4);
  const chunks: string[] = [];
  const offsets: SourceExcerpt["offsets"] = [];
  let remaining = maxChars;
  for (const segment of selected) {
    if (remaining <= 0) break;
    const separator = chunks.length > 0 ? "\n\n" : "";
    const budget = Math.max(0, remaining - separator.length);
    if (budget === 0) break;
    const clipped = clipSegmentAroundTerms(segment, terms, budget);
    chunks.push(`${separator}${clipped.text}`);
    offsets.push({ start: clipped.start, end: clipped.end, score: segment.score });
    remaining -= separator.length + clipped.text.length;
  }
  return { excerpt: chunks.join(""), offsets };
}

interface ContentSegment {
  start: number;
  text: string;
}

function sourceContentSegments(content: string): ContentSegment[] {
  const focusedMarkers = Array.from(content.matchAll(/^--- Focused source passage \d+[^\n]*---$/gmu));
  if (focusedMarkers.length > 1) {
    return focusedMarkers.map((marker, index) => {
      const start = marker.index ?? 0;
      const end = focusedMarkers[index + 1]?.index ?? content.length;
      return { start, text: content.slice(start, end).trim() };
    });
  }
  const pageMarkers = Array.from(content.matchAll(/^--- PDF page \d+ ---$/gmu));
  if (pageMarkers.length > 1) {
    return pageMarkers.map((marker, index) => {
      const start = marker.index ?? 0;
      const end = pageMarkers[index + 1]?.index ?? content.length;
      return { start, text: content.slice(start, end).trim() };
    });
  }
  const windowSize = 4_000;
  const stride = 3_500;
  const segments: ContentSegment[] = [];
  for (let start = 0; start < content.length; start += stride) {
    segments.push({ start, text: content.slice(start, Math.min(content.length, start + windowSize)) });
  }
  return segments;
}

function inspectionTerms(query: string): string[] {
  const normalized = query.normalize("NFKC").toLowerCase();
  const terms = new Set(normalized.match(/(?:19|20)\d{2}|[a-z][a-z0-9_-]{3,}/gu) ?? []);
  const lowSignal = new Set(["城市", "轨道", "交通", "研究", "报告", "数据", "来源", "要求", "分析", "提供"]);
  for (const sequence of normalized.match(/\p{Script=Han}{2,}/gu) ?? []) {
    for (const width of [4, 2]) {
      for (let index = 0; index <= sequence.length - width; index++) {
        const term = sequence.slice(index, index + width);
        if (!lowSignal.has(term)) terms.add(term);
      }
    }
  }
  return Array.from(terms).sort((a, b) => b.length - a.length).slice(0, 80);
}

function inspectionSegmentScore(text: string, terms: string[]): number {
  const normalized = text.normalize("NFKC").toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (!normalized.includes(term)) continue;
    score += /^\d{4}$/u.test(term) ? 4 : term.length >= 4 ? 3 : 1;
  }
  const thresholdCount = (normalized.match(/\b\d+(?:\.\d+)?\s*(?:%|per\s+cent\b|percent\b)/gu) ?? []).length;
  const yearCount = (normalized.match(/\b(?:19|20)\d{2}\b/gu) ?? []).length;
  score += Math.min(thresholdCount, 10) * 4 + Math.min(yearCount, 8);
  return score;
}

function clipSegmentAroundTerms(
  segment: ContentSegment,
  terms: string[],
  maxChars: number,
): { text: string; start: number; end: number } {
  if (segment.text.length <= maxChars) {
    return { text: segment.text, start: segment.start, end: segment.start + segment.text.length };
  }
  const normalized = segment.text.normalize("NFKC").toLowerCase();
  const anchors = terms.flatMap((term) => {
    const index = normalized.indexOf(term);
    return index >= 0 ? [{ index, weight: /^\d{4}$/u.test(term) ? 4 : term.length }] : [];
  }).sort((a, b) => b.weight - a.weight || a.index - b.index);
  const anchor = anchors[0]?.index ?? 0;
  const localStart = Math.max(0, Math.min(segment.text.length - maxChars, anchor - Math.floor(maxChars / 3)));
  const text = segment.text.slice(localStart, localStart + maxChars);
  return {
    text,
    start: segment.start + localStart,
    end: segment.start + localStart + text.length,
  };
}

function taskFromRequest(ctx: PhaseContext, req: NewTaskRequest): TaskItem {
  const now = isoNow(ctx.now);
  const suffix = shortId(`${req.reportNodeId}_${req.title}_${req.objective}_${now}`);
  return {
    taskId: `T_tool_${suffix}`,
    parentTaskId: req.parentTaskId ?? "T_root",
    reportNodeId: req.reportNodeId,
    title: req.title,
    objective: req.objective,
    requirementIds: req.requirementIds,
    status: "queued",
    priority: req.priority,
    branchId: `B_tool_${suffix}`,
    acceptanceCriteria: req.acceptanceCriteria,
    createdAt: now,
    updatedAt: now,
  };
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function distributionNumberArray(value: unknown, name: string): number[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array of finite numbers`);
  return value.map((entry, index) => finiteDistributionNumber(entry, `${name}[${index}]`));
}

function finiteDistributionNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
}

function distributionLabels(value: unknown, expectedLength: number): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length !== expectedLength) {
    throw new Error("labels must be an array with the same number of entries as weights and values");
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string" || !entry.trim()) throw new Error(`labels[${index}] must be a non-empty string`);
    return entry.trim();
  });
}

function finiteDistributionSum(values: number[], name: string): number {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total)) throw new Error(`${name} is outside the supported numeric range`);
  return total;
}

function atkinsonIndex(
  entries: Array<{ weightShare: number; valueShare: number; logRelativeConcentration: number }>,
  epsilon: number,
): number {
  if (epsilon === 1) {
    if (entries.some((entry) => entry.valueShare === 0)) return 1;
    const weightedLogMean = entries.reduce(
      (sum, entry) => sum + entry.weightShare * entry.logRelativeConcentration,
      0,
    );
    return 1 - Math.exp(weightedLogMean);
  }
  if (epsilon > 1 && entries.some((entry) => entry.valueShare === 0)) return 1;

  const exponent = 1 - epsilon;
  const logTerms = entries.flatMap((entry) => entry.valueShare === 0
    ? []
    : [Math.log(entry.weightShare) + exponent * entry.logRelativeConcentration]);
  const maxLogTerm = Math.max(...logTerms);
  const logWeightedPowerMean = maxLogTerm + Math.log(
    logTerms.reduce((sum, term) => sum + Math.exp(term - maxLogTerm), 0),
  );
  return 1 - Math.exp(logWeightedPowerMean / exponent);
}

function clampDistributionUnit(value: number): number {
  if (!Number.isFinite(value)) throw new Error("distribution index is outside the supported numeric range");
  return Math.min(1, Math.max(0, value));
}

function roundDistributionMetric(value: number): number {
  if (Math.abs(value) < 5e-13) return 0;
  return Number(value.toPrecision(13));
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function countedRowRegionQualifier(query: string): string {
  const normalized = query.normalize("NFKC");
  if (/\b(?:europe|european|africa|african)\b/iu.test(normalized)) {
    return "Europe Africa Germany France Italy Spain United Kingdom Nigeria South Africa Kenya peer-reviewed journal";
  }
  if (/\b(?:americas|american|north america|south america|latin america|cross[- ]regional)\b/iu.test(normalized)) {
    return "United States Canada Brazil Mexico Colombia Chile peer-reviewed journal";
  }
  if (/\b(?:asia|asian|pacific|middle east|arab|gulf)\b/iu.test(normalized)) {
    return "China India Australia Malaysia Jordan Saudi Arabia United Arab Emirates peer-reviewed journal";
  }
  return "";
}

function countedRowHitScore(hit: { title: string; snippet: string; url: string }): number {
  const text = `${hit.title} ${hit.snippet}`;
  let score = 0;
  if (/\b(?:empirical|study|survey|trial|experiment|comparative|longitudinal)\b/iu.test(text)) score += 3;
  if (/\b(?:sample|participants?|students?|respondents?|n\s*=)\b/iu.test(text)) score += 3;
  if (/\b(?:results?|findings?|outcomes?|effectiveness|achievement|performance)\b/iu.test(text)) score += 2;
  if (/\b(?:pdf|doi)\b/iu.test(text) || /\.pdf(?:$|[?#])/iu.test(hit.url)) score += 1;
  if (/\b(?:review|systematic review|meta-analysis|editorial)\b/iu.test(text)) score -= 4;
  if (/researchgate\.net|academia\.edu|oalib\.com|scirp\.org/iu.test(hit.url)) score -= 3;
  if (/doi\.org|\.pdf(?:$|[?#])/iu.test(hit.url)) score += 3;
  if (/(?:frontiersin|springer|tandfonline|sciencedirect|sagepub|wiley|biomedcentral|journals\.)/iu.test(hit.url)) score += 2;
  return score;
}

function selectCountedRowHits(
  hits: Array<{ title: string; snippet: string; url: string }>,
  excluded: Set<string>,
  excludedTitles: Set<string>,
  limit: number,
): Array<{ title: string; snippet: string; url: string }> {
  const byIdentity = new Map<string, { title: string; snippet: string; url: string }>();
  for (const hit of hits) {
    if (!assessSourceUrlPolicy(hit.url).usable) continue;
    const identity = countedRowUrlIdentity(hit.url);
    if (excluded.has(identity) || byIdentity.has(identity)) continue;
    const title = normalizedStudyTitle(hit.title);
    if (countedRowTitleMatchesAny(title, excludedTitles)) continue;
    byIdentity.set(identity, hit);
  }
  const ranked = [...byIdentity.values()].sort((left, right) => countedRowHitScore(right) - countedRowHitScore(left));
  const seenTitles = new Set<string>();
  const distinctRanked = ranked.filter((hit) => {
    const title = normalizedStudyTitle(hit.title);
    if (countedRowTitleMatchesAny(title, seenTitles)) return false;
    if (title.length >= 32) seenTitles.add(title);
    return true;
  });
  const queues = new Map<string, typeof distinctRanked>();
  for (const hit of distinctRanked) {
    const domain = sourcePublisherDomain(hit.url) ?? `unknown:${hit.url}`;
    const queue = queues.get(domain);
    if (queue) queue.push(hit);
    else queues.set(domain, [hit]);
  }
  const out: typeof distinctRanked = [];
  while (out.length < Math.max(0, limit)) {
    let progressed = false;
    for (const queue of queues.values()) {
      const hit = queue.shift();
      if (!hit) continue;
      out.push(hit);
      progressed = true;
      if (out.length >= limit) break;
    }
    if (!progressed) break;
  }
  return out;
}

function countedRowTitleMatchesAny(candidate: string, titles: Set<string>): boolean {
  if (!candidate) return false;
  for (const title of titles) {
    if (candidate === title) return true;
    const shorter = candidate.length < title.length ? candidate : title;
    const longer = candidate.length < title.length ? title : candidate;
    if (shorter.length >= 32 && longer.includes(shorter)) return true;
  }
  return false;
}

function countedRowCandidateMap(candidates: CountedRowCandidate[]): Map<string, CountedRowCandidate> {
  const map = new Map<string, CountedRowCandidate>();
  for (const candidate of candidates) {
    for (const key of countedRowCandidateKeys(candidate.url)) map.set(key, candidate);
  }
  return map;
}

function countPotentialCountedRows(
  rows: ExtractedCountedRow[],
  candidateByUrl: Map<string, CountedRowCandidate>,
  temporalScope: { min: number; max: number } | undefined,
  excludedTitles: string[],
): number {
  const titles = new Set(excludedTitles.map(normalizedStudyTitle).filter(Boolean));
  let count = 0;
  for (const extracted of rows) {
    const normalized = normalizeExtractedCountedRow(extracted, candidateByUrl, temporalScope);
    if (!normalized.ok) continue;
    const title = normalizedStudyTitle(normalized.row.title);
    if (!title || titles.has(title)) continue;
    titles.add(title);
    count += 1;
  }
  return count;
}

function compactRowCandidateContent(content: string): string {
  const normalized = content.replace(/\0/g, "").trim();
  const maxChars = 9_000;
  if (normalized.length <= maxChars) return normalized;
  const ranges: Array<{ start: number; end: number }> = [{ start: 0, end: 1_800 }];
  addRowContentRanges(ranges, normalized, /\b(?:participants?|sample(?:\s+size)?|respondents?|n\s*=)\b/giu, 2, 800, 2_400);
  addRowContentRanges(ranges, normalized, /\b(?:methods?|methodology|research\s+design)\b/giu, 1, 600, 1_800);
  addRowContentRanges(ranges, normalized, /\b(?:results?|findings?|outcomes?|conclusions?)\b/giu, 1, 600, 2_200);
  if (ranges.length === 1) return normalized.slice(0, maxChars);
  const merged = mergeContentRanges(ranges, normalized.length);
  const excerpts: string[] = [];
  let remaining = maxChars;
  for (const range of merged) {
    if (remaining <= 0) break;
    const excerpt = normalized.slice(range.start, Math.min(range.end, range.start + remaining));
    if (!excerpt) continue;
    excerpts.push(excerpt);
    remaining -= excerpt.length;
  }
  return excerpts.join("\n\n[...focused excerpt...]\n\n");
}

function addRowContentRanges(
  ranges: Array<{ start: number; end: number }>,
  content: string,
  pattern: RegExp,
  limit: number,
  before: number,
  after: number,
): void {
  let added = 0;
  for (const match of content.matchAll(pattern)) {
    const index = match.index;
    if (index < 1_200) continue;
    ranges.push({ start: Math.max(0, index - before), end: Math.min(content.length, index + after) });
    added += 1;
    if (added >= limit) break;
  }
}

function mergeContentRanges(ranges: Array<{ start: number; end: number }>, contentLength: number): Array<{ start: number; end: number }> {
  const sorted = ranges
    .map((range) => ({ start: Math.max(0, range.start), end: Math.min(contentLength, range.end) }))
    .filter((range) => range.end > range.start)
    .sort((left, right) => left.start - right.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (!previous || range.start > previous.end) merged.push({ ...range });
    else previous.end = Math.max(previous.end, range.end);
  }
  return merged;
}

function countedRowYearRange(criteria: string[]): { min: number; max: number } | undefined {
  const years = Array.from(criteria.join("\n").matchAll(/\b(20\d{2})\b/gu))
    .map((match) => Number(match[1]))
    .filter((year) => year >= 2000 && year <= 2099);
  return years.length >= 2 ? { min: Math.min(...years), max: Math.max(...years) } : undefined;
}

function normalizeExtractedCountedRow(
  extracted: ExtractedCountedRow,
  candidateByUrl: Map<string, CountedRowCandidate>,
  temporalScope: { min: number; max: number } | undefined,
): { ok: true; row: NormalizedCountedRow } | { ok: false; reason: string } {
  if (extracted.eligiblePrimaryStudy !== true) return { ok: false, reason: "not_marked_eligible_primary_study" };
  const requestedUrl = stringOrUndefined(extracted.candidateUrl);
  if (!requestedUrl) return { ok: false, reason: "missing_candidate_url" };
  const candidate = countedRowCandidateKeys(requestedUrl).map((key) => candidateByUrl.get(key)).find(Boolean);
  if (!candidate) return { ok: false, reason: "candidate_url_not_in_fetched_batch" };
  if (/\b(?:systematic\s+review|scoping\s+review|meta-analysis|literature\s+review|editorial)\b/iu.test(`${candidate.title} ${candidate.snippet}`)) {
    return { ok: false, reason: "candidate_is_not_a_primary_empirical_study" };
  }
  const sourceText = countedRowCandidateSourceText(candidate);
  if (!countedRowCandidateHasPrimaryMethodsAndResults(candidate)) {
    return { ok: false, reason: "candidate_lacks_primary_methods_or_results" };
  }
  const title = stringOrUndefined(extracted.title);
  const country = stringOrUndefined(extracted.country);
  const sampleSize = stringOrUndefined(extracted.sampleSize);
  const researchDesign = stringOrUndefined(extracted.researchDesign);
  const outcomeVariable = stringOrUndefined(extracted.outcomeVariable);
  const findingExplanation = stringOrUndefined(extracted.findingExplanation);
  const authors = typeof extracted.authors === "string"
    ? extracted.authors.split(/[,;]\s*/u).map((author) => author.trim()).filter(Boolean)
    : stringArrayOr(extracted.authors, []);
  if (!title || !country || !sampleSize || !researchDesign || !outcomeVariable || !findingExplanation || authors.length === 0) {
    return { ok: false, reason: "missing_required_row_field" };
  }
  if ([title, country, sampleSize, researchDesign, outcomeVariable, findingExplanation, ...authors].some(isMissingCountedRowValue)) {
    return { ok: false, reason: "row_contains_unknown_or_unreported_value" };
  }
  const findingLabel = normalizeFindingLabel(extracted.findingLabel);
  if (!findingLabel) return { ok: false, reason: "invalid_effectiveness_label" };
  const publicationYear = Number(extracted.publicationYear);
  if (!Number.isInteger(publicationYear) || publicationYear < 1900 || publicationYear > 2100) {
    return { ok: false, reason: "missing_or_invalid_publication_year" };
  }
  if (temporalScope && (publicationYear < temporalScope.min || publicationYear > temporalScope.max)) {
    return { ok: false, reason: "publication_year_outside_task_scope" };
  }
  if (!new RegExp(`(?:^|\\D)${publicationYear}(?:\\D|$)`, "u").test(sourceText)) {
    return { ok: false, reason: "publication_year_not_grounded_in_candidate" };
  }
  if (!sampleCountGrounded(sampleSize, sourceText)) return { ok: false, reason: "sample_count_not_grounded_in_candidate" };
  if (!authorGrounded(authors, sourceText)) return { ok: false, reason: "authors_not_grounded_in_candidate" };
  if (!countryGrounded(country, sourceText)) return { ok: false, reason: "country_not_grounded_in_candidate" };
  const row: NormalizedCountedRow = {
    candidate,
    url: candidate.url,
    title,
    authors,
    country,
    sampleSize,
    researchDesign,
    outcomeVariable,
    findingLabel,
    findingExplanation,
    publicationYear,
    publishedAt: stringOrUndefined(extracted.publishedAt),
    publisher: stringOrUndefined(extracted.publisher),
  };
  if (!isCompleteStudyRowReportlet({
    markdown: countedRowMarkdown(row, "E_candidate"),
    citedKnowledgeNodeIds: ["K_candidate"],
  })) {
    return { ok: false, reason: "strict_complete_row_validation_failed" };
  }
  return { ok: true, row };
}

function countedRowMarkdown(row: NormalizedCountedRow, evidenceLinkId: string): string {
  return `**Authors:** ${row.authors.join(", ")}\n**Country:** ${row.country}\n**Sample Size:** ${row.sampleSize}\n**Research Design:** ${row.researchDesign}\n**Outcome Variable:** ${row.outcomeVariable}\n**Finding on Effectiveness:** ${row.findingLabel} - ${row.findingExplanation} [E:${evidenceLinkId}]`;
}

function normalizeFindingLabel(value: unknown): NormalizedCountedRow["findingLabel"] | undefined {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "effective") return "Effective";
  if (normalized === "ineffective") return "Ineffective";
  if (normalized === "neutral") return "Neutral";
  return undefined;
}

function isMissingCountedRowValue(value: string): boolean {
  return /\b(?:unknown|not\s+(?:available|reported|stated|provided|specified|extracted)|unavailable|missing|n\/?a|could not|likely|unspecified)\b/iu.test(value);
}

function sampleCountGrounded(sampleSize: string, sourceText: string): boolean {
  const normalizedSource = sourceText.replace(/,/g, "");
  return Array.from(sampleSize.matchAll(/\b\d[\d,]*\b/gu)).some((match) => {
    const token = match[0].replace(/,/g, "");
    const value = Number(token);
    return Number.isInteger(value)
      && value >= 10
      && !(value >= 1900 && value <= 2100)
      && new RegExp(`(?:^|\\D)${token}(?:\\D|$)`, "u").test(normalizedSource);
  });
}

function countedRowCandidateSourceText(candidate: CountedRowCandidate): string {
  return `${candidate.title}\n${candidate.snippet}\n${candidate.description ?? ""}\n${candidate.content}`.normalize("NFKC");
}

function countedRowCandidateHasPrimaryMethodsAndResults(candidate: CountedRowCandidate): boolean {
  const sourceText = countedRowCandidateSourceText(candidate);
  return /\b(?:method|participants?|sample|survey|trial|experiment|cohort|respondents?)\b/iu.test(sourceText)
    && /\b(?:result|finding|outcome|effect|performance|achievement|satisfaction)\b/iu.test(sourceText);
}

function authorGrounded(authors: string[], sourceText: string): boolean {
  const normalized = sourceText.toLowerCase();
  return authors.some((author) => {
    const tokens = author.normalize("NFKC").toLowerCase().match(/[\p{L}][\p{L}'-]{2,}/gu) ?? [];
    return tokens.some((token) => normalized.includes(token));
  });
}

function countryGrounded(country: string, sourceText: string): boolean {
  const normalizedSource = sourceText.normalize("NFKC").toLowerCase();
  const normalizedCountry = country.normalize("NFKC").toLowerCase();
  if (normalizedSource.includes(normalizedCountry)) return true;
  const aliases: Record<string, string[]> = {
    "united states": ["usa", "u.s.", "us university"],
    "united kingdom": ["uk", "u.k."],
    "united arab emirates": ["uae", "u.a.e."],
  };
  return (aliases[normalizedCountry] ?? []).some((alias) => normalizedSource.includes(alias));
}

function normalizedStudyTitle(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function countedRowCandidateKeys(value: string): string[] {
  const canonical = canonicalizeSourceUrl(value) || value;
  return uniqueStrings([canonical, countedRowUrlIdentity(canonical)]);
}

function countedRowUrlIdentity(value: string): string {
  const canonical = canonicalizeSourceUrl(value) || value;
  try {
    const parsed = new URL(canonical);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/u, "") || "/"}`.toLowerCase();
  } catch {
    return canonical.toLowerCase().replace(/[?#].*$/u, "").replace(/\/+$/u, "");
  }
}

function normalizePatchArgs(args: Record<string, unknown>): Record<string, unknown> {
  const direct = object(args.patch);
  if (Object.keys(direct).length > 0) return direct;
  const structurePatch = object(args.structurePatch);
  if (Object.keys(structurePatch).length > 0) return structurePatch;
  const patchJson = stringOrUndefined(args.patchJson) ?? stringOrUndefined(args.patch_json);
  if (patchJson) {
    try {
      return object(JSON.parse(patchJson));
    } catch {
      return {};
    }
  }
  if (typeof args.op === "string") {
    const { rationale: _rationale, confidence: _confidence, ...patch } = args;
    return patch;
  }
  return {};
}

function requiredString(value: unknown, name: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new Error(`${name} is required`);
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArrayOr(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : fallback;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function impactOr(value: unknown): OpenGap["impact"] {
  return value === "low" || value === "medium" || value === "high" ? value : "medium";
}
