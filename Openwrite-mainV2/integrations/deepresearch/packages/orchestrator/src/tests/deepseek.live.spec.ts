import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, describe, expect, it } from "vitest";
import { DeepSeekChat } from "@deepresearch/embedding-providers";
import { BochaSearchProvider, FetchPageProvider, JinaSearchProvider } from "@deepresearch/tool-providers";
import type { SearchProvider, ToolRegistry } from "@deepresearch/contracts";
import { runAgentRuntime } from "../agent-runtime.js";
import { loadDefaultRuntimeProfile } from "../infra/config.js";
import { parseJsonObject } from "../infra/json.js";
import { runResearch } from "../research-api.js";
import {
  ARCHITECT_SYSTEM_PROMPT,
  CYCLE_REFLECTION_SYSTEM_PROMPT,
  EVIDENCE_SYSTEM_PROMPT,
  PUBLISH_GATE_SYSTEM_PROMPT,
  REPORT_WRITER_SYSTEM_PROMPT,
  RUBRIC_SYSTEM_PROMPT,
  STRUCTURE_REVIEW_SYSTEM_PROMPT,
} from "../prompts.js";

const deepseekApiKey = process.env.DEEPSEEK_API_KEY;
const bochaApiKey = process.env.BOCHA_API_KEY;
const jinaApiKey = process.env.JINA_API_KEY;
const runDeepSeek = deepseekApiKey && process.env.DEEPSEEK_LIVE_SMOKE === "1" ? describe : describe.skip;
const runBocha = bochaApiKey && process.env.BOCHA_LIVE_SMOKE === "1" ? describe : describe.skip;
const runJina = jinaApiKey && process.env.JINA_LIVE_SMOKE === "1" ? describe : describe.skip;
const runE2e = deepseekApiKey && process.env.DEEPRESEARCH_LIVE_E2E === "1" ? describe : describe.skip;

const artifactDirs: string[] = [];

afterAll(async () => {
  for (const dir of artifactDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

runDeepSeek("live DeepSeek block tests", () => {
  const llm = new DeepSeekChat({
    apiKey: deepseekApiKey!,
    model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
    timeoutMs: Number(process.env.DEEPSEEK_LIVE_TIMEOUT_MS ?? 90000),
  });

  it("Block 4 MainPlanner schemas: rubric and architecture", async () => {
    const rubric = parseJsonObject<{ rubricText: string; outputHints: { titleHint: string }; researchQuestionHints: string[] }>((await llm.chat({
      system: RUBRIC_SYSTEM_PROMPT,
      user: `Build GlobalRubric JSON for this task.

User input:
Write a concise evidence-grounded research outline about AI search agents.

UI options:
{"outputLanguage":"en-US","citationRequired":true}

Output schema:
{"rubricText":string,"outputHints":{"titleHint":string,"language":string,"citationRequired":boolean,"format":"markdown"},"researchQuestionHints":string[]}`,
      json: true,
      maxTokens: 900,
      temperature: 0,
    })).content);
    expect(rubric?.rubricText).toBeTruthy();
    expect(rubric?.outputHints.titleHint).toBeTruthy();

    const architectResponse = await llm.chat({
      system: ARCHITECT_SYSTEM_PROMPT,
      user: `User task:
AI search agents.

Global rubric:
${rubric!.rubricText}

Initial source map:
- K1 | secondary | Example source | Short source summary.

Output schema:
{"aspects":[{"label":string,"scopeNote":string,"hypotheses":[{"statement":string,"researchBrief":string,"evidenceGuidance":string}],"tasks":[{"title":string,"objective":string,"acceptanceCriteria":string[]}]}]}`,
      json: true,
      maxTokens: 2400,
      temperature: 0,
    });
    const architect = parseJsonObject<{ aspects: Array<{ label: string; hypotheses: unknown[]; tasks: unknown[] }> }>(architectResponse.content);
    expect(architect, `Architect response was not valid JSON: ${architectResponse.content.slice(0, 500)}`).not.toBeNull();
    expect(architect!.aspects.length).toBeGreaterThan(0);
  }, 180000);

  it("Block 3 EvidenceAgent ReAct runtime calls a tool and finishes", async () => {
    let toolCalls = 0;
    const tools: ToolRegistry = {
      listTools: () => [{
        toolName: "web_search",
        description: "Search the web for evidence.",
        inputSchema: { query: "string" },
      }],
      invoke: async (req) => {
        toolCalls += 1;
        return {
          toolName: req.toolName,
          ok: true,
          output: {
            results: [{
              title: "Evaluation benchmark",
              url: "https://example.test/evaluation",
              snippet: "The benchmark measures citation grounding and retrieval quality.",
            }],
          },
        };
      },
    };

    const runtime = await runAgentRuntime({
      agent: {
        agentId: "live-evidence",
        agentRunId: "A_live_evidence",
        role: "subagent",
        title: "Live EvidenceAgent",
        objective: "Find evidence about AI search agent evaluation.",
        episodeId: "EP_live",
        taskId: "T_live",
        reportNodeId: "R_live",
      },
      llm,
      system: `${EVIDENCE_SYSTEM_PROMPT}
You are testing the production AgentRuntime with the real DeepSeek API.
You must call web_search exactly once, inspect its observation, then finish with the required JSON.`,
      context: {
        currentTask: { objective: "Find evidence about AI search agent evaluation." },
        currentReportNode: { label: "Evaluation", hypothesis: { statement: "AI search agents need grounded evaluation." } },
      },
      tools,
      budget: { maxReactSteps: 3, maxToolCalls: 1, maxSearchCalls: 1 },
      outputSchema: {
        relation: "supports|contradicts|qualifies|background",
        claimText: "string",
        confidence: "number",
        nodeStatus: "supported|partially_supported|contradicted|insufficient_evidence|downplayed",
        reasoningSummary: "string",
      },
      model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
      maxTokens: 1200,
      temperature: 0,
      timeoutMs: Number(process.env.DEEPSEEK_LIVE_TIMEOUT_MS ?? 90000),
    });

    expect(runtime.status).toBe("completed");
    expect(toolCalls).toBe(1);
    expect(runtime.finish).toBeTruthy();
  }, 180000);

  it("Block 5 Reflection and StructureReview schemas", async () => {
    const reflection = parseJsonObject<{ continueDispatch: boolean; taskUpdates: unknown[]; newTasks: unknown[]; skipReasons: unknown[] }>((await llm.chat({
      system: CYCLE_REFLECTION_SYSTEM_PROMPT,
      user: `Reflect on this dispatch cycle.

Current queued tasks:
[]

AgentRunResult list:
[{"branchOutcome":"done_here","openGaps":[]}]

Output schema:
{"continueDispatch":boolean,"taskUpdates":[{"taskId":string,"newStatus":"completed"|"queued"|"blocked"|"failed"|"cancelled","reason":string}],"newTasks":[{"parentTaskId":string|null,"reportNodeId":string,"title":string,"objective":string,"priority":number,"acceptanceCriteria":string[]}],"skipReasons":[{"gap":string,"reason":string}]}`,
      json: true,
      maxTokens: 700,
      temperature: 0,
    })).content);
    expect(typeof reflection?.continueDispatch).toBe("boolean");

    const structure = parseJsonObject<{ suggestions: unknown[] }>((await llm.chat({
      system: STRUCTURE_REVIEW_SYSTEM_PROMPT,
      user: `Review this report tree and propose only necessary v5 StructurePatch suggestions.

Report nodes:
[{"nodeId":"R_root","nodeKind":"root","label":"AI search agents","parentNodeId":null},{"nodeId":"R_aspect_1","nodeKind":"aspect","label":"Evaluation","parentNodeId":"R_root"}]

Evidence links:
[]

Open gaps:
[]

Worker suggestions:
[]

Allowed patch ops: add_aspect_node, add_hypothesis_node, rename_report_node, move_report_node, merge_report_nodes, move_evidence_link, retag_knowledge_node, discard_knowledge_node, downplay_hypothesis.
Output schema:
{"suggestions":[{"patch":object,"rationale":string,"confidence":number}]}`,
      json: true,
      maxTokens: 900,
      temperature: 0,
    })).content);
    expect(Array.isArray(structure?.suggestions)).toBe(true);
  }, 180000);

  it("Block 6 Writer and Block 8 PublishReview schemas", async () => {
    const report = (await llm.chat({
      system: REPORT_WRITER_SYSTEM_PROMPT,
      user: `Write a very short final report from this ReportBundle.

Constraints:
{"language":"en-US","citationRequired":true,"rubricText":"Use citations."}

Report tree and evidence:
{"root":{"label":"AI search agents"},"tree":[{"node":{"label":"Evaluation"},"evidence":[{"citationId":"C1","relation":"supports","claimText":"Benchmarks measure grounding.","source":{"title":"Evaluation benchmark","summary":"Measures citation grounding."}}],"openGaps":[]}]}

Available citations:
- [C1] Evaluation benchmark https://example.test

Return Markdown only. Use citations exactly as [C1].`,
      maxTokens: 900,
      temperature: 0,
    })).content;
    expect(report).toContain("[C1]");

    const publish = parseJsonObject<{ decision: string; issues: unknown[] }>((await llm.chat({
      system: PUBLISH_GATE_SYSTEM_PROMPT,
      user: `Semantic publish review for this final draft.

Check rubric coverage, overclaim, and hidden gaps.
Return JSON only:
{"decision":"pass"|"needs_repair","reasoningSummary":string,"issues":[{"code":string,"severity":"warning"|"error","message":string,"reportNodeId":string|null,"suggestedRepair":string}]}

Rubric:
{"rubricText":"Use citations and avoid overclaiming."}

Report tree and grounding summary:
{"nodes":[{"nodeId":"R1","label":"Evaluation","evidence":[{"claimText":"Benchmarks measure grounding.","confidence":0.8}],"openGaps":[]}]}

Draft markdown:
${report}`,
      json: true,
      maxTokens: 900,
      temperature: 0,
    })).content);
    expect(["pass", "needs_repair"]).toContain(publish?.decision);
    expect(Array.isArray(publish?.issues)).toBe(true);
  }, 180000);
});

runBocha("live Bocha search block tests", () => {
  it("Block 2 Tool providers: real Bocha search", async () => {
    const search = new BochaSearchProvider({
      apiKey: bochaApiKey!,
      timeoutMs: Number(process.env.BOCHA_LIVE_TIMEOUT_MS ?? process.env.BOCHA_TIMEOUT_MS ?? 60000),
      retry: 1,
      count: 3,
    });
    const hits = await search.search("AI search agent evaluation citation grounding", 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.url).toBeTruthy();
  }, 180000);
});

runJina("live Jina fallback tool block tests", () => {
  it("Optional fallback: real Jina search and reader", async () => {
    const search = new JinaSearchProvider({
      apiKey: jinaApiKey!,
      timeoutMs: Number(process.env.JINA_LIVE_TIMEOUT_MS ?? process.env.JINA_TIMEOUT_MS ?? 90000),
      retry: 1,
    });
    const hits = await search.search("AI search agent evaluation citation grounding", 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.url).toBeTruthy();

    const fetch = new FetchPageProvider({
      useJinaReader: true,
      apiKey: jinaApiKey!,
      timeoutMs: Number(process.env.JINA_LIVE_TIMEOUT_MS ?? process.env.JINA_READER_TIMEOUT_MS ?? 90000),
      maxChars: 6000,
      retry: 1,
    });
    const page = await fetch.fetchPage(hits[0]!.url, { maxChars: 2000 });
    expect(page?.content.length ?? 0).toBeGreaterThan(100);
  }, 180000);
});

runE2e("live DeepResearch real API end-to-end smoke", () => {
  it("publishes one real DeepSeek checkpointed episode from fetched authoritative sources", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "dr-live-e2e-"));
    if (process.env.DEEPRESEARCH_LIVE_KEEP_ARTIFACTS !== "1") artifactDirs.push(artifactDir);
    const sourceMap: SearchProvider = bochaApiKey
      ? new BochaSearchProvider({
          apiKey: bochaApiKey,
          timeoutMs: Number(process.env.BOCHA_LIVE_TIMEOUT_MS ?? process.env.BOCHA_TIMEOUT_MS ?? 60000),
          retry: 1,
          count: 4,
        })
      : {
          name: "live-authoritative-source-map",
          async search(_query, topK) {
            return [
              {
                title: "NIST AI Risk Management Framework",
                url: "https://www.nist.gov/itl/ai-risk-management-framework",
                snippet: "NIST's official AI RMF organizes risk management around Govern, Map, Measure, and Manage functions.",
              },
              {
                title: "DeepSeek-V3 Technical Report",
                url: "https://arxiv.org/abs/2412.19437",
                snippet: "The primary DeepSeek-V3 technical report documents model architecture, training, and benchmark evaluations.",
              },
              {
                title: "Holistic Evaluation of Language Models (HELM)",
                url: "https://arxiv.org/abs/2211.09110",
                snippet: "HELM argues for transparent, multi-metric model evaluation beyond aggregate capability scores, including robustness, fairness, bias, toxicity, and efficiency.",
              },
            ].slice(0, topK);
          },
        };
    const fetch = new FetchPageProvider({
      timeoutMs: 60000,
      maxChars: 30000,
      retry: 1,
    });
    const runtimeProfile = loadDefaultRuntimeProfile();
    if (!runtimeProfile.phases.publishGate) throw new Error("publishGate runtime profile is required");
    runtimeProfile.phases.publishGate.maxCycles = 1;
    const output = await runResearch({
      prompt: "用简短报告研究 AI 系统评估为什么需要同时考虑风险管理与能力基准，并比较 NIST AI RMF 与 DeepSeek-V3 技术报告能提供的互补视角。",
      artifactDir,
      language: "zh-CN",
      maxCycles: 1,
      reportMaxCalls: 8,
      reportMaxTokens: 4096,
      maxEpisodeCostUsd: 2,
      maxLlmRequests: 80,
      maxEpisodeTokens: 650000,
      evidenceTargetSteps: 8,
      evidenceTargetFetchCalls: 4,
      debugMaxAspects: 1,
      debugMaxBranchesPerAspect: 1,
      debugMaxInitialAgentNodes: 1,
      traceLevel: "full",
      streamMode: "steps",
      env: process.env,
      llmProvider: "deepseek",
      search: sourceMap,
      fetch,
      runtimeProfile,
    });
    const report = await readFile(output.result.reportArtifactPath, "utf8");
    const diagnostic = JSON.stringify({
      artifactDir,
      status: output.result.status,
      reportArtifactPath: output.result.reportArtifactPath,
      metrics: output.result.metrics,
      reportPreview: report.slice(0, 1200),
    }, null, 2);
    expect(output.result.status, diagnostic).toBe("succeeded");
    expect(output.summary.filesExist.fullTrace).toBe(true);
    expect(report).toMatch(/\[C\d+\]/);
    expect(report).not.toContain("需要你的决定");
  }, 600000);
});
