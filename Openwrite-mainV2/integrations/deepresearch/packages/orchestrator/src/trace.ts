import type { KnowledgeNode, LlmChat, LlmChatRequest, LlmChatResponse, MemoryEvent } from "@deepresearch/contracts";
import { canonicalizeSourceUrl } from "./source-identity.js";
import { assessSourceQuality, assessSourceUrlPolicy } from "./source-quality.js";
import { hasAuthorityIntent, rankSearchHitsForResearch, requirementNeedsAuthority } from "./source-discovery.js";
import type { PhaseContext } from "./types.js";
import {
  beginProviderRequest,
  failProviderRequest,
  finishLlmRequest,
  finishProviderRequest,
  ProviderBudgetExceededError,
} from "./budget.js";

export function wantsFullTrace(ctx: PhaseContext): boolean {
  return ctx.state.runtimeProfile.traceLevel === "full";
}

export async function emitFullTrace(
  ctx: PhaseContext,
  event: Omit<MemoryEvent, "eventId" | "episodeId" | "timestamp"> & { episodeId?: string; timestamp?: string },
): Promise<void> {
  if (!wantsFullTrace(ctx)) return;
  await ctx.emit({
    ...event,
    eventType: `full.${event.eventType}`,
  });
}

export async function tracedLlmChat(
  ctx: PhaseContext,
  phase: string,
  request: LlmChatRequest,
  meta: { taskId?: string; reportNodeId?: string; branchId?: string; agentRunId?: string } = {},
  llm: LlmChat = ctx.stack.llm,
): Promise<LlmChatResponse> {
  throwIfAborted(ctx.signal);
  const startedAt = Date.now();
  const traceRequest = { ...request };
  delete traceRequest.signal;
  await emitFullTrace(ctx, {
    eventType: "llm.request",
    ...meta,
    payload: {
      phase,
      provider: llm.name,
      request: traceRequest,
    },
  });
  const budgetKey = await beginProviderRequest(ctx, "llm", llm.name, phase);
  try {
    const response = await llm.chat({ ...request, signal: ctx.signal ?? request.signal });
    await finishLlmRequest(ctx, budgetKey, request, response, phase);
    await emitFullTrace(ctx, {
      eventType: "llm.response",
      ...meta,
      payload: {
        phase,
        provider: llm.name,
        durationMs: Date.now() - startedAt,
        response,
      },
    });
    return response;
  } catch (err) {
    failProviderRequest(ctx, budgetKey);
    await emitFullTrace(ctx, {
      eventType: "llm.error",
      ...meta,
      payload: {
        phase,
        provider: llm.name,
        durationMs: Date.now() - startedAt,
        error: errorPayload(err),
      },
    });
    throw err;
  }
}

export async function tracedSearch(
  ctx: PhaseContext,
  phase: string,
  query: string,
  topK: number,
  meta: { taskId?: string; reportNodeId?: string; branchId?: string; agentRunId?: string } = {},
  behavior: {
    resultFilter?: (hits: Array<{ url: string; title: string; snippet: string }>) => Array<{ url: string; title: string; snippet: string }>;
    replenish?: boolean;
  } = {},
): Promise<Array<{ url: string; title: string; snippet: string }>> {
  throwIfAborted(ctx.signal);
  if (!ctx.stack.search) {
    await emitFullTrace(ctx, {
      eventType: "search.skipped",
      ...meta,
      payload: { phase, query, topK, reason: "no search provider configured" },
    });
    return [];
  }
  const startedAt = Date.now();
  const maxRequestedTopK = maxExpandedSearchTopK(topK);
  const preferAuthority = await searchPrefersAuthority(ctx, query, meta.reportNodeId);
  await emitFullTrace(ctx, {
    eventType: "search.request",
    ...meta,
    payload: { phase, provider: ctx.stack.search.name, query, topK, maxRequestedTopK },
  });
  try {
    const replenished = await searchWithDuplicateReplenishment(
      ctx,
      phase,
      query,
      topK,
      maxRequestedTopK,
      preferAuthority,
      behavior,
    );
    await emitFullTrace(ctx, {
      eventType: "search.response",
      ...meta,
      payload: {
        phase,
        provider: ctx.stack.search.name,
        query,
        topK,
        requestedTopK: replenished.requestedTopK,
        requestAttempts: replenished.requestAttempts,
        rawResultCount: replenished.rawResults.length,
        uniqueResultCount: replenished.results.length,
        duplicateCount: replenished.duplicateCount,
        exhaustedReplenishment: replenished.exhaustedReplenishment,
        preferAuthority,
        durationMs: Date.now() - startedAt,
        results: replenished.results,
      },
    });
    return replenished.results;
  } catch (err) {
    await emitFullTrace(ctx, {
      eventType: "search.error",
      ...meta,
      payload: { phase, provider: ctx.stack.search.name, query, topK, maxRequestedTopK, durationMs: Date.now() - startedAt, error: errorPayload(err) },
    });
    throw err;
  }
}

async function searchWithDuplicateReplenishment(
  ctx: PhaseContext,
  phase: string,
  query: string,
  topK: number,
  maxRequestedTopK: number,
  preferAuthority: boolean,
  behavior: {
    resultFilter?: (hits: Array<{ url: string; title: string; snippet: string }>) => Array<{ url: string; title: string; snippet: string }>;
    replenish?: boolean;
  },
): Promise<{
  rawResults: Array<{ url: string; title: string; snippet: string }>;
  results: Array<{ url: string; title: string; snippet: string }>;
  duplicateCount: number;
  requestedTopK: number;
  requestAttempts: number;
  exhaustedReplenishment: boolean;
}> {
  let requestedTopK = Math.min(Math.max(topK * 2, 1), maxRequestedTopK);
  let requestAttempts = 0;
  let rawResults: Array<{ url: string; title: string; snippet: string }> = [];
  let prepared = prepareSearchHits(rawResults, topK, preferAuthority, behavior.resultFilter);
  while (requestAttempts < 3) {
    requestAttempts += 1;
    const budgetKey = await beginProviderRequest(ctx, "search", ctx.stack.search!.name, phase);
    try {
      rawResults = await ctx.stack.search!.search(query, requestedTopK, { signal: ctx.signal });
      await finishProviderRequest(ctx, budgetKey, phase);
    } catch (err) {
      failProviderRequest(ctx, budgetKey);
      throw err;
    }
    prepared = prepareSearchHits(rawResults, topK, preferAuthority, behavior.resultFilter);
    if (prepared.results.length >= topK) break;
    if (behavior.replenish === false) break;
    if (rawResults.length < requestedTopK) break;
    const shortage = topK - prepared.results.length;
    const nextTopK = Math.min(maxRequestedTopK, requestedTopK + Math.max(shortage, prepared.duplicateCount, 1));
    if (nextTopK <= requestedTopK) break;
    requestedTopK = nextTopK;
  }
  return {
    rawResults,
    results: prepared.results,
    duplicateCount: prepared.duplicateCount,
    requestedTopK,
    requestAttempts,
    exhaustedReplenishment: prepared.results.length < topK && rawResults.length >= requestedTopK && requestedTopK >= maxRequestedTopK,
  };
}

async function searchPrefersAuthority(ctx: PhaseContext, query: string, reportNodeId: string | undefined): Promise<boolean> {
  if (hasAuthorityIntent(query)) return true;
  const requirements = ctx.state.globalRubric?.requirements ?? [];
  if (!reportNodeId || reportNodeId === "R_root") return requirements.some(requirementNeedsAuthority);
  const node = await ctx.stack.kg.getReportNode(reportNodeId);
  const requirementIds = new Set(node?.requirementIds ?? []);
  return requirements.some((requirement) => requirementIds.has(requirement.requirementId) && requirementNeedsAuthority(requirement));
}

function maxExpandedSearchTopK(topK: number): number {
  if (topK <= 0) return 0;
  return Math.min(100, Math.max(topK, Math.ceil(topK * 3)));
}

function prepareSearchHits<T extends { url: string; title: string; snippet: string }>(
  hits: T[],
  topK: number,
  preferAuthority: boolean,
  resultFilter?: (hits: T[]) => T[],
): { results: T[]; duplicateCount: number } {
  const seen = new Set<string>();
  const unique: T[] = [];
  let duplicateCount = 0;
  for (const hit of hits) {
    if (!assessSourceUrlPolicy(hit.url).usable) continue;
    const key = canonicalizeSourceUrl(hit.url);
    if (!key) continue;
    if (seen.has(key)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(key);
    unique.push(hit);
  }
  const eligible = resultFilter ? resultFilter(unique) : unique;
  return {
    results: rankSearchHitsForResearch(eligible, preferAuthority).slice(0, topK),
    duplicateCount,
  };
}

export async function tracedFetchPage(
  ctx: PhaseContext,
  phase: string,
  url: string,
  opts: { timeoutMs?: number; maxChars?: number; focusTerms?: string[]; forceRefresh?: boolean } = {},
  meta: { taskId?: string; reportNodeId?: string; branchId?: string; agentRunId?: string } = {},
  followPublisherPdf = true,
): Promise<{ url: string; title: string; content: string; description?: string } | undefined> {
  throwIfAborted(ctx.signal);
  if (!ctx.stack.fetch) {
    await emitFullTrace(ctx, {
      eventType: "fetch.skipped",
      ...meta,
      payload: { phase, url, reason: "no fetch provider configured" },
    });
    return undefined;
  }
  const urlPolicy = assessSourceUrlPolicy(url);
  if (!urlPolicy.usable) {
    await emitFullTrace(ctx, {
      eventType: "fetch.rejected",
      ...meta,
      payload: {
        phase,
        provider: ctx.stack.fetch.name,
        requestedUrl: url,
        url,
        reason: urlPolicy.reason,
        contentChars: 0,
        durationMs: 0,
      },
    });
    return undefined;
  }
  const focusTerms = opts.focusTerms?.filter(Boolean).slice(0, 32)
    ?? await fetchTaskFocusTerms(ctx, meta.taskId);
  const focusKey = focusTerms.join(" ").toLowerCase().replace(/\s+/gu, " ").slice(0, 500);
  const canonicalUrl = canonicalizeSourceUrl(url);
  const maxCharsKey = opts.maxChars ?? "full";
  const cacheKey = `${canonicalUrl}::${maxCharsKey}::${focusKey}`;
  const completeCacheKey = `${canonicalUrl}::${maxCharsKey}::__complete__`;
  // Failures are focus-independent: a 403 or TLS error for a URL is the same
  // for every task, so later phases must not re-pay for known-bad URLs.
  const failureCacheKey = `${canonicalUrl}::__failure__`;
  if (!opts.forceRefresh && ctx.state.fetchCache.has(failureCacheKey)) {
    await emitFullTrace(ctx, {
      eventType: "fetch.cache_hit",
      ...meta,
      payload: { phase, provider: ctx.stack.fetch.name, url, cacheKey: failureCacheKey, hit: true, negative: true },
    });
    return undefined;
  }
  if (!opts.forceRefresh && ctx.state.fetchCache.has(cacheKey)) {
    const cached = ctx.state.fetchCache.get(cacheKey);
    await emitFullTrace(ctx, {
      eventType: "fetch.cache_hit",
      ...meta,
      payload: {
        phase,
        provider: ctx.stack.fetch.name,
        url,
        cacheKey,
        hit: Boolean(cached),
        title: cached?.title,
        contentChars: cached?.content.length,
      },
    });
    return cached;
  }
  // A response shorter than the requested limit is a complete document, not a
  // focus-dependent truncation. Reuse it across tasks with different focus
  // terms; long max-sized excerpts remain isolated by focusKey.
  if (!opts.forceRefresh && ctx.state.fetchCache.has(completeCacheKey)) {
    const cached = ctx.state.fetchCache.get(completeCacheKey);
    ctx.state.fetchCache.set(cacheKey, cached);
    await emitFullTrace(ctx, {
      eventType: "fetch.cache_hit",
      ...meta,
      payload: {
        phase,
        provider: ctx.stack.fetch.name,
        url,
        cacheKey: completeCacheKey,
        hit: Boolean(cached),
        completeDocument: true,
        title: cached?.title,
        contentChars: cached?.content.length,
      },
    });
    return cached;
  }
  // KnowledgeNode.contentPreview is a bounded excerpt selected for the task
  // that originally saved it. Reusing that excerpt for a different focused
  // task silently contaminates long-document extraction, so focused fetches
  // must use their focus-keyed fetch cache or re-read the source.
  const cachedKnowledge = opts.forceRefresh || phase === "report.leaf.inspect" || focusTerms.length > 0
    ? undefined
    : await knowledgeCacheHit(ctx, url, opts.maxChars);
  if (cachedKnowledge) {
    ctx.state.fetchCache.set(cacheKey, cachedKnowledge.page);
    await emitFullTrace(ctx, {
      eventType: "fetch.kg_cache_hit",
      ...meta,
      payload: {
        phase,
        provider: "knowledge-graph",
        url,
        cacheKey,
        hit: true,
        knowledgeNodeId: cachedKnowledge.knowledge.nodeId,
        title: cachedKnowledge.page.title,
        contentChars: cachedKnowledge.page.content.length,
        summaryChars: cachedKnowledge.knowledge.summary.length,
      },
    });
    return cachedKnowledge.page;
  }
  const startedAt = Date.now();
  await emitFullTrace(ctx, {
    eventType: "fetch.request",
    ...meta,
    payload: { phase, provider: ctx.stack.fetch.name, url, timeoutMs: opts.timeoutMs, maxChars: opts.maxChars, focusTerms, forceRefresh: opts.forceRefresh ?? false },
  });
  const budgetKey = await beginProviderRequest(ctx, "fetch", ctx.stack.fetch.name, phase);
  try {
    let page = await ctx.stack.fetch.fetchPage(url, { timeoutMs: opts.timeoutMs, maxChars: opts.maxChars, focusTerms, signal: ctx.signal });
    await finishProviderRequest(ctx, budgetKey, phase);
    const quality = assessSourceQuality(page);
    if (!quality.usable) {
      await emitFullTrace(ctx, {
        eventType: "fetch.rejected",
        ...meta,
        payload: {
          phase,
          provider: ctx.stack.fetch.name,
          requestedUrl: url,
          url: page.url,
          title: page.title,
          reason: quality.reason,
          contentChars: page.content.length,
          contentPreview: page.content.slice(0, 600),
          durationMs: Date.now() - startedAt,
        },
      });
      ctx.state.fetchCache.set(cacheKey, undefined);
      ctx.state.fetchCache.set(failureCacheKey, undefined);
      return undefined;
    }
    if (followPublisherPdf) {
      const attachmentUrl = autoFollowPdfUrl(page.url || url, page.content);
      if (attachmentUrl) {
        const attachment = await tracedFetchPage(ctx, `${phase}.publisher-pdf`, attachmentUrl, opts, meta, false);
        if (attachment) {
          const maxChars = opts.maxChars ?? Number.POSITIVE_INFINITY;
          const appendix = `\n\n--- Same-publisher PDF attachment (${attachment.url}) ---\n${attachment.content}`;
          page = {
            ...page,
            content: `${page.content.slice(0, Math.max(0, maxChars - appendix.length))}${appendix}`.slice(0, maxChars),
          };
          await emitFullTrace(ctx, {
            eventType: "fetch.attachment_followed",
            ...meta,
            payload: {
              phase,
              landingUrl: url,
              attachmentUrl: attachment.url,
              attachmentTitle: attachment.title,
              attachmentContentChars: attachment.content.length,
              combinedContentChars: page.content.length,
            },
          });
        }
      }
    }
    await emitFullTrace(ctx, {
      eventType: "fetch.response",
      ...meta,
      payload: {
        phase,
        provider: ctx.stack.fetch.name,
        requestedUrl: url,
        url: page.url,
        title: page.title,
        description: page.description,
        contentChars: page.content.length,
        contentPreview: page.content.slice(0, 1200),
        durationMs: Date.now() - startedAt,
      },
    });
    ctx.state.fetchCache.set(cacheKey, page);
    if (
      typeof opts.maxChars === "number"
      && page.content.length < opts.maxChars
      && !/---\s*Focused source passage\s+\d+/iu.test(page.content)
    ) {
      ctx.state.fetchCache.set(completeCacheKey, page);
    }
    return page;
  } catch (err) {
    // Budget breaches already have their own audit record; they are not
    // evidence about the URL and must not masquerade as fetch failures.
    failProviderRequest(ctx, budgetKey, err instanceof ProviderBudgetExceededError ? undefined : {
      url,
      reason: categorizeFetchError(err),
      message: (err instanceof Error ? err.message : String(err)).slice(0, 300),
      phase,
    });
    await emitFullTrace(ctx, {
      eventType: "fetch.error",
      ...meta,
      payload: { phase, provider: ctx.stack.fetch.name, url, durationMs: Date.now() - startedAt, error: errorPayload(err) },
    });
    if (err instanceof ProviderBudgetExceededError) throw err;
    ctx.state.fetchCache.set(cacheKey, undefined);
    ctx.state.fetchCache.set(failureCacheKey, undefined);
    return undefined;
  }
}

async function fetchTaskFocusTerms(ctx: PhaseContext, taskId: string | undefined): Promise<string[]> {
  if (!taskId) return [];
  const task = await ctx.stack.ledger.getById(taskId);
  if (!task) return [];
  return [task.title, task.objective, ...task.acceptanceCriteria].filter(Boolean).slice(0, 16);
}

function autoFollowPdfUrl(landingUrl: string, content: string): string | undefined {
  // The provider adds this explicit appendix after parsing HTML/Markdown. Do
  // not scrape arbitrary URLs from prose, and do not follow large/full pages.
  if (content.length > 20_000) return undefined;
  const marker = "Document links discovered on this page:";
  const appendix = content.split(marker, 2)[1];
  if (!appendix) return undefined;
  const candidates = Array.from(appendix.matchAll(/https?:\/\/[^\s]+?\.pdf(?:\?[^\s]*)?/gi))
    .map((match) => match[0].replace(/[),.;]+$/, ""));
  const unique = Array.from(new Set(candidates));
  if (unique.length !== 1) return undefined;
  try {
    const landing = new URL(landingUrl);
    const attachment = new URL(unique[0]!);
    if (organizationDomain(landing.hostname) !== organizationDomain(attachment.hostname)) return undefined;
    return attachment.toString();
  } catch {
    return undefined;
  }
}

function organizationDomain(hostname: string): string {
  const parts = hostname.toLowerCase().replace(/^www\d*\./, "").split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const secondLevel = parts.at(-2) ?? "";
  const ccTld = (parts.at(-1)?.length ?? 0) === 2;
  const delegatedSecondLevel = ["ac", "co", "com", "edu", "gov", "net", "org"].includes(secondLevel);
  return parts.slice(ccTld && delegatedSecondLevel ? -3 : -2).join(".");
}

async function knowledgeCacheHit(
  ctx: PhaseContext,
  url: string,
  maxChars: number | undefined,
): Promise<{ knowledge: KnowledgeNode; page: { url: string; title: string; content: string; description?: string } } | undefined> {
  const canonical = canonicalizeSourceUrl(url);
  if (!canonical) return undefined;
  const nodes = await ctx.stack.kg.listKnowledgeNodes();
  const knowledge = nodes.find((node) => {
    const nodeCanonical = typeof node.metadata?.canonicalUrl === "string" ? node.metadata.canonicalUrl : canonicalizeSourceUrl(node.url);
    const aliases = Array.isArray(node.metadata?.aliases) ? node.metadata.aliases.filter((item): item is string => typeof item === "string") : [];
    return nodeCanonical === canonical || canonicalizeSourceUrl(node.url) === canonical || aliases.some((alias) => canonicalizeSourceUrl(alias) === canonical);
  });
  if (!knowledge) return undefined;
  const contentPreview = typeof knowledge.metadata?.contentPreview === "string" ? knowledge.metadata.contentPreview : "";
  const body = [contentPreview, knowledge.summary].filter(Boolean).join("\n\n资料摘要：\n");
  if (!body.trim()) return undefined;
  return {
    knowledge,
    page: {
      url: knowledge.url || canonical,
      title: knowledge.title || canonical,
      content: body.slice(0, maxChars ?? body.length),
      description: typeof knowledge.metadata?.description === "string" ? knowledge.metadata.description : undefined,
    },
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  throw new Error(typeof reason === "string" ? reason : "Research run aborted");
}

export async function traceWrite(
  ctx: PhaseContext,
  target: string,
  action: string,
  payload: Record<string, unknown>,
  meta: { taskId?: string; reportNodeId?: string; branchId?: string; agentRunId?: string } = {},
): Promise<void> {
  await emitFullTrace(ctx, {
    eventType: `${target}.${action}`,
    ...meta,
    payload,
  });
}

export async function exportSummaryTrace(ctx: PhaseContext): Promise<string> {
  const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
  return events
    .filter((event) => !event.eventType.startsWith("full."))
    .map((event) => JSON.stringify(event))
    .join("\n");
}

export async function exportFullTrace(ctx: PhaseContext): Promise<string> {
  const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
  return events.map((event) => JSON.stringify(event)).join("\n");
}

function errorPayload(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { message: String(err) };
  return { name: err.name, message: err.message, stack: err.stack };
}

/** Maps a fetch failure to a stable category for budget-audit diagnostics. */
export function categorizeFetchError(err: unknown): string {
  const text = `${err instanceof Error ? err.name : ""} ${err instanceof Error ? err.message : String(err)}`;
  if (/abort/i.test(text)) return "aborted";
  if (/timed?\s*out|timeout|deadline/i.test(text)) return "timeout";
  const http = /\b(?:HTTP|status(?:\s+code)?)\s*[:=]?\s*(\d{3})\b/i.exec(text);
  if (http) return `http_${http[1]}`;
  if (/private network|ssrf|non-?public|link-?local|loopback/i.test(text)) return "ssrf_blocked";
  if (/ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|socket|fetch failed|network/i.test(text)) return "network_error";
  if (/too large|max\w*bytes|size limit|content length/i.test(text)) return "content_too_large";
  if (/redirect/i.test(text)) return "redirect_error";
  return "error";
}
