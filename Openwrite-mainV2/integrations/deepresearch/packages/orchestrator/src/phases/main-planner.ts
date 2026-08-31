import type { GlobalRubric, ReportNode, TaskItem } from "@deepresearch/contracts";
import { architectTreePhase } from "./architect-tree.js";
import { initRootPhase } from "./init-root.js";
import { parsePhase } from "./parse.js";
import { rubricPhase } from "./rubric.js";
import { scoutPhase } from "./scout.js";
import type { PhaseContext } from "../types.js";

export interface MainPlannerResult {
  rubric: GlobalRubric;
  root: ReportNode;
  reportNodes: ReportNode[];
  tasks: TaskItem[];
  scoutKnowledgeNodeIds: string[];
  scoutEvidenceLinkIds: string[];
}

export async function mainPlannerPhase(ctx: PhaseContext): Promise<MainPlannerResult> {
  await parsePhase(ctx);
  await ctx.emit({
    eventType: "main_planner_started",
    taskId: "T_root",
    reportNodeId: "R_root",
    branchId: "B_main",
    agentRunId: "A_main_planner",
    payload: {
      objective: ctx.state.submission.userInput,
      uiOptions: ctx.state.submission.uiOptions ?? {},
    },
  });
  const rubric = await rubricPhase(ctx);
  const root = await initRootPhase(ctx);
  const scout = await scoutPhase(ctx);
  const tree = await architectTreePhase(ctx);
  await ctx.emit({
    eventType: "main_planner_finished",
    taskId: "T_root",
    reportNodeId: "R_root",
    branchId: "B_main",
    agentRunId: "A_main_planner",
    payload: {
      rubricId: rubric.rubricId,
      titleHint: rubric.outputHints.titleHint,
      scoutKnowledgeNodeIds: scout.knowledgeNodeIds,
      scoutEvidenceLinkIds: scout.evidenceLinkIds,
      reportNodeIds: tree.reportNodes.map((node) => node.nodeId),
      taskIds: tree.tasks.map((task) => task.taskId),
    },
  });
  return {
    rubric,
    root,
    reportNodes: tree.reportNodes,
    tasks: tree.tasks,
    scoutKnowledgeNodeIds: scout.knowledgeNodeIds,
    scoutEvidenceLinkIds: scout.evidenceLinkIds,
  };
}
