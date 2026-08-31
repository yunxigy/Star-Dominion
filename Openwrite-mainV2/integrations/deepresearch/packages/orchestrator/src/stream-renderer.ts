import type { AgentRole, MemoryEvent, VisualResearchEvent, VisualResearchEventKind, VisualResearchLane, VisualResearchSeverity } from "@deepresearch/contracts";

export type ResearchStreamMode = "off" | "summary" | "steps" | "full" | "transcript";

export type ResearchStreamFrameKind =
  | "summary"
  | "thinking"
  | "transcript"
  | "search"
  | "evidence"
  | "artifact"
  | "debug";

export interface ResearchStreamTranscriptMessage {
  role: "system" | "user" | "assistant";
  content: string;
  clipped: boolean;
}

export interface ResearchStreamFrame {
  kind: ResearchStreamFrameKind;
  line: string;
  event: MemoryEvent;
  visual?: VisualResearchEvent;
  actor?: string;
  phase?: string;
  taskId?: string;
  reportNodeId?: string;
  agentRunId?: string;
  messages?: ResearchStreamTranscriptMessage[];
  collapsible?: boolean;
  details?: string[];
}

export interface ResearchStreamRendererOptions {
  mode: Exclude<ResearchStreamMode, "off">;
  maxTranscriptChars?: number;
}

export const DEFAULT_STREAM_TRANSCRIPT_CHARS = 80000;

export class ResearchStreamRenderer {
  private readonly taskTitles = new Map<string, string>();
  private readonly nodeLabels = new Map<string, string>();
  private readonly maxTranscriptChars: number;

  constructor(private readonly opts: ResearchStreamRendererOptions) {
    this.maxTranscriptChars = opts.maxTranscriptChars ?? DEFAULT_STREAM_TRANSCRIPT_CHARS;
  }

  render(event: MemoryEvent): ResearchStreamFrame | undefined {
    const line = this.opts.mode === "summary" ? this.summaryLine(event) : this.detailedLine(event);
    if (!line) return undefined;
    const runtimeVisual = visualFromRuntimeEvent(event);
    return {
      kind: this.frameKind(event),
      line,
      event,
      visual: runtimeVisual ?? toVisualResearchEvent(event, line),
      actor: this.actor(event),
      phase: str(event.payload?.phase),
      taskId: event.taskId,
      reportNodeId: event.reportNodeId,
      agentRunId: event.agentRunId,
      messages: this.transcriptMessages(event),
      collapsible: isLlmEvent(event),
      details: this.details(event),
    };
  }

  private detailedLine(event: MemoryEvent): string | undefined {
    this.captureKnownNames(event);
    if (event.eventType.startsWith("full.")) return this.fullTraceLine(event);
    return this.summaryLine(event);
  }

  private summaryLine(event: MemoryEvent): string | undefined {
    if (event.eventType.startsWith("full.")) return undefined;
    const time = clock(event.timestamp);
    const payload = event.payload ?? {};
    switch (event.eventType) {
      case "episode_started":
        return `[${time}] 研究任务已开始`;
      case "main_planner_started":
        return `[${time}] 主规划开始：${oneLine(str(payload.objective), 140)}`;
      case "main_planner_finished":
        return `[${time}] 主规划完成：来源 ${len(payload.scoutKnowledgeNodeIds)} 个，报告节点 ${len(payload.reportNodeIds)} 个，任务 ${len(payload.taskIds)} 个`;
      case "rubric_created":
        return `[${time}] 研究标准已生成：${oneLine(str(payload.titleHint) || str(payload.rubricId) || "已创建", 120)}`;
      case "root_created":
        return `[${time}] 根任务已创建`;
      case "scout_started":
        return `[${time}] 初步探索开始`;
      case "scout_finished":
        return `[${time}] 初步探索完成：${oneLine(str(payload.actionSummary) || str(payload.searchSummary) || "完成", 140)}`;
      case "architect_tree_created":
        return `[${time}] 报告树已创建：${payload.aspectCount ?? "?"} 个方面，${payload.hypothesisCount ?? "?"} 个假设`;
      case "dispatch_cycle_started":
        return `[${time}] 分发轮次 ${str(payload.cycleId) || payload.cycle || "?"} 开始：待处理 ${len(payload.queuedTaskIds)} 个任务`;
      case "dispatch_cycle_finished":
        return `[${time}] 分发轮次 ${str(payload.cycleId) || payload.cycle || "?"} 完成：运行 ${payload.agentRuns ?? "?"} 个 agent，新增 ${len(payload.newlyQueuedTaskIds)} 个任务，剩余 ${len(payload.queuedTaskIds)} 个，原因=${str(payload.stopReason) || "unknown"}`;
      case "provider_budget_exhausted":
        return `[${time}] Provider 预算已耗尽：${str(payload.provider)}.${str(payload.limit)}，上限=${payload.allowed ?? "?"}，当前=${payload.observed ?? "?"}`;
      case "adaptive_budget_stopped":
        return `[${time}] 自适应预算停止低收益探索：cycle=${payload.cycle ?? "?"}，取消任务=${len(payload.cancelledTaskIds)}`;
      case "adaptive_budget_plateau_deferred":
        return `[${time}] 检测到低收益平台，但质量/修复门禁仍要求继续`;
      case "research_budget_audited":
        return `[${time}] 预算审计：请求=${payload.requests ?? 0}，tokens=${payload.totalTokens ?? 0}，估算成本=$${payload.estimatedCostUsd ?? 0}`;
      case "evidence_agent_started":
        return `[${time}] 子代理 ${event.taskId ?? "unknown"} 开始${this.taskLabel(event.taskId)}`;
      case "evidence_agent_finished":
        return `[${time}] 子代理 ${event.taskId ?? "unknown"} 完成：${oneLine(str(payload.actionSummary) || "完成", 140)}`;
      case "evidence_agent_failed":
        return `[${time}] 子代理 ${event.taskId ?? "unknown"} 失败：${oneLine(str(payload.actionSummary) || str(payload.reason) || "失败", 160)}`;
      case "reflection_scheduler_started":
        return `[${time}] 全局反思开始：agent=${payload.agentRuns ?? "?"}，缺口=${payload.gaps ?? "?"}，队列=${len(payload.queuedBeforeTaskIds)}`;
      case "cycle_reflection":
        return `[${time}] 全局反思：已完成=${payload.completed ?? "?"}，缺口=${payload.gaps ?? "?"}，更新=${len(payload.taskUpdates)}，新增=${len(payload.newTasks)}，修复任务=${len(payload.createdTaskIds)}`;
      case "reflection_scheduler_finished":
        return `[${time}] 全局反思完成：继续=${payload.continueDispatch ?? "?"}，修复任务=${len(payload.createdTaskIds)}`;
      case "agent_runtime_visual":
        return runtimeVisualLine(event, time);
      case "cycle_reflection_parse_repair":
        return `[${time}] 反思输出已修复：${oneLine(str(payload.reason), 120)}`;
      case "gap_skipped":
        return `[${time}] 反思跳过部分缺口：已确认=${payload.acknowledged ?? "?"}，原因=${len(payload.skipReasons)}`;
      case "structure_review_started":
        return `[${time}] 结构审查开始：节点=${payload.reportNodes ?? "?"}，证据=${payload.evidenceLinks ?? "?"}，缺口=${payload.openGaps ?? "?"}`;
      case "structure_review_agent_suggested":
        return `[${time}] 结构审查建议：规则=${payload.workerSuggestions ?? 0}，AI=${payload.aiSuggestions ?? 0}`;
      case "structure_critic_decision": {
        const critique = object(payload.critique);
        return `[${time}] 结构批评：风险=${zhRisk(str(critique.risk))}，动作=${zhAction(str(critique.suggestedAction))}，补丁=${critique.patchIndex ?? "?"}`;
      }
      case "patch_guard_decision": {
        const decision = object(payload.decision);
        return `[${time}] 补丁守卫：${zhDecision(str(decision.decision))}，补丁=${decision.patchIndex ?? "?"} ${oneLine(str(decision.rationale), 100)}`;
      }
      case "structure_review":
        return `[${time}] 结构审查：应用=${payload.applied ?? 0}，拒绝=${payload.rejected ?? 0}`;
      case "structure_review_suggestions_filtered":
        return `[${time}] 结构建议已过滤：来源=${str(payload.source)}，保留=${payload.kept ?? 0}，丢弃=${payload.dropped ?? 0}`;
      case "completion_gate":
        return `[${time}] 完成度检查：${zhDecision(str(payload.decision))}${str(payload.reason) ? `（${oneLine(str(payload.reason), 100)}）` : ""}`;
      case "completion_gate_auto_skipped":
        return `[${time}] 自动模式已跳过未解决问题：问题=${payload.issueCount ?? 0}，降级分支=${len(payload.qualifiedNodeIds)}，省略分支=${len(payload.downplayedNodeIds)}`;
      case "report_draft_created":
        return `[${time}] 报告草稿已生成：${str(payload.draftPath)}`;
      case "writer_gap_repair":
        return `[${time}] 写作阶段请求修复：${str(payload.repairTaskId)} ${oneLine(str(payload.reason), 120)}`;
      case "publish_gate_repair":
        return `[${time}] 发布检查要求修复：问题=${len(payload.issues)}，修复任务=${len(payload.repairTaskIds)}`;
      case "publish_gate_auto_skipped":
        return `[${time}] 自动模式带警告发布：跳过 ${len(payload.issues)} 个发布问题`;
      case "human_review_requested": {
        const review = object(payload.humanReview);
        return `[${time}] 需要你的决定：${oneLine(str(review.summary), 100)}（${len(review.questions)} 个问题）`;
      }
      case "episode_succeeded":
        return `[${time}] 研究任务成功完成：${str(payload.reportPath)}`;
      case "episode_needs_more_work":
        return `[${time}] 研究任务还需要补充：${oneLine(str(payload.reason) || "", 120)}`;
      default: {
        const detail = event.taskId ? ` task=${event.taskId}` : event.reportNodeId ? ` node=${event.reportNodeId}` : "";
        return `[${time}] ${event.eventType}${detail}`;
      }
    }
  }

  private fullTraceLine(event: MemoryEvent): string | undefined {
    const payload = event.payload ?? {};
    const time = clock(event.timestamp);
    const indent = event.taskId && event.taskId !== "T_root" ? "  " : "";
    switch (event.eventType) {
      case "full.llm.request":
        return this.llmRequestLine(event);
      case "full.llm.response":
        return this.llmResponseLine(event);
      case "full.llm.error":
        return `${indent}[${time}] ${this.actor(event)} 思考失败：${errorMessage(payload.error)}`;
      case "full.search.request":
        return `${indent}[${time}] ${this.actor(event)} 正在搜索：“${oneLine(str(payload.query), 140)}”`;
      case "full.search.response":
        return `${indent}[${time}] ${this.actor(event)} 搜索完成：${len(payload.results)} 条结果，用时 ${payload.durationMs ?? "?"}ms${topTitles(payload.results)}`;
      case "full.search.error":
        return `${indent}[${time}] ${this.actor(event)} 搜索失败：${errorMessage(payload.error)}`;
      case "full.search.skipped":
        return `${indent}[${time}] ${this.actor(event)} 跳过搜索：${oneLine(str(payload.reason), 100)}`;
      case "full.fetch.request":
        return `${indent}[${time}] ${this.actor(event)} 正在打开网页：${sourceLabel(payload, 140)}`;
      case "full.fetch.response":
        return `${indent}[${time}] ${this.actor(event)} 网页读取完成：${oneLine(str(payload.title) || str(payload.url), 120)}（${payload.contentChars ?? "?"} 字符，用时 ${payload.durationMs ?? "?"}ms）`;
      case "full.fetch.rejected":
        return `${indent}[${time}] ${this.actor(event)} 跳过一个来源：${sourceLabel(payload, 100)}（${zhReason(str(payload.reason) || "low_quality_source")}）`;
      case "full.fetch.error":
        return `${indent}[${time}] ${this.actor(event)} 网页暂时无法读取：${sourceLabel(payload, 100)}。已跳过该来源并继续。`;
      case "full.fetch.skipped":
        return `${indent}[${time}] ${this.actor(event)} 跳过网页读取：${zhReason(str(payload.reason)) || "无需读取全文"}`;
      case "full.kg.upsertKnowledgeNode": {
        const knowledge = object(payload.knowledge);
        const summary = str(knowledge.summary);
        return `${indent}[${time}] ${this.actor(event)} 保存来源 ${str(knowledge.nodeId)}：${oneLine(str(knowledge.title), 100)}${summary ? ` — ${oneLine(summary, 160)}` : ""}`;
      }
      case "full.kg.reuseKnowledgeNode": {
        const knowledge = object(payload.knowledge);
        const summary = str(knowledge.summary);
        const nodeId = str(knowledge.nodeId) || str(payload.knowledgeNodeId);
        return `${indent}[${time}] ${this.actor(event)} 复用来源 ${nodeId}：${oneLine(str(knowledge.title), 100)}${summary ? ` — ${oneLine(summary, 160)}` : ""}`;
      }
      case "full.kg.upsertEvidenceLink": {
        const link = object(payload.link);
        return `${indent}[${time}] ${this.actor(event)} 关联证据 ${str(link.linkId)}：${zhRelation(str(link.relation))}，置信度=${num(link.confidence)}`;
      }
      case "full.kg.upsertReportlet": {
        const reportlet = object(payload.reportlet);
        const citedEvidenceCount = Array.isArray(reportlet.citedEvidenceLinkIds) ? reportlet.citedEvidenceLinkIds.length : 0;
        const citedKnowledgeCount = Array.isArray(reportlet.citedKnowledgeNodeIds) ? reportlet.citedKnowledgeNodeIds.length : 0;
        return `${indent}[${time}] ${this.actor(event)} 保存报告片段 ${str(reportlet.reportletId)}：${oneLine(str(reportlet.title) || str(object(reportlet.plannedReportlet).expectedHeading), 100)}（证据 ${citedEvidenceCount}，资料 ${citedKnowledgeCount}）`;
      }
      case "full.kg.updateEvidenceLink": {
        const link = object(payload.link);
        return `${indent}[${time}] ${this.actor(event)} 更新证据关联 ${str(link.linkId)}：${str(link.reportNodeId)} → ${str(link.knowledgeNodeId)}`;
      }
      case "full.kg.upsertReportNode":
      case "full.kg.updateReportNode": {
        const node = object(payload.node);
        return `${indent}[${time}] ${this.actor(event)} 更新报告节点 ${str(node.nodeId)}：${oneLine(str(node.label) || str(object(node.hypothesis).statement), 100)}`;
      }
      case "full.kg.addOpenGap": {
        const gap = object(payload.gap);
        return `${indent}[${time}] ${this.actor(event)} 记录缺口：${oneLine(str(gap.description), 140)}`;
      }
      case "full.agent.failed":
        return `${indent}[${time}] ${this.actor(event)} 失败：${errorMessage(payload.error)}`;
      case "full.kg.closeOpenGaps":
        return `${indent}[${time}] ${this.actor(event)} 关闭 ${payload.closed ?? "?"} 个缺口（${str(payload.reportNodeId)}）：${oneLine(str(payload.reason), 100)}`;
      case "full.kg.skipKnowledgeNode":
        return `${indent}[${time}] ${this.actor(event)} 跳过来源：${oneLine(str(payload.title) || str(payload.url), 100)}（${zhReason(str(payload.reason) || "low_quality_source")}）`;
      case "full.kg.acknowledgeOpenGaps":
        return `[${time}] 编排器已确认 ${payload.acknowledged ?? "?"} 个缺口会作为报告限制说明`;
      case "full.ledger.upsert": {
        const task = object(payload.task);
        return `[${time}] 编排器加入任务 ${str(task.taskId) || "unknown"}：${oneLine(str(task.title) || str(task.objective), 130)}`;
      }
      case "full.artifact.writeFile":
        return `[${time}] 写入产物：${str(payload.path)}${payload.bytes ? `（${payload.bytes} bytes）` : ""}`;
      case "full.structure.decision": {
        const decision = object(payload.decision);
        return `[${time}] 结构决策：${zhDecision(str(decision.decision))}，补丁=${decision.patchIndex ?? "?"} ${oneLine(str(decision.rationale), 100)}`;
      }
      case "full.ledger.updateStatus":
        return this.opts.mode === "full"
          ? `[${time}] ${event.eventType.slice(5)}${event.taskId ? ` task=${event.taskId}` : ""}`
          : undefined;
      default:
        return this.opts.mode === "full"
          ? `[${time}] ${event.eventType}${event.taskId ? ` task=${event.taskId}` : ""}`
          : undefined;
    }
  }

  private llmRequestLine(event: MemoryEvent): string {
    const payload = event.payload ?? {};
    const request = object(payload.request);
    const time = clock(event.timestamp);
    const indent = event.taskId && event.taskId !== "T_root" ? "  " : "";
    const phase = str(payload.phase);
    const header = `${indent}[${time}] ${this.actor(event)} 正在思考：${llmAction(phase)}${this.opts.mode === "full" ? `（prompt ${promptSize(request)} 字符）` : ""}`;
    if (this.opts.mode !== "transcript") return header;
    return `${header}。完整输入已放到右侧 Agent 对话流。`;
  }

  private llmResponseLine(event: MemoryEvent): string | undefined {
    const payload = event.payload ?? {};
    const response = object(payload.response);
    const phase = str(payload.phase);
    const time = clock(event.timestamp);
    const indent = event.taskId && event.taskId !== "T_root" ? "  " : "";
    const duration = payload.durationMs ?? "?";
    const parsed = parseJson(str(response.content));
    const usage = object(response.usage);
    const tokens = usage.totalTokens ? `, tokens=${usage.totalTokens}` : "";
    let line: string | undefined;
    if (phase.endsWith(".plan")) {
      const queries = Array.isArray(parsed?.queries) ? parsed.queries.filter((item): item is string => typeof item === "string") : [];
      line = `${indent}[${time}] ${this.actor(event)} 检索计划完成：${queries.length} 个查询，用时 ${duration}ms${queries.length ? `；${oneLine(queries.join(" | "), 160)}` : ""}`;
    } else if (phase.endsWith(".assess")) {
      const gaps = Array.isArray(parsed?.openGaps) ? parsed.openGaps.length : 0;
      line = `${indent}[${time}] ${this.actor(event)} 证据评估完成：状态=${zhStatus(str(parsed?.nodeStatus))}，置信度=${num(parsed?.confidence)}，缺口=${gaps}，用时 ${duration}ms`;
    } else if (phase === "rubric") {
      line = `[${time}] 研究标准思考完成，用时 ${duration}ms${zhTokens(tokens)}`;
    } else if (phase === "architect-tree") {
      const aspects = Array.isArray(parsed?.aspects) ? parsed.aspects.length : "?";
      line = `[${time}] 报告结构思考完成：方面=${aspects}，用时 ${duration}ms${zhTokens(tokens)}`;
    } else if (phase === "cycle-reflection") {
      line = `[${time}] 反思思考完成：更新=${len(parsed?.taskUpdates)}，新增任务=${len(parsed?.newTasks)}，继续=${parsed?.continueDispatch ?? "?"}，用时 ${duration}ms`;
    } else if (phase === "structure-review") {
      line = `[${time}] 结构审查思考完成：建议=${len(parsed?.suggestions)}，用时 ${duration}ms`;
    } else if (phase === "report.write") {
      line = `[${time}] 报告写作思考完成：${str(response.content).length} 个 markdown 字符，用时 ${duration}ms`;
    } else if (phase === "report.leaf.inspect") {
      const citationIds = Array.isArray(parsed?.citationIds) ? parsed.citationIds.filter((item): item is string => typeof item === "string") : [];
      line = `[${time}] 报告来源检查完成：选择=${citationIds.length ? citationIds.join(", ") : "无"}，用时 ${duration}ms`;
    } else if (phase === "report.leaf") {
      line = `[${time}] 报告叶节点已起草：${str(response.content).length} 个 markdown 字符，用时 ${duration}ms`;
    } else if (phase === "report.section") {
      line = `[${time}] 报告章节已起草：${str(response.content).length} 个 markdown 字符，用时 ${duration}ms`;
    } else if (phase === "report.synthesize") {
      line = `[${time}] 报告摘要/结论已起草：${str(response.content).length} 个 markdown 字符，用时 ${duration}ms`;
    } else if (phase === "publish-gate") {
      line = `[${time}] 发布检查思考完成，用时 ${duration}ms`;
    } else {
      line = this.opts.mode === "full" || this.opts.mode === "transcript"
        ? `${indent}[${time}] ${this.actor(event)} 思考完成：${phase}，用时 ${duration}ms${zhTokens(tokens)}`
        : undefined;
    }
    if (!line || this.opts.mode !== "transcript") return line;
    return `${line}。完整输出已放到右侧 Agent 对话流。`;
  }

  private captureKnownNames(event: MemoryEvent): void {
    const payload = event.payload ?? {};
    if (event.eventType === "full.ledger.upsert") {
      const task = object(payload.task);
      const taskId = str(task.taskId);
      if (taskId) this.taskTitles.set(taskId, str(task.title) || str(task.objective) || "");
    }
    if (event.eventType === "full.kg.upsertReportNode" || event.eventType === "full.kg.updateReportNode") {
      const node = object(payload.node);
      const nodeId = str(node.nodeId);
      if (nodeId) this.nodeLabels.set(nodeId, str(node.label) || str(node.scopeNote) || "");
    }
  }

  private actor(event: MemoryEvent): string {
    if (event.eventType === "agent_runtime_visual") return visualFromRuntimeEvent(event)?.actor.title ?? "AgentRuntime";
    const phase = str(event.payload?.phase);
    if (phase.startsWith("report.")) return "写作代理";
    if (phase === "cycle-reflection" || event.eventType.includes("reflection_scheduler") || event.eventType === "cycle_reflection") return "全局反思代理";
    if (phase === "structure-review" || event.eventType.includes("structure")) return "结构审查代理";
    if (phase.includes("gate") || event.eventType.includes("completion_gate") || event.eventType.includes("publish_gate")) return "检查器";
    if (phase === "architect-tree") return "主规划代理";
    if (event.taskId && event.taskId !== "T_root") return `子代理 ${event.taskId}`;
    if (event.taskId === "T_root") return "初步探索";
    return "编排器";
  }

  private frameKind(event: MemoryEvent): ResearchStreamFrameKind {
    if (this.opts.mode === "transcript" && isLlmEvent(event)) return "transcript";
    return frameKind(event);
  }

  private transcriptMessages(event: MemoryEvent): ResearchStreamTranscriptMessage[] | undefined {
    if (this.opts.mode !== "transcript") return undefined;
    const payload = event.payload ?? {};
    if (event.eventType === "full.llm.request") {
      const request = object(payload.request);
      return [
        transcriptMessage("system", str(request.system), this.maxTranscriptChars),
        transcriptMessage("user", str(request.user), this.maxTranscriptChars),
      ].filter((message) => message.content);
    }
    if (event.eventType === "full.llm.response") {
      const response = object(payload.response);
      return [transcriptMessage("assistant", str(response.content), this.maxTranscriptChars)].filter((message) => message.content);
    }
    return undefined;
  }

  private details(event: MemoryEvent): string[] | undefined {
    const payload = event.payload ?? {};
    if (event.eventType === "human_review_requested") {
      const review = object(payload.humanReview);
      const questions = Array.isArray(review.questions) ? review.questions.map(object) : [];
      return [
        ...questions.map((question, index) => `${index + 1}. ${str(question.question)} 回答格式：${str(question.answerFormat)}`),
        str(review.responseInstructions),
      ].filter(Boolean);
    }
    if (event.eventType === "full.llm.request") {
      const request = object(payload.request);
      const phase = str(payload.phase) || "llm";
      const bits = [
        `意图：${llmAction(phase)}`,
        `提供方：${str(payload.provider) || "unknown"}`,
      ];
      const reasoning = str(request.system);
      if (reasoning) bits.push(`系统提示：${oneLine(reasoning, 180)}`);
      return bits;
    }
    if (event.eventType === "full.llm.response") {
      const response = object(payload.response);
      const bits = [`模型输出：${oneLine(str(response.reasoning) || str(response.content), 180)}`];
      const usage = object(response.usage);
      if (usage.totalTokens) bits.push(`tokens：${usage.totalTokens}`);
      return bits;
    }
    if (event.eventType === "full.search.request") {
      return [`工具：web_search`, `查询：${oneLine(str(payload.query), 160)}`];
    }
    if (event.eventType === "full.search.response") {
      return [`结果数：${len(payload.results)}`, `提供方：${str(payload.provider) || "unknown"}`];
    }
    if (event.eventType === "full.fetch.request") {
      return [`工具：fetch_page`, `来源：${sourceLabel(payload, 180)}`, `URL：${oneLine(str(payload.url), 220)}`];
    }
    if (event.eventType === "full.fetch.response") {
      return [
        `提供方：${str(payload.provider) || "unknown"}`,
        `内容字符数：${payload.contentChars ?? "?"}`,
        `预览：${oneLine(str(payload.contentPreview), 180)}`,
      ];
    }
    if (event.eventType === "full.fetch.error") {
      return [
        `工具：fetch_page`,
        `来源：${sourceLabel(payload, 180)}`,
        `URL：${oneLine(str(payload.url), 220)}`,
        `底层错误：${errorMessage(payload.error)}`,
      ];
    }
    return undefined;
  }

  private taskLabel(taskId?: string): string {
    if (!taskId) return "";
    const title = this.taskTitles.get(taskId);
    return title ? `: ${oneLine(title, 100)}` : "";
  }
}

export function renderResearchEvent(event: MemoryEvent, opts: ResearchStreamRendererOptions): ResearchStreamFrame | undefined {
  return new ResearchStreamRenderer(opts).render(event);
}

export function toVisualResearchEvent(event: MemoryEvent, fallbackLine?: string): VisualResearchEvent {
  const runtimeVisual = visualFromRuntimeEvent(event);
  if (runtimeVisual) return runtimeVisual;
  const payload = event.payload ?? {};
  const phase = str(payload.phase);
  const actor = visualActor(event, phase);
  const visual = visualKind(event, phase);
  const title = visualTitle(event, visual.kind, phase, fallbackLine);
  const summary = visualSummary(event, fallbackLine);
  return {
    eventId: event.eventId,
    episodeId: event.episodeId,
    timestamp: event.timestamp,
    kind: visual.kind,
    actor,
    ui: {
      lane: visual.lane,
      severity: visual.severity,
      title,
      summary,
      collapsible: visual.collapsible,
      initiallyCollapsed: visual.initiallyCollapsed,
    },
    payload,
  };
}

function visualFromRuntimeEvent(event: MemoryEvent): VisualResearchEvent | undefined {
  if (event.eventType !== "agent_runtime_visual") return undefined;
  const visual = object(event.payload?.visual);
  const ui = object(visual.ui);
  const actor = object(visual.actor);
  const kind = str(visual.kind) as VisualResearchEventKind | undefined;
  const lane = str(ui.lane) as VisualResearchLane | undefined;
  if (!kind || !lane) return undefined;
  return {
    eventId: event.eventId,
    episodeId: event.episodeId,
    timestamp: event.timestamp,
    kind,
    actor: {
      agentRunId: str(actor.agentRunId),
      role: (str(actor.role) as AgentRole | undefined) ?? "system",
      title: str(actor.title) || "AgentRuntime",
      taskId: str(actor.taskId),
      reportNodeId: str(actor.reportNodeId),
      parentAgentRunId: str(actor.parentAgentRunId),
    },
    ui: {
      lane,
      severity: (str(ui.severity) as VisualResearchSeverity | undefined) ?? "info",
      title: str(ui.title) || str(actor.title) || "AgentRuntime",
      summary: str(ui.summary),
      collapsible: boolOrUndefined(ui.collapsible),
      initiallyCollapsed: boolOrUndefined(ui.initiallyCollapsed),
    },
    budget: budgetFromObject(object(visual.budget)),
    payload: object(visual.payload),
  };
}

function runtimeVisualLine(event: MemoryEvent, time: string): string {
  const visual = visualFromRuntimeEvent(event);
  if (!visual) return `[${time}] AgentRuntime event`;
  const actor = zhActorTitle(visual.actor.title);
  const summary = visual.ui.summary ? `: ${oneLine(visual.ui.summary, 140)}` : "";
  return `[${time}] ${actor} ${zhVisualKind(visual.kind)}：${oneLine(zhTitle(visual.ui.title), 100)}${summary}`;
}

function visualActor(event: MemoryEvent, phase: string): VisualResearchEvent["actor"] {
  if (phase.startsWith("report.")) {
    return {
      agentRunId: event.agentRunId,
      role: "reporter",
      title: "Writer",
      taskId: event.taskId,
      reportNodeId: event.reportNodeId,
    };
  }
  if (event.taskId && event.taskId !== "T_root") {
    return {
      agentRunId: event.agentRunId,
      role: "subagent",
      title: `EvidenceAgent ${event.taskId}`,
      taskId: event.taskId,
      reportNodeId: event.reportNodeId,
    };
  }
  if (event.taskId === "T_root" || event.eventType.startsWith("scout_")) {
    return {
      agentRunId: event.agentRunId,
      role: "main_dispatcher",
      title: "MainPlannerAgent",
      taskId: event.taskId,
      reportNodeId: event.reportNodeId,
    };
  }
  return {
    agentRunId: event.agentRunId,
    role: systemRoleForEvent(event),
    title: actorTitleForEvent(event, phase),
    taskId: event.taskId,
    reportNodeId: event.reportNodeId,
  };
}

function visualKind(
  event: MemoryEvent,
  phase: string,
): { kind: VisualResearchEventKind; lane: VisualResearchLane; severity?: VisualResearchSeverity; collapsible?: boolean; initiallyCollapsed?: boolean } {
  if (event.eventType === "evidence_agent_started" || event.eventType === "scout_started") {
    return { kind: "agent_started", lane: event.taskId && event.taskId !== "T_root" ? "agent" : "main", severity: "info" };
  }
  if (event.eventType === "main_planner_started") {
    return { kind: "agent_started", lane: "main", severity: "info" };
  }
  if (event.eventType === "main_planner_finished") {
    return { kind: "agent_message", lane: "main", severity: "success" };
  }
  if (event.eventType === "evidence_agent_finished" || event.eventType === "scout_finished") {
    return { kind: "agent_message", lane: event.taskId && event.taskId !== "T_root" ? "agent" : "main", severity: "success" };
  }
  if (event.eventType === "evidence_agent_failed" || event.eventType.endsWith(".error") || event.eventType === "full.agent.failed") {
    return { kind: "error", lane: event.taskId ? "agent" : "system", severity: "error", collapsible: true };
  }
  if (event.eventType === "full.llm.request") {
    return { kind: "agent_thinking", lane: laneForPhase(event, phase), severity: "info", collapsible: true, initiallyCollapsed: true };
  }
  if (event.eventType === "full.llm.response") {
    return { kind: "agent_message", lane: laneForPhase(event, phase), severity: "info", collapsible: true, initiallyCollapsed: true };
  }
  if (event.eventType.endsWith(".request") && (event.eventType.includes("search") || event.eventType.includes("fetch"))) {
    return { kind: "tool_started", lane: laneForTask(event), severity: "info", collapsible: true };
  }
  if (event.eventType.endsWith(".response") && (event.eventType.includes("search") || event.eventType.includes("fetch"))) {
    return { kind: "tool_finished", lane: laneForTask(event), severity: "success", collapsible: true };
  }
  if (event.eventType.includes("fetch.rejected") || event.eventType.includes("fetch.skipped") || event.eventType.includes("search.skipped")) {
    return { kind: "tool_finished", lane: laneForTask(event), severity: "warning", collapsible: true };
  }
  if (event.eventType.includes("kg.upsertKnowledgeNode") || event.eventType.includes("kg.reuseKnowledgeNode")) {
    return { kind: "source_saved", lane: laneForTask(event), severity: "success", collapsible: true };
  }
  if (event.eventType.includes("kg.upsertEvidenceLink") || event.eventType.includes("kg.updateEvidenceLink")) {
    return { kind: "evidence_linked", lane: laneForTask(event), severity: "success" };
  }
  if (event.eventType.includes("kg.addOpenGap")) {
    return { kind: "gap_opened", lane: laneForTask(event), severity: "warning" };
  }
  if (event.eventType.includes("ledger.upsert") || event.eventType === "root_created") {
    return { kind: "task_created", lane: "system", severity: "info" };
  }
  if (event.eventType === "structure_critic_decision" || event.eventType === "patch_guard_decision" || event.eventType === "structure_review") {
    const severity = patchDecisionSeverity(event);
    return { kind: "structure_decision", lane: "system", severity, collapsible: true };
  }
  if (event.eventType.includes("structure") || event.eventType === "architect_tree_created") {
    return { kind: "tree_changed", lane: "system", severity: "info" };
  }
  if (event.eventType.includes("reflection_scheduler") || event.eventType === "cycle_reflection" || phase === "cycle-reflection") {
    return { kind: "reflection_decision", lane: "main", severity: "info", collapsible: true };
  }
  if (event.eventType === "completion_gate" || event.eventType.includes("completion_gate_") || event.eventType.includes("publish_gate") || event.eventType === "human_review_requested" || phase === "publish-gate") {
    return { kind: "gate_check", lane: "gate", severity: event.eventType === "publish_gate_repair" || event.eventType === "human_review_requested" ? "warning" : "info", collapsible: true };
  }
  if (event.eventType === "report_draft_created" || phase.startsWith("report.")) {
    return { kind: "writer_draft", lane: "writer", severity: "info", collapsible: true };
  }
  if (event.eventType === "writer_gap_repair") {
    return { kind: "gap_opened", lane: "writer", severity: "warning", collapsible: true };
  }
  if (event.eventType === "episode_succeeded" || event.eventType.includes("artifact")) {
    return { kind: "artifact_ready", lane: "system", severity: "success" };
  }
  return { kind: "agent_message", lane: "system", severity: "info" };
}

function visualTitle(event: MemoryEvent, kind: VisualResearchEventKind, phase: string, fallbackLine?: string): string {
  if (event.eventType === "reflection_scheduler_started") return "全局反思开始";
  if (event.eventType === "reflection_scheduler_finished") return "全局反思完成";
  if (event.eventType === "cycle_reflection" || phase === "cycle-reflection") return "子代理批次完成后的全局反思";
  if (event.eventType === "main_planner_started") return "主规划开始";
  if (event.eventType === "main_planner_finished") return "主规划完成";
  if (event.eventType === "dispatch_cycle_started") return "分发轮次开始";
  if (event.eventType === "dispatch_cycle_finished") return "分发轮次完成";
  if (event.eventType === "evidence_agent_started") return `子代理 ${event.taskId ?? ""} 开始`.trim();
  if (event.eventType === "evidence_agent_finished") return `子代理 ${event.taskId ?? ""} 完成`.trim();
  if (event.eventType === "structure_review_started") return "结构审查开始";
  if (event.eventType === "structure_review_agent_suggested") return "结构审查提出补丁";
  if (event.eventType === "structure_critic_decision") return "结构批评决策";
  if (event.eventType === "patch_guard_decision") return "补丁守卫决策";
  if (event.eventType === "structure_review") return "结构审查";
  if (event.eventType === "completion_gate") return "完成度检查";
  if (event.eventType === "completion_gate_auto_skipped") return "自动跳过未解决问题";
  if (event.eventType === "publish_gate_auto_skipped") return "带警告发布";
  if (event.eventType === "human_review_requested") return "需要你的决定";
  if (event.eventType === "report_draft_created") return "报告草稿已生成";
  if (event.eventType === "writer_gap_repair") return "写作阶段请求修复";
  if (event.eventType === "episode_succeeded") return "研究任务成功完成";
  if (event.eventType === "full.fetch.rejected") return "跳过来源";
  if (event.eventType === "full.fetch.skipped") return "跳过网页读取";
  if (event.eventType === "full.search.skipped") return "跳过搜索";
  if (event.eventType === "full.kg.skipKnowledgeNode") return "跳过来源";
  if (kind === "tool_started" || kind === "tool_finished") return phase || event.eventType.replace(/^full\./, "");
  if (kind === "agent_thinking") return llmAction(phase);
  return oneLine((fallbackLine ?? event.eventType).replace(/^\[[^\]]+\]\s*/, ""), 80) || event.eventType;
}

function visualSummary(event: MemoryEvent, fallbackLine?: string): string | undefined {
  const payload = event.payload ?? {};
  if (event.eventType === "cycle_reflection") {
    return `已完成=${payload.completed ?? "?"}，缺口=${payload.gaps ?? "?"}，新增任务=${len(payload.newTasks)}，修复任务=${len(payload.createdTaskIds)}`;
  }
  if (event.eventType === "reflection_scheduler_started") {
    return `agent=${payload.agentRuns ?? "?"}，缺口=${payload.gaps ?? "?"}，到达轮次上限=${payload.atCycleLimit ?? "?"}`;
  }
  if (event.eventType === "reflection_scheduler_finished") {
    return `继续=${payload.continueDispatch ?? "?"}，修复任务=${len(payload.createdTaskIds)}`;
  }
  if (event.eventType === "structure_critic_decision") {
    const critique = object(payload.critique);
    return `风险=${zhRisk(str(critique.risk))}，动作=${zhAction(str(critique.suggestedAction))}，原因=${oneLine(str(critique.reason), 120)}`;
  }
  if (event.eventType === "full.fetch.rejected") {
    return `${sourceLabel(payload, 120)}（${zhReason(str(payload.reason) || "low_quality_source")}）`;
  }
  if (event.eventType === "full.fetch.skipped") {
    return `${sourceLabel(payload, 120)}（${zhReason(str(payload.reason)) || "无需读取全文"}）`;
  }
  if (event.eventType === "full.search.skipped") {
    return `搜索已跳过：${zhReason(str(payload.reason)) || oneLine(str(payload.reason), 120)}`;
  }
  if (event.eventType === "full.kg.skipKnowledgeNode") {
    return `${oneLine(str(payload.title) || str(payload.url), 120)}（${zhReason(str(payload.reason) || "low_quality_source")}）`;
  }
  if (event.eventType === "patch_guard_decision") {
    const decision = object(payload.decision);
    return `决策=${zhDecision(str(decision.decision))}，理由=${oneLine(str(decision.rationale), 120)}`;
  }
  if (event.eventType === "dispatch_cycle_started") {
    return `待处理=${len(payload.queuedTaskIds)}`;
  }
  if (event.eventType === "dispatch_cycle_finished") {
    return `agent=${payload.agentRuns ?? "?"}，新增=${len(payload.newlyQueuedTaskIds)}，待处理=${len(payload.queuedTaskIds)}，原因=${str(payload.stopReason) || "unknown"}`;
  }
  if (event.eventType === "full.llm.response") {
    const response = object(payload.response);
    return oneLine(str(response.reasoning) || str(response.content), 180);
  }
  if (fallbackLine) return oneLine(fallbackLine.replace(/^\[[^\]]+\]\s*/, ""), 180);
  return undefined;
}

function laneForPhase(event: MemoryEvent, phase: string): VisualResearchLane {
  if (phase.startsWith("report.")) return "writer";
  if (phase.includes("gate")) return "gate";
  if (event.taskId && event.taskId !== "T_root") return "agent";
  if (phase === "cycle-reflection" || phase === "structure-review" || phase === "architect-tree" || event.taskId === "T_root") return "main";
  return "system";
}

function laneForTask(event: MemoryEvent): VisualResearchLane {
  return event.taskId && event.taskId !== "T_root" ? "agent" : "main";
}

function budgetFromObject(value: Record<string, unknown>): VisualResearchEvent["budget"] | undefined {
  const budget = {
    maxReactSteps: finiteNumberOrUndefined(value.maxReactSteps),
    maxToolCalls: finiteNumberOrUndefined(value.maxToolCalls),
    maxSearchCalls: finiteNumberOrUndefined(value.maxSearchCalls),
    maxFetchCalls: finiteNumberOrUndefined(value.maxFetchCalls),
    targetReactSteps: finiteNumberOrUndefined(value.targetReactSteps),
    targetToolCalls: finiteNumberOrUndefined(value.targetToolCalls),
    targetSearchCalls: finiteNumberOrUndefined(value.targetSearchCalls),
    targetFetchCalls: finiteNumberOrUndefined(value.targetFetchCalls),
  };
  return Object.values(budget).some((item) => typeof item === "number") ? budget : undefined;
}

function finiteNumberOrUndefined(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function systemRoleForEvent(event: MemoryEvent): AgentRole {
  if (event.eventType.includes("report")) return "reporter";
  if (event.eventType.includes("reflection") || event.eventType.includes("architect")) return "main_dispatcher";
  return "system";
}

function actorTitleForEvent(event: MemoryEvent, phase: string): string {
  if (event.eventType.includes("reflection_scheduler") || event.eventType === "cycle_reflection" || phase === "cycle-reflection") return "ReflectionSchedulerAgent";
  if (event.eventType === "structure_critic_decision") return "StructureCriticAgent";
  if (event.eventType === "patch_guard_decision") return "DeterministicPatchGuard";
  if (event.eventType.includes("structure") || phase === "structure-review") return "StructureReviewAgent";
  if (phase.startsWith("report.")) return "WriterAgent";
  if (event.eventType.includes("gate") || phase.includes("gate")) return "Gate";
  return "Orchestrator";
}

function patchDecisionSeverity(event: MemoryEvent): VisualResearchSeverity {
  const payload = event.payload ?? {};
  const decision = str(object(payload.decision).decision);
  const risk = str(object(payload.critique).risk);
  if (decision === "reject" || risk === "dangerous") return "error";
  if (decision === "redispatch" || risk === "risky") return "warning";
  if (decision === "apply" || risk === "safe") return "success";
  return "info";
}

function frameKind(event: MemoryEvent): ResearchStreamFrameKind {
  if (event.eventType === "agent_runtime_visual") {
    const kind = visualFromRuntimeEvent(event)?.kind;
    if (kind === "agent_thinking") return "thinking";
    if (kind === "tool_started" || kind === "tool_finished") return "debug";
    return "summary";
  }
  if (event.eventType.includes("llm")) return event.eventType.includes("request") || event.eventType.includes("response") ? "thinking" : "debug";
  if (event.eventType.includes("search")) return "search";
  if (event.eventType.includes("fetch")) return "search";
  if (event.eventType.includes("kg.") || event.eventType.includes("evidence")) return "evidence";
  if (event.eventType.includes("artifact")) return "artifact";
  if (event.eventType.startsWith("full.")) return "debug";
  return "summary";
}

function isLlmEvent(event: MemoryEvent): boolean {
  return event.eventType === "full.llm.request" || event.eventType === "full.llm.response" || event.eventType === "full.llm.error";
}

function clock(timestamp: string): string {
  return timestamp.slice(11, 19) || timestamp;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "?";
}

function len(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function boolOrUndefined(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function oneLine(value: string, max = 120): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, Math.max(0, max - 3))}...`;
}

function block(value: string, max: number): string {
  const clean = value.trim();
  if (!clean) return "";
  const clipped = clean.length <= max ? clean : `${clean.slice(0, Math.max(0, max - 20))}\n...<已截断>...`;
  return clipped.replace(/\n/g, "\n    ");
}

function transcriptMessage(role: ResearchStreamTranscriptMessage["role"], value: string, max: number): ResearchStreamTranscriptMessage {
  const clean = value.trim();
  const clipped = clean.length > max;
  return {
    role,
    content: clipped ? `${clean.slice(0, Math.max(0, max - 20))}\n...<已截断>...` : clean,
    clipped,
  };
}

function parseJson(value: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return object(parsed);
  } catch {
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) return undefined;
    try {
      return object(JSON.parse(match[0]));
    } catch {
      return undefined;
    }
  }
}

function llmAction(phase: string): string {
  if (phase.endsWith(".plan")) return `规划 ${phase.replace(".plan", "")}`;
  if (phase.endsWith(".assess")) return `评估 ${phase.replace(".assess", "")}`;
  if (phase === "rubric") return "生成研究标准";
  if (phase === "architect-tree") return "构建报告树";
  if (phase === "cycle-reflection") return "反思子代理结果";
  if (phase === "structure-review") return "审查报告结构";
  if (phase === "report.write") return "撰写报告";
  if (phase === "report.leaf.inspect") return "检查报告来源";
  if (phase === "report.leaf") return "起草报告叶节点";
  if (phase === "report.section") return "起草报告章节";
  if (phase === "report.synthesize") return "起草报告摘要和结论";
  if (phase === "publish-gate") return "执行发布检查";
  return phase || "调用 LLM";
}

function zhActorTitle(title: string): string {
  if (title === "MainPlannerAgent") return "主规划";
  if (title === "ReflectionSchedulerAgent") return "全局反思";
  if (title === "StructureReviewAgent") return "结构审查";
  if (title === "StructureCriticAgent") return "结构批评";
  if (title === "WriterAgent" || title === "Writer") return "写作代理";
  if (title === "Gate") return "检查器";
  if (title.startsWith("EvidenceAgent")) return title.replace("EvidenceAgent", "证据子代理");
  return title;
}

function zhTitle(title: string): string {
  return title
    .replace(/MainPlannerAgent started/g, "主规划开始")
    .replace(/MainPlannerAgent finished/g, "主规划完成")
    .replace(/ReflectionSchedulerAgent started/g, "全局反思开始")
    .replace(/ReflectionSchedulerAgent finished/g, "全局反思完成")
    .replace(/EvidenceAgent/g, "证据子代理")
    .replace(/ started/g, " 开始")
    .replace(/ finished/g, " 完成");
}

function zhVisualKind(kind: string): string {
  return ({
    agent_started: "开始",
    agent_thinking: "思考",
    agent_message: "消息",
    tool_started: "调用工具",
    tool_finished: "工具完成",
    source_saved: "保存来源",
    evidence_linked: "关联证据",
    gap_opened: "记录缺口",
    task_created: "创建任务",
    tree_changed: "调整结构",
    reflection_decision: "反思",
    structure_decision: "结构决策",
    writer_draft: "写作",
    gate_check: "检查",
    artifact_ready: "产物就绪",
    error: "错误",
  } as Record<string, string>)[kind] ?? kind;
}

function zhRisk(value: string): string {
  return ({ safe: "安全", risky: "有风险", dangerous: "危险" } as Record<string, string>)[value] ?? (value || "?");
}

function zhAction(value: string): string {
  return ({ apply: "应用", reject: "拒绝", redispatch: "重新分发", revise: "修订" } as Record<string, string>)[value] ?? (value || "?");
}

function zhDecision(value: string): string {
  return ({
    apply: "应用",
    reject: "拒绝",
    redispatch: "重新分发",
    pass: "通过",
    fail: "未通过",
    continue: "继续",
    stop: "停止",
    unknown: "未知",
  } as Record<string, string>)[value] ?? (value || "未知");
}

function zhStatus(value: string): string {
  return ({
    supported: "已支持",
    partially_supported: "部分支持",
    contradicted: "被反驳",
    insufficient_evidence: "证据不足",
    downplayed: "降权",
    unknown: "未知",
  } as Record<string, string>)[value] ?? (value || "未知");
}

function zhRelation(value: string): string {
  return ({ supports: "支持", contradicts: "反驳", qualifies: "限定支持", background: "背景" } as Record<string, string>)[value] ?? (value || "关系未知");
}

function zhReason(value: string): string {
  return ({
    low_quality_source: "低质量来源",
    blocked_source_policy: "来源策略阻止",
    duplicate_source: "重复来源",
  } as Record<string, string>)[value] ?? value;
}

function zhTokens(tokens: string): string {
  return tokens ? tokens.replace(", tokens=", "，tokens=") : "";
}

function promptSize(request: unknown): number {
  const req = object(request);
  return str(req.system).length + str(req.user).length;
}

function topTitles(results: unknown): string {
  if (!Array.isArray(results) || results.length === 0) return "";
  const titles = results.slice(0, 2).map((item) => oneLine(str(object(item).title), 60)).filter(Boolean);
  return titles.length ? `; ${titles.join(" | ")}` : "";
}

function sourceLabel(payload: Record<string, unknown>, max: number): string {
  const title = str(payload.title);
  if (title) return oneLine(title, max);
  const url = str(payload.url);
  if (!url) return "未命名来源";
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.split("/").filter(Boolean).at(-1) || parsed.hostname;
    return oneLine(`${parsed.hostname}${path && path !== parsed.hostname ? `/${path}` : ""}`, max);
  } catch {
    return oneLine(url, max);
  }
}

function errorMessage(error: unknown): string {
  const obj = object(error);
  return oneLine(str(obj.message) || String(error), 160);
}
