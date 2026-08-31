#!/usr/bin/env node
import { runQualityRegressionManifest } from "../quality-regression.js";

const args = process.argv.slice(2);
const manifest = flag(args, "manifest") ?? "configs/regression/quality-regression.json";
const output = flag(args, "output") ?? "artifacts/quality-regression/results.json";
const result = runQualityRegressionManifest(manifest, { outputPath: output });
for (const item of result.cases) {
  console.log(`${item.passed ? "PASS" : "FAIL"} ${item.id}${item.failures.length ? `: ${item.failures.join("; ")}` : ""}`);
}
console.log(`Quality regression: ${result.passedCount}/${result.caseCount} passed. Results: ${output}`);
if (!result.passed) process.exitCode = 1;

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}
