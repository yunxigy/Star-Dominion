// @deepresearch/calibration
// 公共出口：工具 + 类型。
//
// 用途：
//   - 收集 orchestrator episode 跑完后的决策记录 (expectedGain, decision, actualGain)
//   - 算 MAE / RMSE / Direction Acc / Brier / ECE
//   - 输出 json / md 报告，给论文 / 监控用
//
// 用法：
//   import { collectFromOrchestrator, analyzeCalibration, writeReport } from "@deepresearch/calibration";
//   const records = collectFromOrchestrator(orch, { episodeId });
//   const analysis = analyzeCalibration(records);
//   const md = writeReport(analysis, "md");

export { analyzeCalibration } from "./analyzer.js";
export { writeReport } from "./report.js";
export { collectFromOrchestrator, makeRecord } from "./collect.js";
export { actualGainFromAgentResult, computeActualGain, countLinkedEvidence } from "./actual-gain.js";

export type {
  CalibrationRecord,
  CalibrationAnalysis,
  CalibrationDecision,
  CalibrationSource,
  SourceStats,
  ReportFormat,
} from "./types.js";
