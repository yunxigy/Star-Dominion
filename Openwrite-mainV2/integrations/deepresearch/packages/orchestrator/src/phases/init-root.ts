import type { ReportNode } from "@deepresearch/contracts";
import { isoNow } from "../infra/ids.js";
import { traceWrite } from "../trace.js";
import type { PhaseContext } from "../types.js";

export async function initRootPhase(ctx: PhaseContext): Promise<ReportNode> {
  const rubric = requireRubric(ctx);
  const now = isoNow(ctx.now);
  const root: ReportNode = {
    nodeId: "R_root",
    nodeKind: "root",
    label: rubric.outputHints.titleHint ?? ctx.state.submission.userInput.slice(0, 60),
    parentNodeId: null,
    scopeNote: `${rubric.outputHints.language ?? "zh-CN"} deep research report; must follow GlobalRubric ${rubric.rubricId}`,
    status: "planned",
    requirementIds: rubric.requirements?.map((requirement) => requirement.requirementId),
    coverage: { supportingCount: 0, contradictingCount: 0, openGapCount: 0 },
    createdAt: now,
    updatedAt: now,
  };
  await ctx.stack.kg.upsertReportNode(root);
  await traceWrite(ctx, "kg", "upsertReportNode", { node: root }, { taskId: "T_root", reportNodeId: root.nodeId, branchId: "B_root" });
  await ctx.stack.ledger.updateStatus("T_root", "running");
  await traceWrite(ctx, "ledger", "updateStatus", { taskId: "T_root", status: "running" }, { taskId: "T_root", reportNodeId: root.nodeId, branchId: "B_root" });
  ctx.state.rootNode = root;
  await ctx.emit({ eventType: "root_created", reportNodeId: root.nodeId, taskId: "T_root", branchId: "B_root" });
  return root;
}

function requireRubric(ctx: PhaseContext) {
  if (!ctx.state.globalRubric) throw new Error("rubricPhase must run before initRootPhase");
  return ctx.state.globalRubric;
}
