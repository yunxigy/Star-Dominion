import { describe, expect, it } from "vitest";
import type { MemoryEvent } from "@deepresearch/contracts";
import { ResearchStreamRenderer } from "../stream-renderer.js";

describe("ResearchStreamRenderer", () => {
  it("renders transcript frames for backend or CLI streaming", () => {
    const renderer = new ResearchStreamRenderer({ mode: "transcript", maxTranscriptChars: 200 });
    const request = renderer.render(event("full.llm.request", {
      phase: "dispatch-evidence.plan",
      provider: "deepseek",
      request: {
        system: "You are an evidence research agent.",
        user: "Create a search plan for the task. Output schema: {\"queries\":string[]}",
      },
    }, { taskId: "T_1", reportNodeId: "R_1", agentRunId: "A_1" }));
    const response = renderer.render(event("full.llm.response", {
      phase: "dispatch-evidence.plan",
      provider: "deepseek",
      durationMs: 123,
      response: {
        content: JSON.stringify({
          queries: ["马克思主义 中国化 发展 路线", "毛泽东思想 邓小平理论 三个代表 科学发展观 习近平新时代中国特色社会主义思想"],
          searchRationale: "Use timeline and theory milestones.",
        }),
      },
    }, { taskId: "T_1", reportNodeId: "R_1", agentRunId: "A_1" }));

    expect(request?.kind).toBe("transcript");
    expect(request?.messages?.map((message) => message.role)).toEqual(["system", "user"]);
    expect(request?.line).toContain("正在思考");
    expect(request?.line).toContain("完整输入已放到右侧");
    expect(request?.collapsible).toBe(true);
    expect(response?.kind).toBe("transcript");
    expect(response?.messages?.map((message) => message.role)).toEqual(["assistant"]);
    expect(response?.line).toContain("检索计划完成：2 个查询");
    expect(response?.line).toContain("完整输出已放到右侧");
    expect(response?.details?.some((line) => line.includes("tokens"))).toBe(false);
  });

  it("renders dispatch cycles and repair task counts", () => {
    const renderer = new ResearchStreamRenderer({ mode: "steps" });
    expect(renderer.render(event("dispatch_cycle_started", {
      cycleId: "C_002",
      queuedTaskIds: ["T_repair_1", "T_repair_2"],
    }))?.line).toContain("分发轮次 C_002 开始：待处理 2 个任务");
    expect(renderer.render(event("cycle_reflection", {
      completed: 2,
      gaps: 3,
      taskUpdates: [{ taskId: "T_1" }],
      newTasks: [],
      createdTaskIds: ["T_repair_1"],
    }))?.line).toContain("修复任务=1");
  });

  it("adds stable visual events for batch-level reflection", () => {
    const renderer = new ResearchStreamRenderer({ mode: "steps" });
    const frame = renderer.render(event("cycle_reflection", {
      completed: 3,
      gaps: 2,
      taskUpdates: [{ taskId: "T_1" }],
      newTasks: [{ title: "repair" }],
      createdTaskIds: ["T_repair_1"],
    }));

    expect(frame?.visual?.kind).toBe("reflection_decision");
    expect(frame?.visual?.actor.title).toBe("ReflectionSchedulerAgent");
    expect(frame?.visual?.actor.role).toBe("main_dispatcher");
    expect(frame?.visual?.ui.lane).toBe("main");
    expect(frame?.visual?.ui.title).toBe("子代理批次完成后的全局反思");
    expect(frame?.visual?.ui.summary).toContain("已完成=3");
    expect(frame?.visual?.ui.summary).toContain("修复任务=1");
  });

  it("renders structure critic and patch guard visual events", () => {
    const renderer = new ResearchStreamRenderer({ mode: "steps" });
    const critic = renderer.render(event("structure_critic_decision", {
      critique: { patchIndex: 0, risk: "risky", suggestedAction: "redispatch", reason: "node has evidence links" },
    }));
    const guard = renderer.render(event("patch_guard_decision", {
      decision: { patchIndex: 0, decision: "reject", rationale: "PatchGuard rejected dangerous patch" },
      critique: { patchIndex: 0, risk: "dangerous" },
    }));

    expect(critic?.line).toContain("结构批评");
    expect(critic?.visual?.kind).toBe("structure_decision");
    expect(critic?.visual?.actor.title).toBe("StructureCriticAgent");
    expect(critic?.visual?.ui.severity).toBe("warning");
    expect(guard?.line).toContain("PatchGuard");
    expect(guard?.visual?.actor.title).toBe("DeterministicPatchGuard");
    expect(guard?.visual?.ui.severity).toBe("error");
  });

  it("renders main planner visual events", () => {
    const renderer = new ResearchStreamRenderer({ mode: "steps" });
    const started = renderer.render(event("main_planner_started", {
      objective: "Research a topic",
    }, { taskId: "T_root", reportNodeId: "R_root", agentRunId: "A_main_planner" }));
    const finished = renderer.render(event("main_planner_finished", {
      scoutKnowledgeNodeIds: ["K1", "K2"],
      reportNodeIds: ["R1", "R2", "R3"],
      taskIds: ["T1"],
    }, { taskId: "T_root", reportNodeId: "R_root", agentRunId: "A_main_planner" }));

    expect(started?.line).toContain("主规划开始");
    expect(started?.visual?.kind).toBe("agent_started");
    expect(started?.visual?.actor.title).toBe("MainPlannerAgent");
    expect(finished?.line).toContain("来源 2 个");
    expect(finished?.visual?.kind).toBe("agent_message");
    expect(finished?.visual?.ui.lane).toBe("main");
  });

  it("renders writer repair gap events", () => {
    const renderer = new ResearchStreamRenderer({ mode: "steps" });
    const frame = renderer.render(event("writer_gap_repair", {
      reason: "Missing evidence",
      repairTaskId: "T_writer_repair_1",
    }, { reportNodeId: "R_leaf" }));

    expect(frame?.line).toContain("写作阶段请求修复");
    expect(frame?.visual?.kind).toBe("gap_opened");
    expect(frame?.visual?.ui.lane).toBe("writer");
    expect(frame?.visual?.ui.severity).toBe("warning");
  });

  it("labels report-phase model and fetch activity as writer work", () => {
    const renderer = new ResearchStreamRenderer({ mode: "transcript", maxTranscriptChars: 200 });
    const request = renderer.render(event("full.llm.request", {
      phase: "report.leaf.inspect",
      provider: "deepseek",
      request: { system: "writer", user: "inspect citations" },
    }));
    const fetch = renderer.render(event("full.fetch.request", {
      phase: "report.leaf.inspect",
      provider: "fetch-page",
      url: "https://example.test/report-source",
    }));

    expect(request?.line).toContain("写作代理 正在思考：检查报告来源");
    expect(fetch?.line).toContain("写作代理 正在打开网页");
    expect(request?.visual?.actor.title).toBe("Writer");
    expect(request?.visual?.ui.lane).toBe("writer");
  });

  it("renders failed evidence agents explicitly", () => {
    const renderer = new ResearchStreamRenderer({ mode: "steps" });
    const frame = renderer.render(event("evidence_agent_failed", {
      actionSummary: "Evidence agent failed: Injected search failure",
    }, { taskId: "T_fail", reportNodeId: "R_fail", agentRunId: "A_fail" }));

    expect(frame?.line).toContain("子代理 T_fail 失败");
    expect(frame?.line).toContain("Injected search failure");
  });

  it("renders fetch_page tool activity", () => {
    const renderer = new ResearchStreamRenderer({ mode: "steps" });
    const request = renderer.render(event("full.fetch.request", {
      phase: "dispatch-evidence",
      provider: "jina-reader-fetch",
      url: "https://example.test/source",
    }, { taskId: "T_1", reportNodeId: "R_1", agentRunId: "A_1" }));
    const response = renderer.render(event("full.fetch.response", {
      phase: "dispatch-evidence",
      provider: "jina-reader-fetch",
      url: "https://example.test/source",
      title: "Fetched source",
      contentChars: 2048,
      contentPreview: "Fetched source body.",
      durationMs: 321,
    }, { taskId: "T_1", reportNodeId: "R_1", agentRunId: "A_1" }));

    expect(request?.kind).toBe("search");
    expect(request?.line).toContain("正在打开网页：example.test/source");
    expect(request?.details).toContain("工具：fetch_page");
    expect(response?.line).toContain("网页读取完成：Fetched source");
    expect(response?.details?.some((line) => line.includes("内容字符数：2048"))).toBe(true);
  });

  it("keeps fetch errors concise in the visible stream and detailed in diagnostics", () => {
    const renderer = new ResearchStreamRenderer({ mode: "steps" });
    const frame = renderer.render(event("full.fetch.error", {
      phase: "dispatch-evidence",
      provider: "jina-reader-fetch",
      url: "https://www.dswxyjy.org.cn/n/2013/0530/c219000-21678927-2.html",
      error: { message: "fetch_page request failed for https://r.jina.ai/http://very-long-provider-url: AbortError" },
    }, { taskId: "T_5", reportNodeId: "R_5", agentRunId: "A_5" }));

    expect(frame?.line).toContain("网页暂时无法读取");
    expect(frame?.line).toContain("已跳过该来源并继续");
    expect(frame?.line).not.toContain("r.jina.ai");
    expect(frame?.details?.some((line) => line.includes("r.jina.ai"))).toBe(true);
  });

  it("renders source policy skips as readable source decisions", () => {
    const renderer = new ResearchStreamRenderer({ mode: "steps" });
    const frame = renderer.render(event("full.fetch.rejected", {
      phase: "dispatch-evidence.react",
      provider: "jina-reader-fetch",
      url: "https://baike.baidu.com/item/9276304",
      reason: "blocked_source_policy",
    }, { taskId: "T_3", reportNodeId: "R_3", agentRunId: "A_3" }));

    expect(frame?.line).toContain("跳过一个来源");
    expect(frame?.line).toContain("来源策略阻止");
    expect(frame?.visual?.ui.title).toBe("跳过来源");
    expect(frame?.visual?.ui.summary).toContain("baike.baidu.com");
    expect(frame?.visual?.ui.summary).toContain("来源策略阻止");
  });

  it("keeps root scout fetch activity in the main lane", () => {
    const renderer = new ResearchStreamRenderer({ mode: "steps" });
    const frame = renderer.render(event("full.fetch.response", {
      phase: "dispatch-evidence",
      provider: "jina-reader-fetch",
      url: "https://example.test/root-source",
      title: "Root source",
      contentChars: 12000,
      durationMs: 3394,
    }, { taskId: "T_root", reportNodeId: "R_root", agentRunId: "A_main_planner" }));

    expect(frame?.visual?.actor.title).toBe("MainPlannerAgent");
    expect(frame?.visual?.actor.role).toBe("main_dispatcher");
    expect(frame?.visual?.ui.lane).toBe("main");
    expect(frame?.visual?.kind).toBe("tool_finished");
  });

  it("preserves runtime visual budget for UI progress", () => {
    const renderer = new ResearchStreamRenderer({ mode: "steps" });
    const frame = renderer.render(event("agent_runtime_visual", {
      visual: {
        eventId: "VR_1",
        episodeId: "EP_test",
        timestamp: "2026-07-01T09:00:00.000Z",
        kind: "agent_thinking",
        actor: { agentRunId: "A_1", role: "subagent", title: "EvidenceAgent T_1", taskId: "T_1", reportNodeId: "R_1" },
        ui: { lane: "agent", severity: "info", title: "Step 1", summary: "Thinking." },
        budget: { maxReactSteps: 48, maxToolCalls: 128, maxFetchCalls: 24 },
      },
    }, { taskId: "T_1", reportNodeId: "R_1", agentRunId: "A_1" }));

    expect(frame?.visual?.budget?.maxReactSteps).toBe(48);
    expect(frame?.visual?.budget?.maxFetchCalls).toBe(24);
  });

  it("renders saved source summaries from knowledge nodes", () => {
    const renderer = new ResearchStreamRenderer({ mode: "steps" });
    const frame = renderer.render(event("full.kg.upsertKnowledgeNode", {
      phase: "dispatch-evidence",
      knowledge: {
        nodeId: "K_url_1",
        title: "庶民的勝利",
        summary: "资料题名：庶民的勝利\n内容概览：文章说明一战胜利不是军阀或资本家的胜利，而是全世界庶民的胜利。",
      },
    }, { taskId: "T_1", reportNodeId: "R_1", agentRunId: "A_1" }));

    expect(frame?.kind).toBe("evidence");
    expect(frame?.line).toContain("保存来源 K_url_1");
    expect(frame?.line).toContain("内容概览");
    expect(frame?.line).toContain("全世界庶民的胜利");
  });

  it("renders reused source summaries from knowledge nodes", () => {
    const renderer = new ResearchStreamRenderer({ mode: "steps" });
    const frame = renderer.render(event("full.kg.reuseKnowledgeNode", {
      phase: "dispatch-evidence",
      knowledgeNodeId: "K_url_1",
      knowledge: {
        nodeId: "K_url_1",
        title: "重复来源",
        summary: "资料题名：重复来源\n内容概览：复用来源仍然保留页面内容摘要。",
      },
    }, { taskId: "T_2", reportNodeId: "R_2", agentRunId: "A_2" }));

    expect(frame?.kind).toBe("evidence");
    expect(frame?.line).toContain("复用来源 K_url_1");
    expect(frame?.line).toContain("复用来源仍然保留页面内容摘要");
  });

  it("renders reportlet upserts in transcript replay", () => {
    const renderer = new ResearchStreamRenderer({ mode: "transcript" });
    const frame = renderer.render(event("full.kg.upsertReportlet", {
      reportlet: {
        reportletId: "RL_1",
        reportNodeId: "R_hyp_1",
        taskId: "T_item_1",
        title: "定义与历史渊源",
        citedEvidenceLinkIds: ["E_1", "E_2"],
        citedKnowledgeNodeIds: ["K_1"],
      },
    }, { taskId: "T_item_1", reportNodeId: "R_hyp_1", agentRunId: "A_1" }));

    expect(frame?.kind).toBe("evidence");
    expect(frame?.line).toContain("保存报告片段 RL_1");
    expect(frame?.line).toContain("证据 2，资料 1");
    expect(frame?.event.payload?.reportlet).toMatchObject({ reportletId: "RL_1" });
  });

  it("renders human review questions with an explicit answer format", () => {
    const renderer = new ResearchStreamRenderer({ mode: "steps" });
    const frame = renderer.render(event("human_review_requested", {
      humanReview: {
        summary: "一项关键数据仍缺少权威口径，需要你决定报告如何处理。",
        responseInstructions: "请按问题编号回复，例如：1=A。",
        questions: [{
          questionId: "Q_1",
          question: "1998 年数据应采用估算值，还是改写为已核实的 1999-2007 年口径？",
          whyNeeded: "现有 1998 年来源不是官方统计。",
          answerFormat: "回复 A（采用估算并标注）或 B（改写年份口径）",
          options: ["A", "B"],
          recommendedAnswer: "B",
        }],
      },
    }));

    expect(frame?.line).toContain("需要你的决定");
    expect(frame?.line).toContain("1 个问题");
    expect(frame?.details).toContain("1. 1998 年数据应采用估算值，还是改写为已核实的 1999-2007 年口径？ 回答格式：回复 A（采用估算并标注）或 B（改写年份口径）");
    expect(frame?.details).toContain("请按问题编号回复，例如：1=A。");
    expect(frame?.visual?.ui.title).toBe("需要你的决定");
  });
});

function event(
  eventType: string,
  payload: Record<string, unknown>,
  meta: Partial<MemoryEvent> = {},
): MemoryEvent {
  return {
    eventId: "ME_test",
    eventType,
    episodeId: "EP_test",
    timestamp: "2026-07-01T09:00:00.000Z",
    payload,
    ...meta,
  };
}
