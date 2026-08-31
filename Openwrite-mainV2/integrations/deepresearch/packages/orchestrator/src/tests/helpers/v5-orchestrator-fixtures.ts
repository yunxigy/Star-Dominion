import type { AgentRunResult, ReportBundle, ReportNode, ResearchRequirement, TaskItem, TaskSubmission } from "@deepresearch/contracts";

export const fixedNow = () => Date.UTC(2026, 6, 1, 0, 0, 0, 0);

export function submission(): TaskSubmission {
  return {
    sessionId: "S_test",
    userInput: "Research whether property tax can replace land finance.",
    uiOptions: { outputLanguage: "zh-CN", citationRequired: true },
  };
}

export function node(overrides: Partial<ReportNode>): ReportNode {
  const now = new Date(fixedNow()).toISOString();
  const out: ReportNode = {
    nodeId: "R_node",
    nodeKind: "aspect",
    label: "Node",
    parentNodeId: "R_root",
    scopeNote: "Scope",
    status: "planned",
    coverage: { supportingCount: 0, contradictingCount: 0, openGapCount: 0 },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  if (out.nodeKind === "hypothesis" && !out.hypothesis) {
    out.hypothesis = {
      statement: `${out.label} statement`,
      researchBrief: `${out.label} brief`,
      evidenceGuidance: `${out.label} evidence`,
    };
  }
  return out;
}

export function task(overrides: Partial<TaskItem>): TaskItem {
  const now = new Date(fixedNow()).toISOString();
  return {
    taskId: "T_task",
    parentTaskId: "T_root",
    reportNodeId: "R_hyp_1",
    title: "Evidence task",
    objective: "Find evidence.",
    status: "queued",
    priority: 50,
    branchId: "B_task",
    acceptanceCriteria: ["Find evidence."],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function completeStudyRowMarkdown(index: number, evidenceLinkId: string): string {
  return `**Authors:** Author ${index}\n**Country:** Country ${index}\n**Sample Size:** ${100 + index}\n**Research Design:** Cross-sectional comparative study\n**Outcome Variable:** Academic performance\n**Finding on Effectiveness:** Effective [E:${evidenceLinkId}]`;
}

export function requirement(requirementId: string, description: string, kind: ResearchRequirement["kind"]): ResearchRequirement {
  return {
    requirementId,
    description,
    kind,
    priority: "must",
    evidenceRequired: true,
    evidenceNeeds: [`Evidence for ${description}`],
    successCriteria: [`The report covers ${description}`],
  };
}

export function agentResultWithGap(taskId: string, reportNodeId: string, description = "Needs direct primary-source confirmation."): AgentRunResult {
  return {
    agentRunId: `A_${taskId}`,
    taskId,
    reportNodeId,
    branchId: "B_task",
    branchOutcome: "done_here",
    knowledgeNodeIds: [],
    evidenceLinkIds: [],
    nodeUpdates: [],
    openGaps: [{
      gapType: "missing_primary_source",
      description,
      suggestedQuery: "primary source",
    }],
    structurePatchSuggestions: [],
    turnSummary: {
      actionSummary: "Gap remains.",
      searchSummary: "Search incomplete.",
      reasoningSummary: "Needs another pass.",
      citedKnowledgeNodeIds: [],
      citedEvidenceLinkIds: [],
    },
  };
}

export function agentResultWithPatch(patch: AgentRunResult["structurePatchSuggestions"][number]["patch"]): AgentRunResult {
  return {
    agentRunId: `A_${patch.op}`,
    taskId: "T_patch",
    reportNodeId: "R_aspect_1",
    branchId: "B_patch",
    branchOutcome: "done_here",
    knowledgeNodeIds: [],
    evidenceLinkIds: [],
    nodeUpdates: [],
    openGaps: [],
    structurePatchSuggestions: [{ patch, rationale: `Apply ${patch.op}`, confidence: 0.9 }],
    turnSummary: {
      actionSummary: "",
      searchSummary: "",
      reasoningSummary: "",
      citedKnowledgeNodeIds: [],
      citedEvidenceLinkIds: [],
    },
  };
}

export function scriptedEvidenceReact(user: string, opts: {
  query: string;
  title: string;
  url: string;
  content: string;
  claimText: string;
  reasoningSummary: string;
  reportletMarkdown?: string;
  completedReportlets?: Array<{
    partId: string;
    title?: string;
    markdown: string;
    citedEvidenceLinkIds?: string[];
    citedKnowledgeNodeIds?: string[];
    reasoningSummary?: string;
  }>;
}): { content: string } {
  const taskIds = Array.from(user.matchAll(/"taskId"\s*:\s*"([^"]+)"/g)).map((match) => match[1]!).filter((taskId) => taskId !== "T_root");
  const taskId = taskIds.at(-1);
  if (user.includes("Previous steps:\n[]")) {
    return { content: JSON.stringify({
      thoughtSummary: "Search for evidence.",
      action: "tool",
      toolName: "web_search",
      args: { query: opts.query, topK: 1 },
    }) };
  }
  if (!user.includes("\"step\": 2")) {
    return { content: JSON.stringify({
      thoughtSummary: "Save the best source.",
      action: "tool",
      toolName: "save_knowledge_node",
      args: {
        title: opts.title,
        url: opts.url,
        content: opts.content,
        relation: "supports",
        claimText: opts.claimText,
        confidence: 0.8,
        qualityScore: 0.8,
      },
    }) };
  }
  return { content: JSON.stringify({
    thoughtSummary: "Finish evidence run.",
    action: "finish",
    finish: {
      relation: "supports",
      claimText: opts.claimText,
      confidence: 0.8,
      nodeStatus: "supported",
      reasoningSummary: opts.reasoningSummary,
      reportletMarkdown: opts.reportletMarkdown ?? (taskId ? `#### Evidence finding\n\n${opts.claimText} [E:E_${taskId}_1]` : undefined),
      completedReportlets: opts.completedReportlets,
      openGaps: [],
      structurePatchSuggestions: [],
    },
  }) };
}

export function bundle(root: ReportNode): ReportBundle {
  return {
    episodeId: "EP_publish_repair",
    root,
    tree: [{ node: root, children: [], evidence: [], reportlets: [], openGaps: [] }],
    globalEvidenceIndex: [],
    constraints: {
      language: "en",
      citationRequired: true,
      rubricId: "RB_publish",
      rubricText: "Rubric",
    },
  };
}
