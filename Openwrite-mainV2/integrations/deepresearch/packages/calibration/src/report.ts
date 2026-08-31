// 把 CalibrationAnalysis 写成 json 或 markdown。

import type { CalibrationAnalysis } from "./types.js";

export function writeReport(analysis: CalibrationAnalysis, format: "json" | "md"): string {
  if (format === "json") {
    return JSON.stringify(analysis, null, 2);
  }
  return renderMarkdown(analysis);
}

function renderMarkdown(a: CalibrationAnalysis): string {
  const lines: string[] = [];
  lines.push("# Calibration Analysis Report");
  lines.push("");
  lines.push(`- Total records: ${a.totalRecords}`);
  lines.push(`- Records with actual gain: ${a.recordsWithActual}`);
  lines.push("");
  lines.push("## Aggregate metrics");
  lines.push("");
  lines.push(`- **MAE**: ${a.mae.toFixed(4)}`);
  lines.push(`- **RMSE**: ${a.rmse.toFixed(4)}`);
  lines.push(`- **Direction accuracy**: ${(a.directionAccuracy * 100).toFixed(1)}%`);
  lines.push(`- **Brier score**: ${a.brierScore.toFixed(4)}`);
  lines.push(`- **ECE**: ${a.ece.toFixed(4)}`);
  lines.push("");
  lines.push("## Decision distribution");
  lines.push("");
  for (const [k, v] of Object.entries(a.decisionDistribution)) {
    lines.push(`- ${k}: ${v}`);
  }
  lines.push("");
  lines.push("## By source");
  lines.push("");
  lines.push("| source | count | MAE | direction acc | ECE |");
  lines.push("|---|---|---|---|---|");
  for (const [src, stat] of Object.entries(a.bySource)) {
    const mae = stat.mae !== undefined ? stat.mae.toFixed(4) : "-";
    const dir = stat.directionAccuracy !== undefined ? (stat.directionAccuracy * 100).toFixed(1) + "%" : "-";
    const ece = stat.ece !== undefined ? stat.ece.toFixed(4) : "-";
    lines.push(`| ${src} | ${stat.count} | ${mae} | ${dir} | ${ece} |`);
  }
  lines.push("");
  lines.push("## Scatter (expected vs actual)");
  lines.push("");
  lines.push("| expected | actual | source | decision |");
  lines.push("|---|---|---|---|");
  for (const p of a.scatter) {
    lines.push(`| ${p.expected.toFixed(3)} | ${p.actual.toFixed(3)} | ${p.source} | ${p.decision} |`);
  }
  return lines.join("\n");
}
