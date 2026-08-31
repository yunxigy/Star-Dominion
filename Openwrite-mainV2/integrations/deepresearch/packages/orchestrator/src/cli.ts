#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import type { HumanReviewResponse } from "@deepresearch/contracts";
import type { LlmChat, SearchProvider } from "@deepresearch/contracts";
import { EchoJsonLlm } from "./infra/mock-llm.js";
import { runResearch } from "./research-api.js";
import { DEFAULT_STREAM_TRANSCRIPT_CHARS, type ResearchStreamMode } from "./stream-renderer.js";
import type { ResearchLlmProviderName, ResearchSearchProviderName } from "./research-api.js";

interface CliArgs {
  prompt: string;
  sessionId: string;
  artifactDir?: string;
  language?: string;
  citationRequired: boolean;
  maxCycles?: number;
  reportMaxTokens?: number;
  reportMaxCalls?: number;
  reportContextTokenLimit?: number;
  evidenceTargetSteps?: number;
  evidenceTargetFetchCalls?: number;
  maxEpisodeCostUsd?: number;
  maxLlmRequests?: number;
  maxEpisodeTokens?: number;
  adaptiveBudget?: boolean;
  humanReview?: boolean;
  evidenceQualityMode?: "advisory" | "balanced" | "strict";
  checkpointDir?: string;
  resumeCheckpointPath?: string;
  reviewResponsePath?: string;
  disableCheckpoints: boolean;
  traceLevel?: "summary" | "full";
  streamMode: StreamMode;
  streamMaxChars: number;
  llm?: "echo" | "bigmodel" | "deepseek" | "openai" | "custom";
  search: "mock" | "bing" | "bocha" | "jina" | "none";
}

type StreamMode = ResearchStreamMode;

const DEFAULT_SEARCH: CliArgs["search"] = "bocha";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const llm = createCliLlm(args.llm);
  const search = createCliSearch(args.search);
  const humanReviewResponse = args.reviewResponsePath
    ? JSON.parse(await readFile(args.reviewResponsePath, "utf8")) as HumanReviewResponse
    : undefined;
  const { summary } = await runResearch({
    prompt: args.prompt,
    sessionId: args.sessionId,
    artifactDir: args.artifactDir,
    language: args.language,
    citationRequired: args.citationRequired,
    maxCycles: args.maxCycles,
    reportMaxTokens: args.reportMaxTokens,
    reportMaxCalls: args.reportMaxCalls,
    reportContextTokenLimit: args.reportContextTokenLimit,
    evidenceTargetSteps: args.evidenceTargetSteps,
    evidenceTargetFetchCalls: args.evidenceTargetFetchCalls,
    maxEpisodeCostUsd: args.maxEpisodeCostUsd,
    maxLlmRequests: args.maxLlmRequests,
    maxEpisodeTokens: args.maxEpisodeTokens,
    adaptiveBudget: args.adaptiveBudget,
    humanReview: args.humanReview,
    evidenceQualityMode: args.evidenceQualityMode,
    checkpointDir: args.checkpointDir,
    resumeCheckpointPath: args.resumeCheckpointPath,
    humanReviewResponse,
    disableCheckpoints: args.disableCheckpoints,
    traceLevel: args.traceLevel,
    streamMode: args.streamMode,
    streamMaxChars: args.streamMaxChars,
    llm,
    llmProvider: llm ? undefined : args.llm as ResearchLlmProviderName,
    search,
    searchProvider: search ? undefined : args.search as ResearchSearchProviderName,
    env: process.env,
    onFrame: (frame) => {
      process.stderr.write(`${renderCliFrame(frame, args.streamMode)}\n`);
    },
  });
  console.log(JSON.stringify(summary, null, 2));
}

function parseArgs(argv: string[]): CliArgs {
  const flags = new Map<string, string | boolean>();
  const promptParts: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i]!;
    if (!item.startsWith("--")) {
      promptParts.push(item);
      continue;
    }
    const eq = item.indexOf("=");
    if (eq > 0) {
      flags.set(item.slice(2, eq), item.slice(eq + 1));
      continue;
    }
    const key = item.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      flags.set(key, next);
      i += 1;
    } else {
      flags.set(key, true);
    }
  }
  if (flags.has("help") || flags.has("h")) {
    printHelp();
    process.exit(0);
  }
  const resumeCheckpointPath = stringFlag(flags, "resume");
  const reviewResponsePath = stringFlag(flags, "review-response");
  if (reviewResponsePath && !resumeCheckpointPath) throw new Error("--review-response requires --resume");
  const prompt = (stringFlag(flags, "prompt") ?? promptParts.join(" ").trim()) || (resumeCheckpointPath ? "__resume__" : "");
  if (!prompt && !resumeCheckpointPath) {
    printHelp();
    throw new Error("Missing research prompt. Pass text args or --prompt \"...\".");
  }
  const llm = stringFlag(flags, "llm")?.toLowerCase();
  if (llm && !["echo", "bigmodel", "deepseek", "openai", "custom"].includes(llm)) throw new Error(`Unsupported --llm: ${llm}`);
  const search = flags.has("no-search") ? "none" : (stringFlag(flags, "search") ?? DEFAULT_SEARCH).toLowerCase();
  if (!["mock", "bing", "bocha", "jina", "none"].includes(search)) throw new Error(`Unsupported --search: ${search}`);
  const traceLevel = (stringFlag(flags, "trace") ?? "summary").toLowerCase();
  if (!["summary", "full"].includes(traceLevel)) throw new Error(`Unsupported --trace: ${traceLevel}`);
  const evidenceQualityMode = stringFlag(flags, "quality")?.toLowerCase();
  if (evidenceQualityMode && !["advisory", "balanced", "strict"].includes(evidenceQualityMode)) throw new Error(`Unsupported --quality: ${evidenceQualityMode}`);
  return {
    prompt,
    sessionId: stringFlag(flags, "session") ?? `S_cli_${Date.now()}`,
    artifactDir: stringFlag(flags, "artifactDir"),
    language: stringFlag(flags, "lang"),
    citationRequired: !flags.has("no-citations"),
    maxCycles: numberFlag(flags, "cycles"),
    reportMaxTokens: numberFlag(flags, "report-max-tokens"),
    reportMaxCalls: numberFlag(flags, "report-max-calls"),
    reportContextTokenLimit: numberFlag(flags, "report-context"),
    evidenceTargetSteps: numberFlag(flags, "agent-steps"),
    evidenceTargetFetchCalls: numberFlag(flags, "agent-fetches"),
    maxEpisodeCostUsd: numberFlag(flags, "max-cost-usd"),
    maxLlmRequests: numberFlag(flags, "max-llm-requests"),
    maxEpisodeTokens: numberFlag(flags, "max-total-tokens"),
    adaptiveBudget: flags.has("no-adaptive-budget") ? false : flags.has("adaptive-budget") ? true : undefined,
    humanReview: flags.has("human-review") ? true : undefined,
    evidenceQualityMode: evidenceQualityMode as CliArgs["evidenceQualityMode"],
    checkpointDir: stringFlag(flags, "checkpoint-dir"),
    resumeCheckpointPath,
    reviewResponsePath,
    disableCheckpoints: flags.has("no-checkpoint") || flags.has("no-checkpoints"),
    traceLevel: traceLevel as CliArgs["traceLevel"],
    streamMode: parseStreamMode(flags, traceLevel as "summary" | "full"),
    streamMaxChars: numberFlag(flags, "stream-max-chars") ?? DEFAULT_STREAM_TRANSCRIPT_CHARS,
    llm: llm as CliArgs["llm"],
    search: search as CliArgs["search"],
  };
}

function createCliLlm(llm: CliArgs["llm"]): LlmChat | undefined {
  if (llm === "echo") return new EchoJsonLlm();
  return undefined;
}

function renderCliFrame(frame: { kind: string; line: string; messages?: Array<{ role: string; content: string; clipped: boolean }>; details?: string[] }, mode: StreamMode): string {
  if (mode !== "transcript") return frame.line;
  if (frame.kind !== "transcript" || !frame.messages?.length) return frame.line;
  const header = frame.line;
  const details = frame.details?.length ? `\n${frame.details.map((line) => `  ${line}`).join("\n")}` : "";
  return `${header}${details}`;
}

function createCliSearch(search: CliArgs["search"]): SearchProvider | undefined {
  if (search === "none") return undefined;
  if (search === "mock") return new CliMockSearchProvider();
  return undefined;
}

function stringFlag(flags: Map<string, string | boolean>, key: string): string | undefined {
  const value = flags.get(key);
  return typeof value === "string" ? value : undefined;
}

function numberFlag(flags: Map<string, string | boolean>, key: string): number | undefined {
  const raw = stringFlag(flags, key);
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${key} must be a number`);
  return value;
}

function parseStreamMode(flags: Map<string, string | boolean>, traceLevel: "summary" | "full"): StreamMode {
  if (flags.has("no-stream")) return "off";
  const raw = flags.get("stream");
  if (raw === undefined) return traceLevel === "full" ? "transcript" : "summary";
  if (raw === true) return "steps";
  if (raw === false) return "off";
  const value = raw.toLowerCase();
  if (value === "codex" || value === "step" || value === "steps" || value === "detailed") return "steps";
  if (value === "full" || value === "debug") return "full";
  if (value === "transcript" || value === "dialog" || value === "dialogue" || value === "conversation" || value === "raw") return "transcript";
  if (value === "summary" || value === "events") return "summary";
  if (value === "off" || value === "none" || value === "false") return "off";
  throw new Error(`Unsupported --stream: ${raw}`);
}

function printHelp(): void {
  console.log(`Usage:
  pnpm research "research prompt"
  pnpm research --prompt "research prompt" --artifactDir artifacts/cli --cycles 1

Options:
  --prompt <text>        Research task. Positional text is also accepted.
  --session <id>         Session id. Defaults to S_cli_<timestamp>.
  --artifactDir <path>   Output directory. Defaults to RuntimeProfile artifactDir.
  --lang <tag>           Output language hint, e.g. en or zh-CN.
  --no-citations         Disable citation-required hint.
  --cycles <n>           Override dispatchEvidence.maxCycles.
  --report-max-tokens <n> Override llm.report.maxTokens for report leaf/section/summary calls.
  --report-max-calls <n> Override phases.report.maxLlmCalls; raise this to cover more leaf nodes.
  --report-context <n>   Override phases.report.contextTokenLimit.
  --agent-steps <n>      Evidence agent target react steps; hard failure limit is 2n.
  --agent-fetches <n>    Evidence agent target fetch_page calls; hard failure limit is 2n.
  --max-cost-usd <n>     Episode-wide estimated provider cost ceiling.
  --max-llm-requests <n> Hard ceiling for LLM requests across the episode.
  --max-total-tokens <n> Episode-wide input + output token ceiling.
  --no-adaptive-budget   Disable plateau-based early stopping. Quality gates still remain mandatory.
  --human-review         Pause with AI-generated decision questions when repair limits are exhausted.
  --quality <mode>       Evidence policy: advisory, balanced, or strict. Default: balanced.
  --resume <path>        Resume from a checkpoint JSON file or a checkpoint directory containing latest.json.
  --review-response <path> Apply a human-review response JSON while resuming. Requires --resume.
  --checkpoint-dir <dir> Write checkpoints to this directory instead of artifacts/<episode>/checkpoints.
  --no-checkpoint        Disable automatic checkpoint snapshots.
  --trace <level>        summary or full. Default: summary. Full also writes trace-full.jsonl.
  --stream <mode>        summary, steps, transcript, full, off. Alias: codex=steps.
                         Defaults to summary, or transcript when --trace full is set.
  --stream-max-chars <n> Max chars per transcript prompt/response block. Default: ${DEFAULT_STREAM_TRANSCRIPT_CHARS}.
  --no-stream            Disable live progress output.
  --llm <name>           bigmodel, deepseek, openai, custom, or echo. Default: AGENT_PROVIDER env, then bigmodel.
  --search <name>        bocha, bing, jina, none, or mock. Default: bocha.
  --no-search            Same as --search none.

Environment:
  AGENT_PROVIDER         Default LLM provider when --llm is omitted. bigmodel, deepseek, openai, custom, or echo.
  BIGMODEL_API_KEY       Required when provider is bigmodel.
  BIGMODEL_MODEL         BigModel model name. Default: glm-4.7-flash.
  BIGMODEL_BASE_URL      BigModel OpenAI-compatible base URL. Default: https://open.bigmodel.cn/api/paas/v4.
  DEEPSEEK_API_KEY       Required when provider is deepseek.
  DEEPSEEK_MODEL         DeepSeek-compatible model name. Default: deepseek-chat.
  DEEPSEEK_BASE_URL      DeepSeek-compatible base URL. Default: https://api.deepseek.com/v1.
  DEEPSEEK_RETRY         Retry count for transient DeepSeek-compatible failures. Default: 1.
  PUBLISH_REVIEW_PROVIDER Optional independent semantic reviewer: bigmodel, deepseek, openai, or custom.
  PUBLISH_REVIEW_MODEL   Optional reviewer-specific model, independent of the writer model setting.
  BOCHA_API_KEY          Required by the default --search bocha.
  BOCHA_COUNT            Bocha search result count requested per query. Default: 10.
  BING_MARKET            Locale for keyless Bing HTML search. Default: zh-CN.
  JINA_API_KEY           Required only when --search jina or FETCH_USE_JINA_READER=1.
  JINA_MAX_NUM           Max Jina search results requested per query before de-duplication. Default: 20; Jina rejects values above 20.
  FETCH_PDF_OCR          Set to 1 to OCR image-only PDFs with pdftoppm and Tesseract.
  FETCH_PDF_OCR_LANGUAGES  Tesseract language set, for example eng+chi_sim. Default: eng.
  FETCH_PDF_OCR_MAX_PAGES  Maximum OCR pages per PDF. Default: 12.
  FETCH_PDF_OCR_TIMEOUT_MS Total OCR timeout per PDF. Default: 120000.
  --llm echo and --search mock are explicit local-only smoke options.
`);
}

class CliMockSearchProvider implements SearchProvider {
  readonly name = "cli-mock-search";

  async search(query: string, topK: number): Promise<Array<{ url: string; title: string; snippet: string }>> {
    return Array.from({ length: Math.max(0, Math.min(topK, 3)) }, (_, index) => ({
      url: `https://example.test/cli/${index + 1}`,
      title: `CLI source ${index + 1}`,
      snippet: `Mock evidence for: ${query}`,
    }));
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
