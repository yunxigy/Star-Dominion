import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runResearch } from "./index.js";

const topics = [
  {
    id: "ai-risk-frameworks",
    prompt: "比较 NIST AI RMF 1.0 与 NIST AI RMF Generative AI Profile 的正式适用范围、核心功能和生成式 AI 特有风险。只使用 NIST 官方材料，给出带本地引用的简明中文结论。",
  },
  {
    id: "eu-battery-recycling",
    prompt: "依据 EUR-Lex 上 Regulation (EU) 2023/1542 的正式文本，说明废旧便携式电池收集目标与锂材料回收目标的年份和数值。区分收集率与材料回收率；锂目标只采用 Annex XII Part C 的 recovery of materials，不要混入 Part B 的整电池 recycling efficiency。输出带本地引用的简明中文报告。",
  },
  {
    id: "casgevy-regulation",
    prompt: "比较 FDA 与 EMA 关于 Casgevy（exagamglogene autotemcel）的正式监管材料：适应症、关键批准时间和 CRISPR/Cas9 作用方式。明确美国与欧盟表述差异，输出带本地引用的简明中文报告。",
  },
] as const;

async function main(): Promise<void> {
  const root = resolve(process.env.LIVE_STRESS_ARTIFACT_DIR ?? `artifacts/live-search-stress-${new Date().toISOString().slice(0, 10)}`);
  await mkdir(root, { recursive: true });
  const selectedTopics = process.env.LIVE_STRESS_TOPIC
    ? topics.filter((topic) => topic.id === process.env.LIVE_STRESS_TOPIC)
    : topics;
  if (!selectedTopics.length) throw new Error(`Unknown LIVE_STRESS_TOPIC: ${process.env.LIVE_STRESS_TOPIC}`);
  const results: Array<Record<string, unknown>> = [];
  for (const topic of selectedTopics) {
    const startedAt = Date.now();
    console.error(`[live:stress] starting ${topic.id}`);
    try {
      const output = await runResearch({
        prompt: topic.prompt,
        sessionId: `S_live_stress_${topic.id}`,
        artifactDir: root,
        language: "zh-CN",
        llmProvider: "deepseek",
        searchProvider: "bing",
        maxCycles: 1,
        reportMaxCalls: 8,
        reportMaxTokens: 4096,
        evidenceTargetSteps: 10,
        evidenceTargetFetchCalls: 4,
        maxEpisodeCostUsd: 1.5,
        maxLlmRequests: 80,
        maxEpisodeTokens: 650_000,
        debugMaxAspects: 1,
        debugMaxBranchesPerAspect: 3,
        debugMaxInitialAgentNodes: 3,
        debugMaxAgentNodeParts: 1,
        traceLevel: "full",
        streamMode: "off",
        env: { ...process.env, BING_MARKET: process.env.BING_MARKET ?? "en-US" },
      });
      const metrics = output.result.metrics;
      const failures: string[] = [];
      if (output.result.status !== "succeeded") failures.push(`status=${output.result.status}`);
      if ((metrics.coveredMustRequirementCount ?? 0) < (metrics.mustRequirementCount ?? 0)) {
        failures.push(`coveredMustRequirements=${metrics.coveredMustRequirementCount ?? 0}/${metrics.mustRequirementCount ?? 0}`);
      }
      if ((metrics.requirementCoverage ?? 0) < 1) failures.push(`requirementCoverage=${metrics.requirementCoverage ?? 0}`);
      if ((metrics.citationUtilization ?? 0) < 0.8) failures.push(`citationUtilization=${metrics.citationUtilization ?? 0}`);
      if ((metrics.evidenceQualityScore ?? 0) < 70) failures.push(`evidenceQualityScore=${metrics.evidenceQualityScore ?? 0}`);
      if ((metrics.budgetBreachCount ?? 0) !== 0) failures.push(`budgetBreachCount=${metrics.budgetBreachCount}`);
      if (topic.id === "eu-battery-recycling" && output.result.status === "succeeded" && output.result.reportArtifactPath) {
        const report = await readFile(output.result.reportArtifactPath, "utf8");
        failures.push(...validateEuBatteryReport(report));
      }
      results.push({
        id: topic.id,
        passed: failures.length === 0,
        failures,
        durationMs: Date.now() - startedAt,
        episodeId: output.result.episodeId,
        reportArtifactPath: output.result.reportArtifactPath,
        metrics,
      });
      console.error(`[live:stress] finished ${topic.id}: ${failures.length ? `FAIL ${failures.join("; ")}` : "PASS"}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        id: topic.id,
        passed: false,
        failures: [message],
        durationMs: Date.now() - startedAt,
      });
      console.error(`[live:stress] finished ${topic.id}: ERROR ${message}`);
    }
  }
  const summary = {
    version: 1,
    generatedAt: new Date().toISOString(),
    searchProvider: "bing",
    writerProvider: "deepseek",
    reviewerProvider: process.env.PUBLISH_REVIEW_PROVIDER || "primary-writer-fallback",
    topicCount: selectedTopics.length,
    passedCount: results.filter((item) => item.passed === true).length,
    failedCount: results.filter((item) => item.passed !== true).length,
    results,
  };
  const summaryPath = resolve(root, "live-stress-summary.json");
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...summary, summaryPath }, null, 2));
  if (summary.failedCount > 0) process.exitCode = 1;
}

function validateEuBatteryReport(report: string): string[] {
  const failures: string[] = [];
  for (const [year, percent] of [[2023, 45], [2027, 63], [2030, 73], [2027, 50], [2031, 80]] as const) {
    const pair = new RegExp(`(?:${year}[^\\n]{0,80}${percent}\\s*%|${percent}\\s*%[^\\n]{0,80}${year})`, "u");
    if (!pair.test(report)) failures.push(`missingExpectedTarget=${year}:${percent}%`);
    const citedLine = report.split(/\r?\n/u).some((line) => pair.test(line) && /\[C\d+\]/u.test(line));
    if (!citedLine) failures.push(`missingLocalCitation=${year}:${percent}%`);
  }
  if (/(?:锂|lithium)[^。\n]{0,100}(?:65|70)\s*%|(?:65|70)\s*%[^。\n]{0,100}(?:锂|lithium)/iu.test(report)) {
    failures.push("containsWholeBatteryEfficiencyAsLithiumTarget");
  }
  return failures;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
