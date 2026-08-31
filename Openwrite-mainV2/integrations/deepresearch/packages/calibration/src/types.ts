// Calibration 工具的内部类型。

export type CalibrationSource =
  | "agent_run"
  | "cycle_reflection"
  | "completion_gate"
  | "publish_gate";

export type CalibrationDecision =
  | "run"
  | "skip"
  | "continue"
  | "complete"
  | "repair"
  | "failed";

/** 单条决策记录：一次 agent 运行或一次 v5 gate/reflection 决策。 */
export interface CalibrationRecord {
  recordId: string;
  episodeId: string;
  /** 决策来源：v5 运行事件或 gate/reflection。 */
  source: CalibrationSource;
  /** agentRunId / gate id / reflection id。 */
  decisionId: string;
  /** 预期增益 [0, 1] */
  expectedGain: number;
  /** v5 决策结果。 */
  decision: CalibrationDecision;
  /** 实际增益 [0, 1]（事后回填） */
  actualGain?: number;
  /** 决策时间 */
  decidedAt: string;
  /** 实际收益观察时间 */
  realizedAt?: string;
  /** 关联的 branchId / reportNodeId，方便聚合 */
  branchId?: string;
  reportNodeId?: string;
  /** LLM / 硬门控判定的附加元数据 */
  meta?: Record<string, unknown>;
}

/** 校准分析结果 */
export interface CalibrationAnalysis {
  totalRecords: number;
  recordsWithActual: number;
  /** 平均绝对误差 */
  mae: number;
  /** 均方误差 */
  rmse: number;
  /** 方向准确率：expected 高/低 vs actual 高/低 */
  directionAccuracy: number;
  /** 0/1 outcome（actual >= 0.5 = 1）的 Brier score */
  brierScore: number;
  /** Expected Calibration Error（按 bin） */
  ece: number;
  /** 决策分布 */
  decisionDistribution: Record<string, number>;
  /** 按 source 分组 */
  bySource: Record<string, SourceStats>;
  /** 给论文用的散点数据 (expected, actual) */
  scatter: Array<{ expected: number; actual: number; source: string; decision: string }>;
}

export interface SourceStats {
  count: number;
  mae?: number;
  directionAccuracy?: number;
  ece?: number;
}

/** 报告输出格式 */
export type ReportFormat = "json" | "md";
