import type { LlmChat, LlmChatRequest, LlmChatResponse } from "@deepresearch/contracts";

export class EchoJsonLlm implements LlmChat {
  readonly name = "echo-json";

  async chat(req: LlmChatRequest): Promise<LlmChatResponse> {
    if (req.user.includes("Write the final report")) {
      return {
        content: "# Deep Research Report\n\n## Executive Summary\n\nFixture evidence supports the central claim for smoke testing [C1].\n\n## Core Evidence\n\nThe saved evidence links provide a deterministic local report path [C1].\n\n## 结论\n\n本报告基于当前测试证据完成，结论完整。",
      };
    }
    if (req.user.includes("DeepResearch AgentRuntime")) {
      if (req.user.includes("ReflectionSchedulerAgent")) {
        return {
          content: JSON.stringify({
            thoughtSummary: "Finish reflection in deterministic echo mode.",
            action: "finish",
            finish: {
              continueDispatch: false,
              taskUpdates: [],
              newTasks: [],
              skipReasons: [],
            },
          }),
        };
      }
      if (req.user.includes("StructureReviewAgent")) {
        return {
          content: JSON.stringify({
            thoughtSummary: "No structure patches are needed in deterministic echo mode.",
            action: "finish",
            finish: { suggestions: [] },
          }),
        };
      }
      if (req.user.includes("Previous steps:\n[]")) {
        return {
          content: JSON.stringify({
            thoughtSummary: "Search for fixture evidence.",
            action: "tool",
            toolName: "web_search",
            args: { query: "Fixture evidence" },
          }),
        };
      }
      const taskId = req.user.match(/"taskId"\s*:\s*"([^"]+)"/)?.[1];
      return {
        content: JSON.stringify({
          thoughtSummary: "Finish after observing fixture evidence.",
          action: "finish",
          finish: {
            relation: "supports",
            claimText: "Fixture evidence supports the central claim for smoke testing.",
            confidence: 0.7,
            nodeStatus: "supported",
            reasoningSummary: "Fixture search observations are sufficient for local smoke testing.",
            reportletMarkdown: taskId
              ? `#### Fixture evidence\n\nFixture evidence supports the central claim for smoke testing. [E:E_${taskId}_1]`
              : undefined,
            openGaps: [],
            structurePatchSuggestions: [],
            __legacyAssessment: true,
          },
        }),
      };
    }
    if (req.user.includes("\"suggestions\"")) {
      return { content: JSON.stringify({ suggestions: [] }) };
    }
    if (req.user.includes("\"relation\"")) {
      return {
        content: JSON.stringify({
          relation: "supports",
          claimText: "Fixture evidence supports the central claim for smoke testing.",
          confidence: 0.7,
          nodeStatus: "supported",
          reasoningSummary: "Fixture search observations are sufficient for local smoke testing.",
          openGaps: [],
          structurePatchSuggestions: [],
        }),
      };
    }
    if (req.user.includes("\"queries\"")) {
      return {
        content: JSON.stringify({
          queries: ["Background", "Evidence", "Risks"],
          searchRationale: "Use broad fixture queries for local smoke testing.",
          sourceStrategy: "Use broad fixture queries for local smoke testing.",
          reasoningSummary: "Fixture plan produced deterministic search steps.",
        }),
      };
    }
    if (req.user.includes("\"aspects\"")) {
      return {
        content: JSON.stringify({
          aspects: [{
            label: "Core Evidence",
            scopeNote: "Verify the central research claim.",
            hypotheses: [{
              statement: "The central claim requires sourced evidence.",
              researchBrief: "Search for credible sources and record uncertainty.",
              evidenceGuidance: "Prefer official or primary sources.",
            }],
            tasks: [{
              title: "Verify central claim",
              objective: "Find evidence for or against the central claim.",
              acceptanceCriteria: ["At least one credible source or an explicit open gap."],
            }],
          }],
        }),
      };
    }
    if (req.user.startsWith("Build GlobalRubric JSON")) {
      return {
        content: JSON.stringify({
          rubricText: "Use credible sources and cite evidence. " + req.user.slice(0, 300),
          outputHints: { titleHint: "Deep Research Report", language: "zh-CN", citationRequired: true, format: "markdown" },
          researchQuestionHints: ["Background", "Evidence", "Risks"],
        }),
      };
    }
    return { content: "{}" };
  }
}
