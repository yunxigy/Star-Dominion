import { describe, expect, it } from "vitest";
import { createInMemoryKgService } from "@deepresearch/knowledge-graph";
import { createInMemoryMemoryGraph } from "@deepresearch/memory-graph";
import { createInMemoryTaskLedger } from "@deepresearch/task-ledger";
import type { FetchProvider, KnowledgeNode, LlmChat, ReportNode, SearchProvider } from "@deepresearch/contracts";
import { createPhaseContext } from "../phase-runner.js";
import { loadDefaultRuntimeProfile } from "../infra/config.js";
import { countedRowHarvestTool, createPhaseToolRegistry, evidenceTools } from "../tools.js";
import { knowledgeNodeIdForUrl } from "../source-identity.js";

const fixedNow = () => Date.UTC(2026, 6, 1, 0, 0, 0, 0);

describe("createPhaseToolRegistry", () => {
  it("exposes each runtime tool exactly once", async () => {
    const tools = await Promise.resolve(createPhaseToolRegistry(testContext()).listTools());
    const names = tools.map((tool) => tool.toolName);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("inspect_knowledge_node");
    expect(names.filter((name) => name === "calculate_distribution_indices")).toHaveLength(1);
    expect(evidenceTools.filter((tool) => tool.toolName === "calculate_distribution_indices")).toHaveLength(1);
  });

  it("calculates auditable Atkinson, Hoover, and Theil distribution indices", async () => {
    const registry = createPhaseToolRegistry(testContext());
    const result = await registry.invoke({
      toolName: "calculate_distribution_indices",
      args: {
        labels: ["A", "B"],
        weights: [1, 1],
        values: [3, 1],
      },
    });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      entryCount: 2,
      weightTotal: 2,
      valueTotal: 4,
      atkinsonEpsilon: 1,
      hooverRatio: 0.25,
      hooverPercent: 25,
      entries: [
        { label: "A", weight: 1, value: 3, weightShare: 0.5, valueShare: 0.75, relativeConcentration: 1.5 },
        { label: "B", weight: 1, value: 1, weightShare: 0.5, valueShare: 0.25, relativeConcentration: 0.5 },
      ],
    });
    const output = result.output as { atkinson: number; theil: number };
    expect(output.theil).toBeCloseTo(0.1308120359, 10);
    expect(output.atkinson).toBeCloseTo(0.1339745962, 10);
  });

  it("returns zero inequality for values proportional to weights", async () => {
    const result = await createPhaseToolRegistry(testContext()).invoke({
      toolName: "calculate_distribution_indices",
      args: { weights: [1, 2, 3], values: [10, 20, 30], atkinsonEpsilon: 0.5 },
    });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      atkinson: 0,
      atkinsonEpsilon: 0.5,
      hooverRatio: 0,
      hooverPercent: 0,
      theil: 0,
    });
  });

  it("handles zero value shares for Atkinson epsilon one and below one", async () => {
    const registry = createPhaseToolRegistry(testContext());
    const geometricMeanResult = await registry.invoke({
      toolName: "calculate_distribution_indices",
      args: { weights: [1, 1], values: [1, 0] },
    });
    const powerMeanResult = await registry.invoke({
      toolName: "calculate_distribution_indices",
      args: { weights: [1, 1], values: [1, 0], atkinsonEpsilon: 0.5 },
    });

    expect(geometricMeanResult.ok).toBe(true);
    expect(geometricMeanResult.output).toMatchObject({
      atkinson: 1,
      hooverRatio: 0.5,
      hooverPercent: 50,
    });
    expect((geometricMeanResult.output as { theil: number }).theil).toBeCloseTo(Math.log(2), 12);
    expect(powerMeanResult.ok).toBe(true);
    expect(powerMeanResult.output).toMatchObject({ atkinson: 0.5, atkinsonEpsilon: 0.5 });
  });

  it.each([
    ["mismatched lengths", { weights: [1, 1], values: [1, 2, 3] }],
    ["zero weight", { weights: [1, 0], values: [1, 2] }],
    ["negative value", { weights: [1, 1], values: [1, -1] }],
    ["all-zero values", { weights: [1, 1], values: [0, 0] }],
    ["non-finite weight", { weights: [1, Number.NaN], values: [1, 2] }],
    ["mismatched labels", { labels: ["A"], weights: [1, 1], values: [1, 2] }],
    ["negative epsilon", { weights: [1, 1], values: [1, 2], atkinsonEpsilon: -0.5 }],
    ["non-finite epsilon", { weights: [1, 1], values: [1, 2], atkinsonEpsilon: Number.POSITIVE_INFINITY }],
  ])("rejects invalid distribution inputs: %s", async (_label, args) => {
    const result = await createPhaseToolRegistry(testContext()).invoke({
      toolName: "calculate_distribution_indices",
      args,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("routes search and fetch through traced providers", async () => {
    let observedFocusTerms: string[] | undefined;
    const search: SearchProvider = {
      name: "fixture-search",
      async search(query, topK) {
        return [{ url: "https://example.test/a", title: `Result ${query}`, snippet: `topK=${topK}` }];
      },
    };
    const fetch: FetchProvider = {
      name: "fixture-fetch",
      async fetchPage(url, opts) {
        observedFocusTerms = opts?.focusTerms;
        return {
          url,
          title: "Fetched",
          content: "Readable source content with enough detail to pass source quality checks and exercise traced fetch output.",
        };
      },
    };
    const ctx = testContext({ search, fetch });
    const registry = createPhaseToolRegistry(ctx, {
      phase: "agent-runtime",
      taskId: "T_1",
      reportNodeId: "R_1",
      agentRunId: "A_1",
    });

    const searchResult = await registry.invoke({ toolName: "web_search", args: { query: "test", topK: 1 } });
    const fetchResult = await registry.invoke({
      toolName: "fetch_page",
      args: { url: "https://example.test/a", query: "Article 59 collection target 45% by 2027" },
    });

    expect(searchResult.ok).toBe(true);
    expect(fetchResult.ok).toBe(true);
    expect(observedFocusTerms).toEqual(["Article 59 collection target by"]);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "full.search.request")).toBe(true);
    expect(events.some((event) => event.eventType === "full.fetch.response")).toBe(true);
  });

  it("returns a compact query-focused observation while retaining the full fetched page in cache", async () => {
    const target = "Part C: Targets for recovery of materials. By 31 December 2027, 50 % for lithium; by 31 December 2031, 80 % for lithium.";
    const content = `${"General legal background and obligations. ".repeat(500)}${target}${"Unrelated annex material. ".repeat(500)}`;
    const fetch: FetchProvider = {
      name: "long-law-fetch",
      async fetchPage(url) {
        return { url, title: "Long regulation", content };
      },
    };
    const ctx = testContext({ fetch });
    const result = await createPhaseToolRegistry(ctx, {
      taskId: "T_lithium",
      reportNodeId: "R_lithium",
    }).invoke({
      toolName: "fetch_page",
      args: {
        url: "https://official.example/long-law",
        query: "Part C lithium recovery target",
      },
    });

    const output = result.output as { content: string; fullContentChars: number };
    expect(output.content).toContain("50 % for lithium");
    expect(output.content).toContain("80 % for lithium");
    expect(output.content.length).toBeLessThanOrEqual(12_000);
    expect(output.fullContentChars).toBe(content.length);
    expect(Array.from(ctx.state.fetchCache.values()).some((page) => page?.content === content)).toBe(true);
  });

  it("keeps a late focused legal passage when earlier passages repeatedly mention the same annex", async () => {
    const repeated = Array.from({ length: 13 }, (_, index) => [
      `--- Focused source passage ${index + 1} (characters ${index * 4000}-${(index + 1) * 4000}) ---`,
      `Article 71 refers to Annex XII Parts B and C and recovery of materials including lithium. ${"Background obligations. ".repeat(180)}`,
    ].join("\n"));
    const target = [
      "--- Focused source passage 14 (characters 52000-56000) ---",
      "Part C: Targets for recovery of materials. No later than 31 December 2027: 50 % for lithium. No later than 31 December 2031: 80 % for lithium.",
    ].join("\n");
    const content = ["Regulation header", ...repeated, target].join("\n\n");
    const ctx = testContext({
      fetch: { name: "focused-law", async fetchPage(url) { return { url, title: "Regulation", content }; } },
    });
    const result = await createPhaseToolRegistry(ctx, {
      taskId: "T_annex",
      reportNodeId: "R_annex",
    }).invoke({
      toolName: "fetch_page",
      args: { url: "https://official.example/regulation", query: "Annex XII Part C lithium recovery of materials" },
    });

    const output = result.output as { content: string };
    expect(output.content).toContain("50 % for lithium");
    expect(output.content).toContain("80 % for lithium");
  });

  it("persists focused passages when fetching an already-saved long source", async () => {
    const url = "https://official.example/regulation";
    const target = [
      "--- Focused source passage 2 (characters 4000-8000) ---",
      "Article 59(3). No later than 31 December 2023: 45 %; 31 December 2027: 63 %; 31 December 2030: 73 %.",
    ].join("\n");
    const ctx = testContext({
      fetch: { name: "focused-law", async fetchPage() { return { url, title: "Regulation", content: target }; } },
    });
    const knowledgeNodeId = knowledgeNodeIdForUrl(url, url);
    await ctx.stack.kg.upsertKnowledgeNode({
      nodeId: knowledgeNodeId,
      nodeType: "WebPage",
      title: "Regulation",
      url,
      contentHash: "hash:regulation",
      summary: "Previously saved regulation source.",
      sourceTier: "official",
      qualityScore: 0.95,
      retrievedByTaskId: "T_scout",
      retrievedAt: new Date(fixedNow()).toISOString(),
      metadata: { canonicalUrl: url, aliases: [url], focusedPassages: [] },
    });
    const registry = createPhaseToolRegistry(ctx, {
      taskId: "T_article_59",
      reportNodeId: "R_article_59",
    });

    const result = await registry.invoke({
      toolName: "fetch_page",
      args: { url, query: "Article 59 collection rate" },
    });

    expect(result.ok).toBe(true);
    await expect(ctx.stack.kg.getKnowledgeNode(knowledgeNodeId)).resolves.toMatchObject({
      metadata: {
        focusedPassages: [expect.stringContaining("45 %")],
        reusedByTaskIds: ["T_article_59"],
      },
    });
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "full.kg.enrichKnowledgeNodeFromFetch")).toBe(true);
  });

  it("persists an explicit annual-report coverage period separately from publication metadata", async () => {
    const ctx = testContext();
    await ctx.stack.kg.upsertReportNode(reportNode("R_1"));
    const registry = createPhaseToolRegistry(ctx, {
      phase: "agent-runtime",
      taskId: "T_1",
      reportNodeId: "R_1",
    });

    const saved = await registry.invoke({
      toolName: "save_knowledge_node",
      args: {
        title: "城市轨道交通2023年度统计和分析报告",
        url: "https://official.example/2023-report",
        snippet: "报告发布于2024-03-28，并比较截至2022年底的数据；标题年度对应2023年统计期。",
        publishedAt: "2024-03-28",
        claimText: "截至2023年底的运营情况",
        relation: "supports",
        sourceTier: "official",
        qualityScore: 0.95,
      },
    });
    const knowledgeNodeId = (saved.output as { knowledgeNodeId: string }).knowledgeNodeId;

    await expect(ctx.stack.kg.getKnowledgeNode(knowledgeNodeId)).resolves.toMatchObject({
      metadata: {
        publishedAt: "2024-03-28",
        coverageStart: "2023-01-01",
        coverageEnd: "2023-12-31",
      },
    });
  });

  it("batch-harvests fetched counted-row candidates and excludes existing row URLs", async () => {
    let searchCalls = 0;
    const fetchedUrls: string[] = [];
    const search: SearchProvider = {
      name: "row-harvest-search",
      async search() {
        searchCalls += 1;
        return [
          { url: "https://journal.test/existing?utm_source=search", title: "Existing empirical online learning study", snippet: "Empirical survey of 200 students." },
          { url: "https://mirror.test/existing-copy", title: "Existing empirical online learning study | Journal mirror", snippet: "The same empirical survey of 200 students." },
          { url: "https://journal.test/new-a", title: "New empirical study A (2022)", snippet: "Alice Author surveyed 350 Canadian students and reported effectiveness outcomes." },
          { url: "https://journal.test/new-b", title: "New comparative study B (2021)", snippet: "Carlos Researcher compared 120 students in India and reported achievement results." },
        ];
      },
    };
    const fetch: FetchProvider = {
      name: "row-harvest-fetch",
      async fetchPage(url) {
        fetchedUrls.push(url);
        return url.endsWith("new-a")
          ? { url, title: "New empirical study A (2022)", content: "Alice Author and Bob Scholar conducted a 2022 cross-sectional survey in Canada. Methods: the sample included 350 university students. Results showed effective online learning for academic performance." }
          : { url: `${url}?error=cookies_not_supported`, title: "New comparative study B (2021)", content: "Carlos Researcher conducted a 2021 comparative experiment in India with 120 university students. Results found online learning ineffective for final examination achievement." };
      },
    };
    const extractionLlm: LlmChat = {
      name: "row-extraction-fixture",
      async chat() {
        return { content: JSON.stringify({ rows: [{
          candidateUrl: "https://journal.test/new-a",
          title: "New empirical study A",
          authors: ["Alice Author", "Bob Scholar"],
          country: "Canada",
          sampleSize: "350 students",
          researchDesign: "Cross-sectional perceptual survey",
          outcomeVariable: "Academic performance",
          findingLabel: "Effective",
          findingExplanation: "Online learning improved academic performance.",
          publicationYear: 2022,
          eligiblePrimaryStudy: true,
        }, {
          candidateUrl: "https://journal.test/new-b",
          title: "New comparative study B",
          authors: ["Carlos Researcher"],
          country: "India",
          sampleSize: "120 students",
          researchDesign: "Comparative experiment",
          outcomeVariable: "Final examination achievement",
          findingLabel: "Ineffective",
          findingExplanation: "Online students had lower final examination achievement.",
          publicationYear: 2021,
          eligiblePrimaryStudy: true,
        }, {
          candidateUrl: "https://journal.test/not-fetched",
          title: "Invented row",
          authors: ["Invented Author"],
          country: "Nowhere",
          sampleSize: "999 students",
          researchDesign: "Survey",
          outcomeVariable: "Scores",
          findingLabel: "Effective",
          findingExplanation: "Invented.",
          publicationYear: 2022,
          eligiblePrimaryStudy: true,
        }] }) };
      },
    };
    const kg = createInMemoryKgService();
    const ctx = testContext({ search, fetch, llm: extractionLlm, kg });
    await kg.upsertReportNode(reportNode("R_rows"));
    const registry = createPhaseToolRegistry(ctx, {
      phase: "agent-runtime",
      taskId: "T_rows",
      reportNodeId: "R_rows",
      tools: [countedRowHarvestTool],
      countedRowHarvest: {
        query: "online learning effectiveness higher education",
        target: 2,
        excludedUrls: ["https://journal.test/existing"],
        excludedTitles: ["Existing empirical online learning study"],
        acceptanceCriteria: ["Verify every study falls within 2020 through 2023."],
        plannedReportlets: [{ partId: "P_1", expectedHeading: "Row one" }, { partId: "P_2", expectedHeading: "Row two" }],
      },
    });

    const result = await registry.invoke({ toolName: "harvest_counted_rows", args: {} });
    const reused = await registry.invoke({ toolName: "harvest_counted_rows", args: {} });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      queryCount: 3,
      excludedExistingCount: 3,
      excludedExistingTitleCount: 6,
      fetchAttemptCount: 2,
      fetchFailedCount: 0,
      candidateCount: 2,
      extractedRowCount: 3,
      savedRowCount: 2,
      rows: [
        expect.objectContaining({ partId: "P_1", knowledgeNodeId: expect.stringMatching(/^K_/), evidenceLinkId: expect.stringMatching(/^E_/), markdown: expect.stringContaining("**Sample Size:** 350 students") }),
        expect.objectContaining({ partId: "P_2", knowledgeNodeId: expect.stringMatching(/^K_/), evidenceLinkId: expect.stringMatching(/^E_/), markdown: expect.stringContaining("**Sample Size:** 120 students") }),
      ],
    });
    expect(searchCalls).toBe(3);
    expect(fetchedUrls.sort()).toEqual(["https://journal.test/new-a", "https://journal.test/new-b"]);
    expect(reused.output).toMatchObject({ reused: true, savedRowCount: 2 });
    expect(searchCalls).toBe(3);
    expect(await kg.listKnowledgeNodes()).toHaveLength(2);
    expect(await kg.listEvidenceLinks("R_rows")).toHaveLength(2);
  });

  it("runs one diversified fallback search when the first strict extraction is short", async () => {
    const searchQueries: string[] = [];
    const fetchedUrls: string[] = [];
    let extractionCalls = 0;
    const search: SearchProvider = {
      name: "row-harvest-fallback-search",
      async search(query) {
        searchQueries.push(query);
        if (query.includes("-review -meta-analysis")) {
          return [{
            url: "https://frontiersin.org/articles/fallback-study",
            title: "Fallback primary study (2021)",
            snippet: "Peer-reviewed empirical study with participants, methods, and results.",
          }];
        }
        return [{
          url: "https://oalib.com/articles/lead-only",
          title: "Lead-only result",
          snippet: "A landing page without methods or participant results.",
        }];
      },
    };
    const fetch: FetchProvider = {
      name: "row-harvest-fallback-fetch",
      async fetchPage(url) {
        fetchedUrls.push(url);
        if (url.includes("lead-only")) {
          return { url, title: "Lead-only result", content: "A readable empirical article landing page describing methods, participants, sample size, and results, but not enough detail for a complete counted row." };
        }
        return {
          url,
          title: "Fallback primary study (2021)",
          content: "Dana Researcher conducted a 2021 cross-sectional survey in Australia. Methods: the sample included 240 university students. Results showed effective online learning for academic performance.",
        };
      },
    };
    const llm: LlmChat = {
      name: "row-harvest-fallback-extractor",
      async chat() {
        extractionCalls += 1;
        return extractionCalls === 1
          ? { content: JSON.stringify({ rows: [] }) }
          : { content: JSON.stringify({ rows: [{
            candidateUrl: "https://frontiersin.org/articles/fallback-study",
            title: "Fallback primary study",
            authors: ["Dana Researcher"],
            country: "Australia",
            sampleSize: "240 students",
            researchDesign: "Cross-sectional survey",
            outcomeVariable: "Academic performance",
            findingLabel: "Effective",
            findingExplanation: "Online learning improved academic performance.",
            publicationYear: 2021,
            eligiblePrimaryStudy: true,
          }] }) };
      },
    };
    const kg = createInMemoryKgService();
    const ctx = testContext({ search, fetch, llm, kg });
    await kg.upsertReportNode(reportNode("R_fallback_rows"));
    const registry = createPhaseToolRegistry(ctx, {
      phase: "agent-runtime",
      taskId: "T_fallback_rows",
      reportNodeId: "R_fallback_rows",
      tools: [countedRowHarvestTool],
      countedRowHarvest: {
        query: "online learning effectiveness higher education",
        target: 1,
        excludedUrls: [],
        excludedTitles: [],
        acceptanceCriteria: ["Verify every study falls within 2020 through 2023."],
        plannedReportlets: [{ partId: "P_1", expectedHeading: "Recovered row" }],
      },
    });

    const result = await registry.invoke({ toolName: "harvest_counted_rows", args: {} });
    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({ queryCount: 4, savedRowCount: 1, extractedRowCount: 1 });
    expect(searchQueries).toHaveLength(4);
    expect(searchQueries.at(-1)).toContain("-review -meta-analysis");
    expect(searchQueries.at(-1)).toContain("online learning higher education COVID-19 pandemic");
    expect(searchQueries.at(-1)).toContain("-site:oalib.com -site:scirp.org -site:researchgate.net -site:academia.edu");
    expect(fetchedUrls).toContain("https://frontiersin.org/articles/fallback-study");
    expect(await kg.listKnowledgeNodes()).toHaveLength(1);
    expect(await kg.listEvidenceLinks("R_fallback_rows")).toHaveLength(1);
  });

  it("filters snippet-only counted-row fetches before extraction", async () => {
    let extractionPacket = "";
    const search: SearchProvider = {
      name: "row-harvest-readable-search",
      async search() {
        return [
          { url: "https://journal.test/full-study", title: "Empirical online education survey (2022)", snippet: "A survey of university students with academic performance results." },
          { url: "https://journal2.test/full-study-2", title: "Empirical remote classes survey (2021)", snippet: "A survey of university students with satisfaction outcomes." },
          ...Array.from({ length: 7 }, (_, index) => ({
            url: `https://journal.test/snippet-only-${index}`,
            title: `Empirical study of online education ${index}`,
            snippet: "A landing page about online learning effectiveness.",
          })),
        ];
      },
    };
    const fetch: FetchProvider = {
      name: "row-harvest-readable-fetch",
      async fetchPage(url) {
        if (url.includes("snippet-only")) {
          return { url, title: "Online learning study landing page", content: "Title and search summary only. No readable article body was returned." };
        }
        return url.endsWith("full-study-2")
          ? { url, title: "Remote classes article (2021)", content: "Robin Scholar conducted a 2021 survey in India. Methods: 180 university students participated. Results showed neutral online learning outcomes for course satisfaction." }
          : { url, title: "Online learning primary study (2022)", content: "Dana Researcher conducted a 2022 survey in Canada. Methods: 240 university students participated. Results showed effective online learning for academic performance." };
      },
    };
    const llm: LlmChat = {
      name: "row-harvest-readable-extractor",
      async chat(request) {
        extractionPacket = String(request.user);
        return { content: JSON.stringify({ rows: [{
          candidateUrl: "https://journal.test/full-study",
          title: "Online learning primary study",
          authors: ["Dana Researcher"],
          country: "Canada",
          sampleSize: "240 students",
          researchDesign: "Cross-sectional survey",
          outcomeVariable: "Academic performance",
          findingLabel: "Effective",
          findingExplanation: "Online learning improved academic performance.",
          publicationYear: 2022,
          eligiblePrimaryStudy: true,
        }] }) };
      },
    };
    const kg = createInMemoryKgService();
    const ctx = testContext({ search, fetch, llm, kg });
    await kg.upsertReportNode(reportNode("R_readable_rows"));
    const registry = createPhaseToolRegistry(ctx, {
      phase: "agent-runtime",
      taskId: "T_readable_rows",
      reportNodeId: "R_readable_rows",
      tools: [countedRowHarvestTool],
      countedRowHarvest: {
        query: "online learning effectiveness higher education",
        target: 1,
        excludedUrls: [],
        excludedTitles: [],
        acceptanceCriteria: ["Verify every study falls within 2020 through 2023."],
        plannedReportlets: [{ partId: "P_1", expectedHeading: "Readable row" }],
      },
    });

    const result = await registry.invoke({ toolName: "harvest_counted_rows", args: {} });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({ queryCount: 3, candidateCount: 2, savedRowCount: 1 });
    expect(extractionPacket).toContain("Requested rows: 1");
    expect(extractionPacket).toContain("https://journal.test/full-study");
    expect(extractionPacket).not.toContain("https://journal.test/snippet-only-0");
  });

  it("adds explicit regional terms to counted-row searches", async () => {
    const queries: string[] = [];
    const search: SearchProvider = {
      name: "regional-row-search",
      async search(query) {
        queries.push(query);
        return [];
      },
    };
    const kg = createInMemoryKgService();
    const ctx = testContext({ search, kg });
    await kg.upsertReportNode(reportNode("R_regional_rows"));
    const registry = createPhaseToolRegistry(ctx, {
      phase: "agent-runtime",
      taskId: "T_regional_rows",
      reportNodeId: "R_regional_rows",
      tools: [countedRowHarvestTool],
      countedRowHarvest: {
        query: "European and African studies online learning effectiveness",
        target: 1,
        excludedUrls: [],
        excludedTitles: [],
        acceptanceCriteria: ["Verify every study falls within 2020 through 2023."],
        plannedReportlets: [{ partId: "P_1", expectedHeading: "Regional row" }],
      },
    });

    const result = await registry.invoke({ toolName: "harvest_counted_rows", args: {} });

    expect(result.ok).toBe(true);
    expect(queries).toHaveLength(4);
    expect(queries.every((query) => query.includes("Germany France Italy Spain United Kingdom Nigeria South Africa Kenya"))).toBe(true);
  });

  it("retains a concrete sample count from a late participant section", async () => {
    const search: SearchProvider = {
      name: "late-sample-search",
      async search() {
        return [{ url: "https://journal.test/late-sample", title: "Late sample study (2022)", snippet: "Primary online-learning study with full methods and results." }];
      },
    };
    const fetch: FetchProvider = {
      name: "late-sample-fetch",
      async fetchPage(url) {
        return {
          url,
          title: "Late sample study (2022)",
          content: [
            "Dana Researcher published this 2022 primary empirical study. Methods and results are described below.",
            "Background context about institutional transitions. ".repeat(260),
            "## Participants and methods\nThe cross-sectional survey was conducted in Canada with a sample size of 350 university students.",
            "## Results\nOnline learning was effective for academic performance.",
          ].join("\n"),
        };
      },
    };
    const llm: LlmChat = {
      name: "late-sample-extractor",
      async chat() {
        return { content: JSON.stringify({ rows: [{
          candidateUrl: "https://journal.test/late-sample",
          title: "Late sample study",
          authors: ["Dana Researcher"],
          country: "Canada",
          sampleSize: "350 students",
          researchDesign: "Cross-sectional survey",
          outcomeVariable: "Academic performance",
          findingLabel: "Effective",
          findingExplanation: "Online learning improved academic performance.",
          publicationYear: 2022,
          eligiblePrimaryStudy: true,
        }] }) };
      },
    };
    const kg = createInMemoryKgService();
    const ctx = testContext({ search, fetch, llm, kg });
    await kg.upsertReportNode(reportNode("R_late_sample"));
    const registry = createPhaseToolRegistry(ctx, {
      phase: "agent-runtime",
      taskId: "T_late_sample",
      reportNodeId: "R_late_sample",
      tools: [countedRowHarvestTool],
      countedRowHarvest: {
        query: "online learning effectiveness higher education",
        target: 1,
        excludedUrls: [],
        excludedTitles: [],
        acceptanceCriteria: ["Verify every study falls within 2020 through 2023."],
        plannedReportlets: [{ partId: "P_1", expectedHeading: "Late sample row" }],
      },
    });

    const result = await registry.invoke({ toolName: "harvest_counted_rows", args: {} });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({ savedRowCount: 1, extractedRowCount: 1 });
    expect(await kg.listKnowledgeNodes()).toHaveLength(1);
  });

  it("never returns, fetches, or saves reserved placeholder sources", async () => {
    let fetchCalls = 0;
    const search: SearchProvider = {
      name: "placeholder-search",
      async search() {
        return [
          { url: "https://example.com/fake", title: "Fake", snippet: "Synthetic placeholder." },
          { url: "https://publisher.test/real", title: "Real", snippet: "A real fixture result." },
        ];
      },
    };
    const fetch: FetchProvider = {
      name: "placeholder-fetch",
      async fetchPage(url) {
        fetchCalls += 1;
        return { url, title: "Fetched", content: "This content must never be requested for a reserved placeholder domain." };
      },
    };
    const kg = createInMemoryKgService();
    const ctx = testContext({ search, fetch, kg });
    await kg.upsertReportNode(reportNode("R_1"));
    const registry = createPhaseToolRegistry(ctx, {
      phase: "agent-runtime",
      taskId: "T_1",
      reportNodeId: "R_1",
      branchId: "B_1",
      agentRunId: "A_1",
    });

    const searchResult = await registry.invoke({ toolName: "web_search", args: { query: "test", topK: 2 } });
    const fetchResult = await registry.invoke({ toolName: "fetch_page", args: { url: "https://docs.example.org/fake" } });
    const saveResult = await registry.invoke({
      toolName: "save_knowledge_node",
      args: {
        title: "Fabricated official source",
        url: "https://sub.example.net/req-005",
        snippet: "Synthetic source text that must not enter the knowledge graph.",
        sourceTier: "official",
        qualityScore: 1,
        claimText: "Fabricated claim",
        relation: "supports",
      },
    });

    expect(searchResult.output).toEqual([{ url: "https://publisher.test/real", title: "Real", snippet: "A real fixture result." }]);
    expect(fetchResult.output).toBeUndefined();
    expect(saveResult.output).toBeUndefined();
    expect(fetchCalls).toBe(0);
    expect(await kg.listKnowledgeNodes()).toHaveLength(0);
    expect(await kg.listEvidenceLinks()).toHaveLength(0);
  });

  it("automatically follows one same-organization PDF from a shallow landing page", async () => {
    const requested: string[] = [];
    const fetch: FetchProvider = {
      name: "fixture-fetch",
      async fetchPage(url) {
        requested.push(url);
        if (url.endsWith("report.pdf")) {
          return {
            url,
            title: "Official PDF",
            content: "--- PDF page 1 ---\nAI and big data, networks and cybersecurity, and technological literacy are growing skills.",
          };
        }
        return {
          url,
          title: "Official landing",
          content: "Report overview.\n\nDocument links discovered on this page:\n- Download PDF: https://www3.official.example/report.pdf",
        };
      },
    };
    const ctx = testContext({ fetch });
    await ctx.stack.kg.upsertReportNode(reportNode("R_1"));
    const registry = createPhaseToolRegistry(ctx, { phase: "agent-runtime", taskId: "T_1", reportNodeId: "R_1" });

    const result = await registry.invoke({ toolName: "fetch_page", args: { url: "https://www.official.example/report" } });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      url: "https://www.official.example/report",
      content: expect.stringContaining("AI and big data"),
    });
    expect(requested).toEqual([
      "https://www.official.example/report",
      "https://www3.official.example/report.pdf",
    ]);
    await registry.invoke({
      toolName: "save_knowledge_node",
      args: {
        title: "Official report",
        url: "https://www.official.example/report",
        content: "Agent-authored content that must not replace the verified fetch cache.",
        claimText: "Growing skills",
        relation: "supports",
        sourceTier: "official",
        qualityScore: 0.9,
      },
    });
    const [knowledge] = await ctx.stack.kg.listKnowledgeNodes();
    expect(knowledge?.metadata).toMatchObject({
      fetched: true,
      contentProvenance: "fetch_cache",
      contentPreview: expect.stringContaining("AI and big data"),
    });
    expect(knowledge?.metadata.contentPreview).not.toContain("Agent-authored content");
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "full.fetch.attachment_followed")).toBe(true);
  });

  it("inspects a relevant late PDF page from the full fetch cache without another provider request", async () => {
    let fetchCalls = 0;
    const url = "https://official.example/annual-report.pdf";
    const content = [
      "--- PDF page 1 ---\n封面和声明。" + "前言".repeat(3_000),
      "--- PDF page 2 ---\n目录。" + "目录项".repeat(3_000),
      "--- PDF page 3 ---\n2022年服务效率统计：日均客运量为100万人次，客运强度为0.52万人次/公里日。" + "附注".repeat(2_000),
      "--- PDF page 4 ---\n其他附录。" + "附录".repeat(3_000),
    ].join("\n");
    const fetch: FetchProvider = {
      name: "long-pdf-fetch",
      async fetchPage(requestedUrl) {
        fetchCalls += 1;
        return { url: requestedUrl, title: "2022年度统计报告", content };
      },
    };
    const ctx = testContext({ fetch });
    await ctx.stack.kg.upsertReportNode(reportNode("R_1"));
    const registry = createPhaseToolRegistry(ctx, {
      phase: "agent-runtime",
      taskId: "T_1",
      reportNodeId: "R_1",
    });
    await registry.invoke({ toolName: "fetch_page", args: { url } });
    const saved = await registry.invoke({
      toolName: "save_knowledge_node",
      args: {
        title: "2022年度统计报告",
        url,
        claimText: "2022年客运强度",
        relation: "supports",
        sourceTier: "official",
        qualityScore: 0.95,
      },
    });
    const knowledgeNodeId = (saved.output as { knowledgeNodeId: string }).knowledgeNodeId;

    const inspected = await registry.invoke({
      toolName: "inspect_knowledge_node",
      args: { knowledgeNodeId, query: "2022年日均客运量和客运强度", maxChars: 2_000 },
    });

    expect(fetchCalls).toBe(1);
    expect(inspected.output).toMatchObject({
      metadata: { contentPreview: expect.stringContaining("客运强度为0.52") },
      inspection: {
        fullContentAvailable: true,
        contentChars: content.length,
        excerptChars: expect.any(Number),
        excerptOffsets: [expect.objectContaining({ start: expect.any(Number), end: expect.any(Number) })],
      },
    });
    expect((inspected.output as { metadata: { contentPreview: string } }).metadata.contentPreview).not.toContain("封面和声明");
  });

  it("batch-inspects several cached annual reports in one tool call", async () => {
    const ctx = testContext();
    const sources: KnowledgeNode[] = [2019, 2020, 2021, 2022].map((year) => ({
      nodeId: `K_${year}`,
      nodeType: "Report",
      title: `${year}年度统计报告`,
      url: `https://official.example/${year}.pdf`,
      contentHash: `hash:${year}`,
      summary: `${year}年度资料。`,
      sourceTier: "official",
      qualityScore: 0.95,
      retrievedByTaskId: "T_source",
      retrievedAt: new Date(fixedNow()).toISOString(),
      metadata: { canonicalUrl: `https://official.example/${year}.pdf`, fetched: true, contentPreview: "封面" },
    }));
    for (const source of sources) {
      await ctx.stack.kg.upsertKnowledgeNode(source);
      ctx.state.fetchCache.set(`${source.url}::full`, {
        url: source.url!,
        title: source.title,
        content: `--- PDF page 1 ---\n${"目录".repeat(2_500)}\n--- PDF page 12 ---\n${source.title}：客运强度${source.nodeId.slice(2)}值。`,
      });
    }
    const registry = createPhaseToolRegistry(ctx, { phase: "agent-runtime", taskId: "T_1", reportNodeId: "R_1" });

    const inspected = await registry.invoke({
      toolName: "inspect_knowledge_nodes",
      args: {
        knowledgeNodeIds: sources.map((source) => source.nodeId),
        query: "2019至2022年客运强度",
        maxCharsPerSource: 1_000,
      },
    });

    const outputs = (inspected.output as { sources: Array<{ metadata: { contentPreview: string }; inspection: { fullContentAvailable: boolean } }> }).sources;
    expect(outputs).toHaveLength(4);
    expect(outputs.every((source) => source.inspection.fullContentAvailable)).toBe(true);
    expect(outputs.map((source) => source.metadata.contentPreview)).toEqual([
      expect.stringContaining("客运强度2019值"),
      expect.stringContaining("客运强度2020值"),
      expect.stringContaining("客运强度2021值"),
      expect.stringContaining("客运强度2022值"),
    ]);
  });

  it("force-refreshes a shallow cached source and upgrades the existing KnowledgeNode", async () => {
    let fetchCalls = 0;
    const url = "https://official.example/shallow-report.pdf";
    const fetch: FetchProvider = {
      name: "refresh-fetch",
      async fetchPage(requestedUrl) {
        fetchCalls += 1;
        return {
          url: requestedUrl,
          title: "Complete annual report",
          content: `--- PDF page 1 ---\n${"声明".repeat(1_000)}\n--- PDF page 18 ---\n2022年北京日均客运量620.08万人次。`,
        };
      },
    };
    const ctx = testContext({ fetch });
    await ctx.stack.kg.upsertReportNode(reportNode("R_1"));
    const knowledgeNodeId = knowledgeNodeIdForUrl(url, url);
    await ctx.stack.kg.upsertKnowledgeNode({
      nodeId: knowledgeNodeId,
      nodeType: "Report",
      title: "Shallow annual report",
      url,
      contentHash: "hash:shallow",
      summary: "Only a search-result summary is currently available.",
      sourceTier: "official",
      qualityScore: 0.9,
      retrievedByTaskId: "T_previous",
      retrievedAt: new Date(fixedNow()).toISOString(),
      metadata: { canonicalUrl: url, fetched: true, contentPreview: "short preview" },
    });
    ctx.state.fetchCache.set(`${url}::full`, { url, title: "Shallow", content: "short preview" });
    const registry = createPhaseToolRegistry(ctx, {
      phase: "agent-runtime",
      taskId: "T_1",
      reportNodeId: "R_1",
    });

    const refreshed = await registry.invoke({
      toolName: "refresh_knowledge_node",
      args: { knowledgeNodeId, query: "2022年北京日均客运量", excerptMaxChars: 2_000 },
    });

    expect(fetchCalls).toBe(1);
    expect(refreshed.output).toMatchObject({
      nodeId: knowledgeNodeId,
      metadata: { contentPreview: expect.stringContaining("620.08万人次") },
      inspection: { fullContentAvailable: true, fetchCacheAvailable: true },
      refresh: {
        refreshed: true,
        reusedKnowledgeNode: true,
        requestedKnowledgeNodeId: knowledgeNodeId,
        resultingKnowledgeNodeId: knowledgeNodeId,
      },
    });
    await expect(ctx.stack.kg.getKnowledgeNode(knowledgeNodeId)).resolves.toMatchObject({
      metadata: { contentPreview: expect.stringContaining("620.08万人次") },
    });
  });

  it("does not auto-follow cross-organization or ambiguous PDF links", async () => {
    const requested: string[] = [];
    const fetch: FetchProvider = {
      name: "fixture-fetch",
      async fetchPage(url) {
        requested.push(url);
        return {
          url,
          title: "Landing",
          content: "Document links discovered on this page:\n- Mirror: https://mirror.example/report.pdf\n- Appendix: https://official.example/appendix.pdf",
        };
      },
    };
    const ctx = testContext({ fetch });
    const registry = createPhaseToolRegistry(ctx, { phase: "agent-runtime" });

    await registry.invoke({ toolName: "fetch_page", args: { url: "https://official.example/report" } });

    expect(requested).toEqual(["https://official.example/report"]);
  });

  it("requests extra search results and returns topK unique URLs", async () => {
    let requestedTopK = 0;
    const search: SearchProvider = {
      name: "dedupe-search",
      async search(_query, topK) {
        requestedTopK = topK;
        return [
          { url: "https://example.test/a?utm_source=x", title: "A1", snippet: "First A." },
          { url: "https://example.test/a", title: "A2", snippet: "Duplicate A." },
          { url: "https://example.test/b", title: "B", snippet: "B." },
          { url: "https://example.test/c", title: "C", snippet: "C." },
        ].slice(0, topK);
      },
    };
    const ctx = testContext({ search });
    const registry = createPhaseToolRegistry(ctx, {
      phase: "agent-runtime",
      taskId: "T_1",
      reportNodeId: "R_1",
      agentRunId: "A_1",
    });

    const result = await registry.invoke({ toolName: "web_search", args: { query: "test", topK: 3 } });

    expect(result.ok).toBe(true);
    expect(requestedTopK).toBeGreaterThan(3);
    expect(result.output).toEqual([
      expect.objectContaining({ url: "https://example.test/a?utm_source=x" }),
      expect.objectContaining({ url: "https://example.test/b" }),
      expect.objectContaining({ url: "https://example.test/c" }),
    ]);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "full.search.response" && event.payload?.duplicateCount === 1 && event.payload?.uniqueResultCount === 3)).toBe(true);
  });

  it("uses an expanded candidate pool to diversify ordinary search results", async () => {
    let requestedTopK = 0;
    const search: SearchProvider = {
      name: "diverse-search",
      async search(_query, topK) {
        requestedTopK = topK;
        return [
          { url: "https://alpha-research.test/one", title: "Alpha one", snippet: "First result." },
          { url: "https://alpha-research.test/two", title: "Alpha two", snippet: "Second result." },
          { url: "https://beta-research.test/one", title: "Beta one", snippet: "Third result." },
          { url: "https://beta-research.test/two", title: "Beta two", snippet: "Fourth result." },
        ].slice(0, topK);
      },
    };
    const ctx = testContext({ search });
    const registry = createPhaseToolRegistry(ctx, { phase: "agent-runtime", reportNodeId: "R_1" });

    const result = await registry.invoke({ toolName: "web_search", args: { query: "ordinary query", topK: 2 } });

    expect(result.ok).toBe(true);
    expect(requestedTopK).toBe(4);
    expect(result.output).toEqual([
      expect.objectContaining({ url: "https://alpha-research.test/one" }),
      expect.objectContaining({ url: "https://beta-research.test/one" }),
    ]);
  });

  it("saves sources, links evidence, opens gaps, and creates tasks", async () => {
    const kg = createInMemoryKgService();
    const ledger = createInMemoryTaskLedger();
    const ctx = testContext({ kg, ledger });
    await kg.upsertReportNode(reportNode("R_1"));
    const registry = createPhaseToolRegistry(ctx, {
      phase: "agent-runtime",
      taskId: "T_1",
      reportNodeId: "R_1",
      branchId: "B_1",
      agentRunId: "A_1",
    });

    const saved = await registry.invoke({
      toolName: "save_knowledge_node",
      args: {
        title: "Source",
        url: "https://example.test/source",
        snippet: "Source summary with enough readable detail to pass source quality checks and persist as a KnowledgeNode.",
        claimText: "Claim",
        relation: "supports",
        confidence: 0.8,
      },
    });
    const gap = await registry.invoke({
      toolName: "open_gap",
      args: { description: "Need primary source", suggestedQuery: "primary source" },
    });
    const task = await registry.invoke({
      toolName: "create_task",
      args: {
        title: "Repair evidence",
        objective: "Find primary source",
        reportNodeId: "R_1",
        acceptanceCriteria: ["Find one source."],
      },
    });

    expect(saved.ok).toBe(true);
    expect(gap.ok).toBe(true);
    expect(task.ok).toBe(true);
    expect(await kg.listKnowledgeNodes()).toHaveLength(1);
    expect(await kg.listEvidenceLinks("R_1")).toHaveLength(1);
    expect(await kg.listOpenGaps?.("R_1")).toHaveLength(1);
    expect((await ledger.listByStatus("queued")).some((item) => item.taskId.startsWith("T_tool_"))).toBe(true);
  });

  it("resolves an EvidenceLink id passed where link_evidence expects a KnowledgeNode id", async () => {
    const kg = createInMemoryKgService();
    const ctx = testContext({ kg });
    await kg.upsertReportNode(reportNode("R_1"));
    await kg.upsertReportNode(reportNode("R_2"));
    const first = createPhaseToolRegistry(ctx, {
      phase: "agent-runtime",
      taskId: "T_1",
      reportNodeId: "R_1",
      branchId: "B_1",
    });
    const saved = await first.invoke({
      toolName: "save_knowledge_node",
      args: {
        title: "Reusable source",
        url: "https://example.test/reusable",
        snippet: "Reusable source content directly supports the claim and is long enough to save.",
        claimText: "First claim",
        relation: "supports",
        confidence: 0.8,
      },
    });
    const evidenceLinkId = (saved.output as { evidenceLinkId: string }).evidenceLinkId;
    const second = createPhaseToolRegistry(ctx, {
      phase: "agent-runtime",
      taskId: "T_2",
      reportNodeId: "R_2",
      branchId: "B_2",
    });

    const linked = await second.invoke({
      toolName: "link_evidence",
      args: { knowledgeNodeId: evidenceLinkId, claimText: "Second claim", relation: "supports", confidence: 0.8 },
    });

    expect(linked.ok).toBe(true);
    expect(linked.output).toMatchObject({ resolvedFromEvidenceLinkId: evidenceLinkId });
    expect(await kg.listEvidenceLinks("R_2")).toHaveLength(1);
  });

  it("requires a concrete claim when linking existing knowledge", async () => {
    const kg = createInMemoryKgService();
    const ctx = testContext({ kg });
    await kg.upsertReportNode(reportNode("R_claim"));
    await kg.upsertKnowledgeNode({
      nodeId: "K_claim",
      nodeType: "WebPage",
      title: "Official source",
      url: "https://official.example/source",
      contentHash: "sha256:claim",
      summary: "An official source with enough detail to be reused as evidence.",
      sourceTier: "official",
      qualityScore: 0.9,
      retrievedByTaskId: "T_seed",
      retrievedAt: "2026-07-01T00:00:00.000Z",
      metadata: {},
    });
    const registry = createPhaseToolRegistry(ctx, {
      phase: "agent-runtime",
      taskId: "T_claim",
      reportNodeId: "R_claim",
      branchId: "B_claim",
    });

    const linked = await registry.invoke({
      toolName: "link_evidence",
      args: { knowledgeNodeId: "K_claim", relation: "supports" },
    });

    expect(linked.ok).toBe(false);
    expect(linked.error).toContain("claimText is required");
    expect(await kg.listEvidenceLinks("R_claim")).toHaveLength(0);
  });

  it("keeps generated EvidenceLink ids unique for long repair task ids with the same prefix", async () => {
    const kg = createInMemoryKgService();
    const ctx = testContext({ kg });
    await kg.upsertReportNode(reportNode("R_long"));
    await kg.upsertKnowledgeNode({
      nodeId: "K_long",
      nodeType: "WebPage",
      title: "Reusable official source",
      url: "https://official.example/long",
      contentHash: "sha256:long",
      summary: "A reusable official source with enough detail for two distinct evidence claims.",
      sourceTier: "official",
      qualityScore: 0.9,
      retrievedByTaskId: "T_seed",
      retrievedAt: "2026-07-01T00:00:00.000Z",
      metadata: {},
    });
    const commonPrefix = "T_completion_gap_R_hyp_1_ungrounded_research_requirement_";
    const first = createPhaseToolRegistry(ctx, {
      phase: "agent-runtime",
      taskId: `${commonPrefix}first`,
      reportNodeId: "R_long",
      branchId: "B_first",
    });
    const second = createPhaseToolRegistry(ctx, {
      phase: "agent-runtime",
      taskId: `${commonPrefix}second`,
      reportNodeId: "R_long",
      branchId: "B_second",
    });

    const firstResult = await first.invoke({
      toolName: "link_evidence",
      args: { knowledgeNodeId: "K_long", relation: "supports", claimText: "First concrete claim." },
    });
    const secondResult = await second.invoke({
      toolName: "link_evidence",
      args: { knowledgeNodeId: "K_long", relation: "supports", claimText: "Second concrete claim." },
    });

    expect(firstResult.ok).toBe(true);
    expect(secondResult.ok).toBe(true);
    expect((firstResult.output as { evidenceLinkId: string }).evidenceLinkId)
      .not.toBe((secondResult.output as { evidenceLinkId: string }).evidenceLinkId);
    expect(await kg.listEvidenceLinks("R_long")).toHaveLength(2);
  });

  it("rejects whole-battery recycling efficiency as support for a material-recovery target", async () => {
    const kg = createInMemoryKgService();
    const ctx = testContext({ kg });
    const sourceNode = reportNode("R_source");
    const materialNode = { ...reportNode("R_material"), requirementIds: ["REQ_MATERIAL"] };
    await kg.upsertReportNode(sourceNode);
    await kg.upsertReportNode(materialNode);
    ctx.state.globalRubric = {
      rubricId: "RB_metric_guard",
      episodeId: ctx.state.episodeId,
      rubricText: "Extract the lithium recovery-of-materials target.",
      outputHints: {},
      requirements: [{
        requirementId: "REQ_MATERIAL",
        description: "提取锂的材料回收率目标。",
        kind: "question",
        priority: "must",
        evidenceRequired: true,
        evidenceNeeds: ["recovery of materials target for lithium"],
        successCriteria: ["Report the material recovery rate."],
        metricScope: ["材料回收率"],
      }],
    };
    const saved = await createPhaseToolRegistry(ctx, {
      taskId: "T_source",
      reportNodeId: sourceNode.nodeId,
    }).invoke({
      toolName: "save_knowledge_node",
      args: {
        title: "Official battery regulation",
        url: "https://official.example/battery-regulation",
        snippet: "The official regulation contains recycling and material-recovery targets.",
        relation: "supports",
        claimText: "The regulation contains waste-battery targets.",
        sourceTier: "official",
      },
    });
    const knowledgeNodeId = (saved.output as { knowledgeNodeId: string }).knowledgeNodeId;
    const registry = createPhaseToolRegistry(ctx, { taskId: "T_material", reportNodeId: materialNode.nodeId });

    const wrongMetric = await registry.invoke({
      toolName: "link_evidence",
      args: {
        knowledgeNodeId,
        relation: "supports",
        claimText: "锂基电池的回收效率在2025年达到65%。",
      },
    });
    const correctMetric = await registry.invoke({
      toolName: "link_evidence",
      args: {
        knowledgeNodeId,
        relation: "supports",
        claimText: "锂的材料回收率在2027年达到50%。",
      },
    });

    expect(wrongMetric.output).toMatchObject({ skipped: true, reason: "claim_metric_mismatch" });
    expect(correctMetric.output).toMatchObject({ evidenceLinkId: expect.stringMatching(/^E_/) });
    expect(await kg.listEvidenceLinks(materialNode.nodeId)).toHaveLength(1);
  });

  it("rejects sources already used by a counted-row sibling while allowing a distinct study", async () => {
    const kg = createInMemoryKgService();
    const ctx = testContext({ kg });
    await kg.upsertReportNode(reportNode("R_rows_1"));
    await kg.upsertReportNode(reportNode("R_rows_2"));
    const first = createPhaseToolRegistry(ctx, {
      phase: "agent-runtime",
      taskId: "T_rows_1",
      reportNodeId: "R_rows_1",
    });
    const saved = await first.invoke({
      toolName: "save_knowledge_node",
      args: {
        title: "Already used study",
        url: "https://journal.example/study?utm_source=search",
        snippet: "A primary study with sufficient source detail for a counted table row.",
        claimText: "Complete study row.",
        relation: "supports",
        sourceTier: "primary",
      },
    });
    const existingKnowledgeNodeId = (saved.output as { knowledgeNodeId: string }).knowledgeNodeId;
    const counted = createPhaseToolRegistry(ctx, {
      phase: "agent-runtime",
      taskId: "T_reflect_rows",
      reportNodeId: "R_rows_2",
      countedRowReportNodeIds: ["R_rows_1", "R_rows_2"],
    });

    const duplicateSave = await counted.invoke({
      toolName: "save_knowledge_node",
      args: {
        title: "Already used study",
        url: "https://journal.example/study",
        snippet: "The same primary study returned under its canonical URL.",
        claimText: "Duplicate row.",
        relation: "supports",
        sourceTier: "primary",
      },
    });
    const duplicateLink = await counted.invoke({
      toolName: "link_evidence",
      args: { knowledgeNodeId: existingKnowledgeNodeId, claimText: "Duplicate row.", relation: "supports" },
    });
    const distinctSave = await counted.invoke({
      toolName: "save_knowledge_node",
      args: {
        title: "Distinct study",
        url: "https://journal.example/distinct-study",
        snippet: "A different primary study with sufficient source detail for a counted table row.",
        claimText: "Distinct complete study row.",
        relation: "supports",
        sourceTier: "primary",
      },
    });

    expect(duplicateSave.output).toMatchObject({ skipped: true, reason: "counted_row_source_already_used" });
    expect(duplicateLink.output).toMatchObject({ skipped: true, reason: "counted_row_source_already_used" });
    expect(distinctSave.output).toMatchObject({ knowledgeNodeId: expect.stringMatching(/^K_/) });
    expect(await kg.listEvidenceLinks("R_rows_2")).toHaveLength(1);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.filter((event) => event.eventType === "full.kg.skipEvidenceLink" && event.payload?.reason === "counted_row_source_already_used")).toHaveLength(2);
  });

  it("recalibrates a restored high-authority repost when the source is reused", async () => {
    const kg = createInMemoryKgService();
    const ctx = testContext({ kg });
    await kg.upsertReportNode(reportNode("R_1"));
    const registry = createPhaseToolRegistry(ctx, {
      phase: "agent-runtime",
      taskId: "T_1",
      reportNodeId: "R_1",
      branchId: "B_1",
      agentRunId: "A_1",
    });
    const args = {
      title: "Reposted report",
      url: "https://www.sohu.com/a/123",
      snippet: "A sufficiently detailed reposted report summary used to exercise restored source recalibration.",
      sourceTier: "primary",
      qualityScore: 0.99,
      claimText: "Claim",
      relation: "supports",
      confidence: 0.7,
    };

    await registry.invoke({ toolName: "save_knowledge_node", args });
    const [stored] = await kg.listKnowledgeNodes();
    expect(stored).toMatchObject({ sourceTier: "secondary", qualityScore: 0.55 });
    await kg.upsertKnowledgeNode({ ...stored!, sourceTier: "primary", qualityScore: 0.99 });

    await registry.invoke({ toolName: "save_knowledge_node", args });
    await expect(kg.getKnowledgeNode(stored!.nodeId)).resolves.toMatchObject({
      sourceTier: "secondary",
      qualityScore: 0.55,
      metadata: { qualitySignals: expect.arrayContaining(["reposted_content_domain", "quality_score_capped_0.55"]) },
    });
  });

  it("accepts flattened suggest_patch args", async () => {
    const ctx = testContext();
    const registry = createPhaseToolRegistry(ctx, {
      phase: "agent-runtime",
      taskId: "T_1",
      reportNodeId: "R_1",
      branchId: "B_1",
      agentRunId: "A_1",
    });

    const result = await registry.invoke({
      toolName: "suggest_patch",
      args: {
        op: "rename_report_node",
        reportNodeId: "R_1",
        label: "Renamed",
        rationale: "Clearer label.",
        confidence: 0.8,
      },
    });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      suggestion: {
        patch: { op: "rename_report_node", reportNodeId: "R_1", label: "Renamed" },
      },
    });
  });

  it("ignores invalid suggest_patch args without failing the agent run", async () => {
    const kg = createInMemoryKgService();
    const ctx = testContext({ kg });
    const registry = createPhaseToolRegistry(ctx, {
      phase: "agent-runtime",
      taskId: "T_1",
      reportNodeId: "R_1",
      branchId: "B_1",
      agentRunId: "A_1",
    });

    const result = await registry.invoke({
      toolName: "suggest_patch",
      args: { rationale: "I think structure should change." },
    });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({ ignored: true });
    await expect(kg.listOpenGaps?.("R_1")).resolves.toEqual([
      expect.objectContaining({ gapType: "invalid_structure_patch", impact: "low" }),
    ]);
  });
});

function testContext(opts: { kg?: ReturnType<typeof createInMemoryKgService>; ledger?: ReturnType<typeof createInMemoryTaskLedger>; search?: SearchProvider; fetch?: FetchProvider; llm?: LlmChat } = {}) {
  const runtimeProfile = loadDefaultRuntimeProfile();
  runtimeProfile.traceLevel = "full";
  const ctx = createPhaseContext({ sessionId: "S_test", userInput: "test" }, {
    now: fixedNow,
    runtimeProfile,
    llm: opts.llm ?? testLlm,
    search: opts.search,
    fetch: opts.fetch,
    stack: {
      kg: opts.kg ?? createInMemoryKgService(),
      ledger: opts.ledger ?? createInMemoryTaskLedger(),
      memory: createInMemoryMemoryGraph(),
    },
  });
  ctx.state.episodeId = "EP_tools";
  return ctx;
}

const testLlm: LlmChat = {
  name: "testing-tools-llm",
  async chat(req) {
    return { content: req.json ? "{}" : req.user };
  },
};

function reportNode(nodeId: string): ReportNode {
  return {
    nodeId,
    nodeKind: "hypothesis",
    label: "Test node",
    parentNodeId: null,
    scopeNote: "Test scope",
    status: "planned",
    hypothesis: {
      statement: "Test claim",
      researchBrief: "Test research brief",
      evidenceGuidance: "Test evidence guidance",
    },
    coverage: { supportingCount: 0, contradictingCount: 0, openGapCount: 0 },
    createdAt: new Date(fixedNow()).toISOString(),
    updatedAt: new Date(fixedNow()).toISOString(),
  };
}
