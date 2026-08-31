import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export const DEEPRESEARCH_BENCH_II_DATASET_URL = "https://agentresearchlab.com/benchmarks/deepresearch-bench-ii/tasks_and_rubrics.jsonl";
export const DEEPRESEARCH_BENCH_II_REPOSITORY_URL = "https://github.com/imlrz/DeepResearch-Bench-II.git";
export const DEEPRESEARCH_BENCH_II_LEADERBOARD_URL = "https://agentresearchlab.com/benchmarks/deepresearch-bench-ii/index.html#leaderboard";

export type DeepResearchBenchIIDimension = "info_recall" | "analysis" | "presentation";

export interface DeepResearchBenchIIRubric {
  info_recall: string[];
  analysis: string[];
  presentation: string[];
}

export interface DeepResearchBenchIIBlockedSource {
  title?: string;
  authors?: string[];
  urls?: string[];
}

export interface DeepResearchBenchIIContent {
  task?: string;
  rubric?: Partial<DeepResearchBenchIIRubric>;
  blocked?: DeepResearchBenchIIBlockedSource;
}

export interface DeepResearchBenchIITaskRecord {
  id: string;
  idx: number;
  language: "zh" | "en";
  theme: string;
  description: string;
  prompt: string;
  content: string | DeepResearchBenchIIContent;
  license?: string;
}

export interface DeepResearchBenchIISelection {
  seed: string;
  mode: "explicit" | "random" | "all";
  tasks: DeepResearchBenchIITaskRecord[];
}

export interface DeepResearchBenchIIScoreDimension {
  rubricCount: number;
  passedCount: number;
  blockedCount: number;
  missingCount: number;
  passRate: number;
  passPercent: number;
  blockedRate: number;
}

export interface DeepResearchBenchIITaskScore {
  idx: number;
  model: string;
  dimensions: Record<DeepResearchBenchIIDimension, DeepResearchBenchIIScoreDimension>;
  total: DeepResearchBenchIIScoreDimension;
  usage?: Record<string, unknown>;
}

export interface DeepResearchBenchIIOfficialScore {
  evaluator: "DeepResearch-Bench-II official pipeline";
  leaderboardComparable: false;
  comparabilityNote: string;
  leaderboardUrl: string;
  evaluatedAt: string;
  tasks: DeepResearchBenchIITaskScore[];
  aggregate: {
    dimensions: Record<DeepResearchBenchIIDimension, DeepResearchBenchIIScoreDimension>;
    total: DeepResearchBenchIIScoreDimension;
  };
}

export interface RunOfficialEvaluatorOptions {
  evaluatorRoot: string;
  reportRoot: string;
  tasksPath: string;
  outputPath: string;
  logPath: string;
  env?: NodeJS.ProcessEnv;
  chunkSize?: number;
  maxWorkers?: number;
  maxRetries?: number;
}

export async function ensureDeepResearchBenchIIDataset(path: string): Promise<{ path: string; downloaded: boolean; sha256: string; taskCount: number }> {
  const resolved = resolve(path);
  let downloaded = false;
  if (!existsSync(resolved)) {
    const response = await fetch(DEEPRESEARCH_BENCH_II_DATASET_URL, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`DeepResearch Bench II dataset download failed: HTTP ${response.status}`);
    const content = await response.text();
    parseDeepResearchBenchIIDataset(content);
    mkdirSync(dirname(resolved), { recursive: true });
    atomicWrite(resolved, content.endsWith("\n") ? content : `${content}\n`);
    downloaded = true;
  }
  const content = readFileSync(resolved, "utf8");
  const tasks = parseDeepResearchBenchIIDataset(content);
  return {
    path: resolved,
    downloaded,
    sha256: createHash("sha256").update(content).digest("hex"),
    taskCount: tasks.length,
  };
}

export function parseDeepResearchBenchIIDataset(content: string): DeepResearchBenchIITaskRecord[] {
  const tasks = content.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    try {
      return JSON.parse(line) as DeepResearchBenchIITaskRecord;
    } catch (err) {
      throw new Error(`Invalid DeepResearch Bench II JSONL at line ${index + 1}: ${errorMessage(err)}`);
    }
  });
  if (tasks.length === 0) throw new Error("DeepResearch Bench II dataset is empty");
  const seen = new Set<number>();
  for (const task of tasks) {
    if (!Number.isSafeInteger(task.idx) || task.idx < 1) throw new Error(`Invalid DeepResearch Bench II task idx: ${String(task.idx)}`);
    if (seen.has(task.idx)) throw new Error(`Duplicate DeepResearch Bench II task idx: ${task.idx}`);
    seen.add(task.idx);
    if (!task.prompt || (task.language !== "zh" && task.language !== "en")) throw new Error(`Invalid DeepResearch Bench II task ${task.idx}`);
  }
  return tasks.sort((a, b) => a.idx - b.idx);
}

export function selectDeepResearchBenchIITasks(
  tasks: DeepResearchBenchIITaskRecord[],
  opts: { ids?: Array<string | number>; all?: boolean; sampleSize?: number; seed?: string } = {},
): DeepResearchBenchIISelection {
  const seed = opts.seed?.trim() || randomBytes(8).toString("hex");
  if (opts.all && opts.ids?.length) throw new Error("--all cannot be combined with --ids/--idx");
  if (opts.ids?.length) {
    const byIdx = new Map(tasks.map((task) => [String(task.idx), task]));
    const selected = opts.ids.map((id) => byIdx.get(String(id))).filter((task): task is DeepResearchBenchIITaskRecord => Boolean(task));
    const missing = opts.ids.map(String).filter((id) => !byIdx.has(id));
    if (missing.length) throw new Error(`DeepResearch Bench II task IDs not found: ${missing.join(", ")}`);
    return { seed, mode: "explicit", tasks: uniqueTasks(selected) };
  }
  if (opts.all) return { seed, mode: "all", tasks: [...tasks] };
  const sampleSize = integerInRange(opts.sampleSize ?? 1, 1, tasks.length, "sampleSize");
  const shuffled = [...tasks];
  const random = mulberry32(seedNumber(seed));
  for (let index = shuffled.length - 1; index > 0; index--) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target]!, shuffled[index]!];
  }
  return { seed, mode: "random", tasks: shuffled.slice(0, sampleSize).sort((a, b) => a.idx - b.idx) };
}

export function parseDeepResearchBenchIIContent(task: DeepResearchBenchIITaskRecord): DeepResearchBenchIIContent {
  if (task.content && typeof task.content === "object") return task.content;
  if (typeof task.content !== "string" || !task.content.trim()) return {};
  try {
    const parsed = JSON.parse(task.content) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as DeepResearchBenchIIContent : {};
  } catch {
    return {};
  }
}

export function taskRubricCounts(task: DeepResearchBenchIITaskRecord): Record<DeepResearchBenchIIDimension, number> {
  const rubric = parseDeepResearchBenchIIContent(task).rubric;
  return {
    info_recall: stringArray(rubric?.info_recall).length,
    analysis: stringArray(rubric?.analysis).length,
    presentation: stringArray(rubric?.presentation).length,
  };
}

export function runDeepResearchBenchIIOfficialEvaluator(opts: RunOfficialEvaluatorOptions): { revision?: string; command: string } {
  const evaluatorRoot = ensureOfficialEvaluator(opts.evaluatorRoot);
  mkdirSync(dirname(resolve(opts.outputPath)), { recursive: true });
  mkdirSync(dirname(resolve(opts.logPath)), { recursive: true });
  const pythonArgs = [
    join(evaluatorRoot, "run_evaluation.py"),
    "--pdf_dir", resolve(opts.reportRoot),
    "--out_jsonl", resolve(opts.outputPath),
    "--tasks_jsonl", resolve(opts.tasksPath),
    "--chunk_size", String(opts.chunkSize ?? 50),
    "--max_workers", String(opts.maxWorkers ?? 1),
    "--max_retries", String(opts.maxRetries ?? 5),
    "--log_file", resolve(opts.logPath),
  ];
  const uvAvailable = commandAvailable("uv", ["--version"]);
  const command = uvAvailable ? "uv" : commandAvailable("python3", ["--version"]) ? "python3" : "python";
  const args = uvAvailable
    ? ["run", "--project", evaluatorRoot, "python", ...pythonArgs]
    : pythonArgs;
  const result = spawnSync(command, args, {
    cwd: evaluatorRoot,
    stdio: "inherit",
    env: { ...process.env, ...opts.env },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Official DeepResearch Bench II evaluator failed with exit code ${result.status}`);
  if (!existsSync(opts.outputPath) || !readFileSync(opts.outputPath, "utf8").trim()) {
    throw new Error("Official DeepResearch Bench II evaluator produced no scores. Configure GEMINI_API_URL, GEMINI_API_TOKEN, and GEMINI_MODEL.");
  }
  return {
    revision: gitRevision(evaluatorRoot),
    command: `${command} ${args.filter((arg) => !/token/i.test(arg)).join(" ")}`,
  };
}

export function aggregateDeepResearchBenchIIOfficialScores(
  resultPath: string,
  tasks: DeepResearchBenchIITaskRecord[],
): DeepResearchBenchIIOfficialScore {
  const lines = readFileSync(resultPath, "utf8").split(/\r?\n/).filter((line) => line.trim());
  const records = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  const scores = tasks.map((task) => scoreTask(task, records));
  return {
    evaluator: "DeepResearch-Bench-II official pipeline",
    leaderboardComparable: false,
    comparabilityNote: "The official evaluator code was used, but a random subset and locally configured judge are not directly comparable to the full 132-task leaderboard run.",
    leaderboardUrl: DEEPRESEARCH_BENCH_II_LEADERBOARD_URL,
    evaluatedAt: new Date().toISOString(),
    tasks: scores,
    aggregate: aggregateTaskScores(scores),
  };
}

export function appendDeepResearchBenchIIHistory(path: string, record: unknown): void {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  appendFileSync(resolve(path), `${JSON.stringify(record)}\n`, "utf8");
}

export function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  atomicWrite(resolve(path), `${JSON.stringify(value, null, 2)}\n`);
}

export function evaluatorCredentialsConfigured(env: NodeJS.ProcessEnv, evaluatorRoot?: string): boolean {
  if (env.GEMINI_API_URL && env.GEMINI_API_TOKEN && env.GEMINI_MODEL) return true;
  if (!evaluatorRoot) return false;
  const envPath = join(evaluatorRoot, ".env");
  if (!existsSync(envPath)) return false;
  const keys = new Set(readFileSync(envPath, "utf8").split(/\r?\n/).map((line) => line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/)?.[1]).filter(Boolean));
  return keys.has("GEMINI_API_URL") && keys.has("GEMINI_API_TOKEN") && keys.has("GEMINI_MODEL");
}

function ensureOfficialEvaluator(root: string): string {
  const resolved = resolve(root);
  if (existsSync(join(resolved, "run_evaluation.py"))) return resolved;
  if (existsSync(resolved) && readdirSync(resolved).length > 0) {
    throw new Error(`Evaluator directory exists but is not DeepResearch-Bench-II: ${resolved}`);
  }
  mkdirSync(dirname(resolved), { recursive: true });
  const result = spawnSync("git", ["clone", "--depth", "1", DEEPRESEARCH_BENCH_II_REPOSITORY_URL, resolved], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0 || !existsSync(join(resolved, "run_evaluation.py"))) {
    throw new Error(`Unable to bootstrap official DeepResearch Bench II evaluator at ${resolved}`);
  }
  return resolved;
}

function scoreTask(task: DeepResearchBenchIITaskRecord, records: Array<Record<string, unknown>>): DeepResearchBenchIITaskScore {
  const record = records.find((item) => Number(item.idx) === task.idx);
  if (!record) throw new Error(`Official evaluator result is missing task idx=${task.idx}`);
  const result = object(record.result);
  if (typeof result.error === "string") throw new Error(`Official evaluator failed for task idx=${task.idx}: ${result.error}`);
  const rubric = parseDeepResearchBenchIIContent(task).rubric;
  const resultScores = object(result.scores);
  const dimensions = {} as Record<DeepResearchBenchIIDimension, DeepResearchBenchIIScoreDimension>;
  for (const dimension of dimensionsList()) {
    const expected = stringArray(rubric?.[dimension]);
    const observed = object(resultScores[dimension]);
    const values = expected.map((item) => {
      const score = object(observed[item]).score;
      if (score !== 1 && score !== 0 && score !== -1) throw new Error(`Invalid or missing official score for idx=${task.idx}, dimension=${dimension}: ${item}`);
      return score;
    });
    dimensions[dimension] = summarizeScores(values);
  }
  const allValues = dimensionsList().flatMap((dimension) => stringArray(rubric?.[dimension]).map((item) => Number(object(object(resultScores[dimension])[item]).score)));
  return {
    idx: task.idx,
    model: typeof record.model === "string" ? record.model : "unknown",
    dimensions,
    total: summarizeScores(allValues),
    usage: object(result.usage_summary),
  };
}

function aggregateTaskScores(scores: DeepResearchBenchIITaskScore[]): DeepResearchBenchIIOfficialScore["aggregate"] {
  const dimensions = {} as Record<DeepResearchBenchIIDimension, DeepResearchBenchIIScoreDimension>;
  for (const dimension of dimensionsList()) dimensions[dimension] = sumSummaries(scores.map((score) => score.dimensions[dimension]));
  return { dimensions, total: sumSummaries(scores.map((score) => score.total)) };
}

function sumSummaries(items: DeepResearchBenchIIScoreDimension[]): DeepResearchBenchIIScoreDimension {
  const rubricCount = items.reduce((sum, item) => sum + item.rubricCount, 0);
  const passedCount = items.reduce((sum, item) => sum + item.passedCount, 0);
  const blockedCount = items.reduce((sum, item) => sum + item.blockedCount, 0);
  return summary(rubricCount, passedCount, blockedCount);
}

function summarizeScores(values: number[]): DeepResearchBenchIIScoreDimension {
  return summary(values.length, values.filter((value) => value === 1).length, values.filter((value) => value === -1).length);
}

function summary(rubricCount: number, passedCount: number, blockedCount: number): DeepResearchBenchIIScoreDimension {
  const passRate = rubricCount > 0 ? passedCount / rubricCount : 0;
  return {
    rubricCount,
    passedCount,
    blockedCount,
    missingCount: Math.max(0, rubricCount - passedCount - blockedCount),
    passRate,
    passPercent: passRate * 100,
    blockedRate: rubricCount > 0 ? blockedCount / rubricCount : 0,
  };
}

function dimensionsList(): DeepResearchBenchIIDimension[] {
  return ["info_recall", "analysis", "presentation"];
}

function uniqueTasks(tasks: DeepResearchBenchIITaskRecord[]): DeepResearchBenchIITaskRecord[] {
  const seen = new Set<number>();
  return tasks.filter((task) => seen.has(task.idx) ? false : (seen.add(task.idx), true));
}

function seedNumber(seed: string): number {
  return createHash("sha256").update(seed).digest().readUInt32LE(0);
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function integerInRange(value: number, min: number, max: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${label} must be an integer between ${min} and ${max}`);
  return value;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function atomicWrite(path: string, content: string): void {
  const temporaryPath = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, path);
}

function commandAvailable(command: string, args: string[]): boolean {
  const result = spawnSync(command, args, { stdio: "ignore" });
  return !result.error && result.status === 0;
}

function gitRevision(root: string): string | undefined {
  const result = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() || undefined : undefined;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
