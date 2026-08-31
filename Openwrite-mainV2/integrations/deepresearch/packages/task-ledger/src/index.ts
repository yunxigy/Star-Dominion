// @deepresearch/task-ledger
// 公共出口：工厂函数 + 关键类型重导出。
// 内部类（TaskLedgerImpl、InMemoryTaskLedger、SqliteTaskLedger）不直接导出。
// 其它包通过 @deepresearch/contracts 的 TaskLedger 接口使用本包能力。

import type { TaskLedger } from "@deepresearch/contracts";
import { InMemoryTaskLedger, type InMemoryTaskLedgerOptions } from "./impl/in-memory.js";
import { SqliteTaskLedger, type SqliteTaskLedgerOptions } from "./impl/sqlite.js";

export const MODULE_NAME = "task-ledger";

/** 工厂：构造 InMemory 实现（产品模式默认 forceReopen=false）。 */
export function createInMemoryTaskLedger(opts: InMemoryTaskLedgerOptions = {}): TaskLedger {
  return new InMemoryTaskLedger(opts);
}

export function createSqliteTaskLedger(opts: SqliteTaskLedgerOptions = {}): TaskLedger {
  return new SqliteTaskLedger(opts);
}

/** 重新导出 contracts 里的任务账本类型，方便调用方一次性 import。 */
export type {
  TaskItem,
  TaskLedger,
  TaskStatus,
} from "@deepresearch/contracts";
