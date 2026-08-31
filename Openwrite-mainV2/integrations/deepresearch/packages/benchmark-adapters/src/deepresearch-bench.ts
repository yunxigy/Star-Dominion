import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ReportArtifact, TaskSubmission } from "@deepresearch/contracts";
import { createLlmChatFromEnv } from "@deepresearch/embedding-providers";
import { ArxivSearchProvider, BingSearchProvider, BraveSearchProvider, DuckDuckGoSearchProvider, JinaSearchProvider } from "@deepresearch/search-providers";
import { runBenchmarkAdapter } from "./runner.js";
import type { AdapterTaskEnv, AdapterWriteEnv, BenchmarkAdapter, ToolProfile, FrameworkRunResult } from "./types.js";
import { resolveBenchmarkLogger, type BenchmarkLogger } from "./logger.js";

export interface DeepResearchBenchTask {
  id: number;
  topic: string;
  language: "zh" | "en";
  prompt: string;
}

export interface DeepResearchBenchOutput {
  id: number;
  prompt: string;
  article: string;
}

export interface DeepResearchBenchAdapterOptions {
  queryPath: string;
  outputPath: string;
  env?: NodeJS.ProcessEnv;
}

export class DeepResearchBenchAdapter implements BenchmarkAdapter<DeepResearchBenchTask, DeepResearchBenchOutput> {
  readonly name = "deepresearch-bench";
  private readonly queryPath: string;
  private readonly outputPath: string;
  private readonly env: NodeJS.ProcessEnv;

  constructor(opts: DeepResearchBenchAdapterOptions) {
    this.queryPath = opts.queryPath;
    this.outputPath = opts.outputPath;
    this.env = opts.env ?? process.env;
  }

  async loadTasks(): Promise<DeepResearchBenchTask[]> {
    return readJsonl<DeepResearchBenchTask>(this.queryPath);
  }

  taskId(task: DeepResearchBenchTask): number {
    return task.id;
  }

  taskTitle(task: DeepResearchBenchTask): string {
    return task.prompt;
  }

  toTaskSubmission(task: DeepResearchBenchTask, _env: AdapterTaskEnv): TaskSubmission {
    const languageInstruction = task.language === "zh"
      ? "最终报告必须用中文。"
      : "The final report must be written in English.";
    const adaptedPrompt = `${task.prompt}\n\n${languageInstruction}`;
    return {
      sessionId: `S_DRB_${task.id}`,
      userInput: adaptedPrompt,
      uiOptions: {
        outputLanguage: task.language === "zh" ? "zh-CN" : "en",
        citationRequired: true,
      },
    };
  }

  buildToolProfile(task: DeepResearchBenchTask, _env: AdapterTaskEnv): ToolProfile {
    const proxy = this.env.HTTP_PROXY ?? this.env.http_proxy;
    let searchProvider;
    if (this.env.BRAVE_API_KEY) {
      searchProvider = new BraveSearchProvider({
        apiKey: this.env.BRAVE_API_KEY,
        country: task.language === "zh" ? "CN" : "US",
        searchLang: task.language === "zh" ? "zh-hans" : "en",
        timeoutMs: 20000,
      });
    } else if (this.env.BING_API_KEY) {
      searchProvider = new BingSearchProvider({
        market: task.language === "zh" ? "zh-CN" : "en-US",
        timeoutMs: 20000,
      });
    } else if (this.env.JINA_API_KEY) {
      searchProvider = new JinaSearchProvider({
        apiKey: this.env.JINA_API_KEY,
        timeoutMs: 20000,
        proxy,
      });
    } else {
      searchProvider = new DuckDuckGoSearchProvider({
        timeoutMs: 15000,
        kl: task.language === "zh" ? "cn-zh" : "us-en",
        proxy: proxy ? { url: proxy } : undefined,
      });
    }
    return {
      searchProvider,
      arxivProvider: new ArxivSearchProvider({ timeoutMs: 20000, sortBy: "relevance" }),
      jinaApiKey: this.env.JINA_API_KEY,
      policy: {
        defaultTopK: 5,
        preferredSources: ["web", "arxiv"],
      },
    };
  }

  traceInputs(task: DeepResearchBenchTask): Record<string, unknown> {
    return {
      topic: task.topic,
      language: task.language,
      prompt: task.prompt,
    };
  }

  async renderOutput(run: FrameworkRunResult, task: DeepResearchBenchTask): Promise<DeepResearchBenchOutput> {
    return {
      id: task.id,
      prompt: task.prompt,
      article: renderBenchmarkArticle(run.artifact),
    };
  }

  async writeOutputs(outputs: DeepResearchBenchOutput[], env: AdapterWriteEnv): Promise<void> {
    const outputPath = env.outputPath ?? this.outputPath;
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, outputs.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf-8");
  }
}

export interface DeepResearchBenchCliOptions {
  argv: string[];
  env: NodeJS.ProcessEnv;
  repoRoot: string;
  workspaceRoot: string;
  /** Progress output sink; defaults to console. */
  logger?: BenchmarkLogger;
}

export async function runDeepResearchBenchCli(opts: DeepResearchBenchCliOptions): Promise<void> {
  const log = resolveBenchmarkLogger(opts.logger);
  const readArg = (name: string): string | undefined => {
    const idx = opts.argv.indexOf(name);
    return idx >= 0 ? opts.argv[idx + 1] : undefined;
  };
  const ids = (readArg("--ids") ?? readArg("--id") ?? "100")
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x));
  const modelName = readArg("--name") ?? "our-framework";
  const outputPath = readArg("--output")
    ?? join(opts.workspaceRoot, `external/deep_research_bench/data/test_data/raw_data/${modelName}.jsonl`);
  const queryPath = readArg("--queryPath")
    ?? join(opts.workspaceRoot, "external/deep_research_bench/data/prompt_data/query.jsonl");
  const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const traceRoot = readArg("--traceRoot")
    ?? join(opts.repoRoot, `artifacts/benchmark-traces/deepresearch-bench/${modelName}-${runStamp}`);
  const adapter = new DeepResearchBenchAdapter({ queryPath, outputPath, env: opts.env });

  log.info(`Running ${adapter.name}: ids=${ids.join(",")} model=${modelName}`);
  const result = await runBenchmarkAdapter({
    adapter,
    ids,
    modelName,
    outputPath,
    traceRoot,
    createLlm: () => createLlmChatFromEnv({ env: opts.env, providerOverride: readArg("--llm") }),
    maxRounds: Number(readArg("--maxRounds") ?? 2),
    maxParallelBranches: Number(readArg("--maxParallelBranches") ?? 4),
    maxDepth: Number(readArg("--maxDepth") ?? 3),
    maxSubbranchesPerParent: Number(readArg("--maxSubbranchesPerParent") ?? 2),
    maxSubAgentTurns: Number(readArg("--maxSubAgentTurns") ?? opts.env.MAX_SUB_AGENT_TURNS ?? 12),
    subAgentMode: (readArg("--subAgentMode") ?? "react") as "single" | "react",
    subAgentMaxTokens: Number(readArg("--subAgentMaxTokens") ?? 4096),
    subAgentContextMaxChars: Number(readArg("--subAgentContextMaxChars") ?? 32000),
    maxUsd: Number(readArg("--maxUsd") ?? 5),
    synthesizeReport: readArg("--synthesizeReport") !== "false",
    reportMaxTokens: Number(readArg("--reportMaxTokens") ?? 8192),
    reporterReAct: readArg("--reporterReAct") !== "false",
    reporterMaxTurns: Number(readArg("--reporterMaxTurns") ?? 4),
    concurrency: Number(readArg("--parallel") ?? 1),
    rateLimitCooldownMs: Number(readArg("--rateLimitCooldownMs") ?? 60 * 60 * 1000),
    logger: opts.logger,
  });
  log.info(`Wrote raw_data: ${outputPath}`);
  log.info(`Wrote framework traces/debug: ${result.traceRoot}`);
}


function renderBenchmarkArticle(artifact: ReportArtifact): string {
  const references = artifact.evidenceIndex
    .filter((entry) => entry.url)
    .map((entry) => `- ${entry.title}: ${entry.url}`);
  const uniqueReferences = Array.from(new Set(references)).slice(0, 30);
  if (uniqueReferences.length === 0) return artifact.reportMd;
  return `${artifact.reportMd}\n\n## References\n\n${uniqueReferences.join("\n")}`;
}

function readJsonl<T>(path: string): T[] {
  return readFileSync(path, "utf-8").trim().split(/\n/).filter(Boolean).map((line) => JSON.parse(line) as T);
}
