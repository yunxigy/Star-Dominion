// Calibration 分析：把 CalibrationRecord[] 量化成 CalibrationAnalysis。
//
// 指标定义：
//   - MAE = mean(|expected - actual|)
//   - RMSE = sqrt(mean((expected - actual)^2))
//   - 方向准确率：expected >= 0.5 == actual >= 0.5 的比例
//   - Brier score: 0/1 outcome (actual >= 0.5) 的概率预测误差 mean((p - y)^2)
//   - ECE: 把 expected 分 5 个 bin，每个 bin |mean(expected) - mean(actual)| * bin 占比
//
// 输入：CalibrationRecord[]（actualGain 可选；没 actual 的不进 MAE/RMSE/ECE，但进 decisionDistribution）

import type { CalibrationRecord, CalibrationAnalysis, SourceStats } from "./types.js";

const BIN_COUNT = 5;
const SUCCESS_THRESHOLD = 0.5;

export function analyzeCalibration(records: CalibrationRecord[]): CalibrationAnalysis {
  const withActual = records.filter((r): r is CalibrationRecord & { actualGain: number } =>
    typeof r.actualGain === "number",
  );

  // MAE / RMSE
  let maeSum = 0;
  let sqSum = 0;
  let dirHits = 0;
  let brierSum = 0;
  for (const r of withActual) {
    const err = r.expectedGain - r.actualGain;
    maeSum += Math.abs(err);
    sqSum += err * err;
    const eHigh = r.expectedGain >= SUCCESS_THRESHOLD;
    const aHigh = r.actualGain >= SUCCESS_THRESHOLD;
    if (eHigh === aHigh) dirHits++;
    const y = aHigh ? 1 : 0;
    brierSum += (r.expectedGain - y) ** 2;
  }
  const n = withActual.length;
  const mae = n > 0 ? maeSum / n : 0;
  const rmse = n > 0 ? Math.sqrt(sqSum / n) : 0;
  const directionAccuracy = n > 0 ? dirHits / n : 0;
  const brierScore = n > 0 ? brierSum / n : 0;
  const ece = computeEce(withActual.map((r) => ({ p: r.expectedGain, y: r.actualGain })));

  // decision distribution
  const decisionDistribution: Record<string, number> = {};
  for (const r of records) {
    decisionDistribution[r.decision] = (decisionDistribution[r.decision] ?? 0) + 1;
  }

  // by source
  const bySource: Record<string, SourceStats> = {};
  const grouped = new Map<string, CalibrationRecord[]>();
  for (const r of records) {
    if (!grouped.has(r.source)) grouped.set(r.source, []);
    grouped.get(r.source)!.push(r);
  }
  for (const [src, rs] of grouped) {
    const rsWithActual = rs.filter((r): r is CalibrationRecord & { actualGain: number } =>
      typeof r.actualGain === "number",
    );
    const stat: SourceStats = { count: rs.length };
    if (rsWithActual.length > 0) {
      const subMae = rsWithActual.reduce((a, r) => a + Math.abs(r.expectedGain - r.actualGain), 0) / rsWithActual.length;
      const subDir = rsWithActual.filter((r) =>
        (r.expectedGain >= SUCCESS_THRESHOLD) === (r.actualGain >= SUCCESS_THRESHOLD),
      ).length / rsWithActual.length;
      const subEce = computeEce(rsWithActual.map((r) => ({ p: r.expectedGain, y: r.actualGain })));
      stat.mae = subMae;
      stat.directionAccuracy = subDir;
      stat.ece = subEce;
    }
    bySource[src] = stat;
  }

  const scatter = withActual.map((r) => ({
    expected: r.expectedGain,
    actual: r.actualGain,
    source: r.source,
    decision: r.decision,
  }));

  return {
    totalRecords: records.length,
    recordsWithActual: n,
    mae,
    rmse,
    directionAccuracy,
    brierScore,
    ece,
    decisionDistribution,
    bySource,
    scatter,
  };
}

function computeEce(pairs: Array<{ p: number; y: number }>): number {
  if (pairs.length === 0) return 0;
  const bins: Array<{ sum: number; count: number; meanP: number }> = [];
  for (let i = 0; i < BIN_COUNT; i++) {
    bins.push({ sum: 0, count: 0, meanP: 0 });
  }
  for (const { p, y } of pairs) {
    const idx = Math.min(BIN_COUNT - 1, Math.floor(p * BIN_COUNT));
    bins[idx]!.sum += y;
    bins[idx]!.count += 1;
    bins[idx]!.meanP += p;
  }
  let ece = 0;
  for (const b of bins) {
    if (b.count === 0) continue;
    const meanY = b.sum / b.count;
    const meanP = b.meanP / b.count;
    ece += (b.count / pairs.length) * Math.abs(meanP - meanY);
  }
  return ece;
}
