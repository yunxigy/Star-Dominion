import type { HumanReviewQuestion, HumanReviewRequest } from "@deepresearch/contracts";
import { parseJsonObject } from "../infra/json.js";
import { tracedLlmChat } from "../trace.js";
import type { PhaseContext } from "../types.js";

export interface HumanReviewConcern {
  id: string;
  title: string;
  description: string;
  reportNodeId?: string;
  impact?: "low" | "medium" | "high";
  suggestedAction?: string;
  issueCode?: string;
  requirementIds?: string[];
}

interface HumanReviewJson {
  summary?: string;
  questions?: Array<Partial<HumanReviewQuestion>>;
  responseInstructions?: string;
}

export async function createHumanReviewRequest(
  ctx: PhaseContext,
  stage: HumanReviewRequest["stage"],
  summary: string,
  concerns: HumanReviewConcern[],
): Promise<HumanReviewRequest> {
  const fallback = fallbackReview(stage, summary, concerns, ctx);
  const llmCfg = ctx.state.runtimeProfile.llm.publishGate ?? ctx.state.runtimeProfile.llm.reflection;
  if (!llmCfg || concerns.length === 0) return fallback;
  try {
    const response = await tracedLlmChat(ctx, "human-review", {
      system: `You convert unresolved deep-research issues into a short decision request for the user.
Do not search, do not answer the research question, and do not repeat internal framework jargon.
Ask only questions whose answers would change whether a claim is included, omitted, qualified, or researched further.
Ordinary evidence scarcity should already have been handled by bounded repair plus automatic qualification or omission. Ask the user only when a real preference or supplied source would materially change the answer, or when a non-waivable integrity constraint blocks publication.
Never ask the user to weaken or override a blocked/forbidden-source rule, and never suggest mining a blocked source for citations or leads.
Never suggest hypothetical, fabricated, invented, placeholder, generic-uncited, or otherwise unsupported evidence as a substitute for missing real sources.
Never recommend reducing an explicit minimum, dropping a required methodology or citation, or accepting a report as complete while must requirements remain unmet. Offer continued research, explicit omission of unsupported claims, or a user-supplied verifiable source instead.
Never suggest approximate, estimated, assumed, or inferred values for missing required fields, and never substitute a different research design as a proxy for a required methodology category.
Return strict JSON with summary, questions, and responseInstructions.`,
      user: `Research task:
${ctx.state.submission.userInput}

Review stage: ${stage}
Reason the run paused: ${summary}

Unresolved concerns:
${JSON.stringify(concerns.slice(0, 12), null, 2)}

Output schema:
{"summary":string,"questions":[{"id":string,"title":string,"question":string,"whyNeeded":string,"answerFormat":string,"options":string[],"recommendedAnswer":string,"reportNodeId":string}],"responseInstructions":string}

Generate 1-5 concrete questions. Each question must tell the user exactly what to decide and how to answer. Prefer multiple-choice options when possible.`,
      json: true,
      model: llmCfg.model,
      maxTokens: Math.min(llmCfg.maxTokens, 4096),
      temperature: 0.1,
      timeoutMs: llmCfg.timeoutMs,
    }, { agentRunId: "A_human_review" });
    const parsed = parseJsonObject<HumanReviewJson>(response.content || response.reasoning || "");
    const questions = normalizeQuestions(parsed?.questions, concerns);
    if (questions.length === 0) return fallback;
    return {
      stage,
      summary: cleanText(parsed?.summary) || fallback.summary,
      questions,
      responseInstructions: cleanText(parsed?.responseInstructions) || fallback.responseInstructions,
      generatedAt: new Date(ctx.now()).toISOString(),
    };
  } catch {
    return fallback;
  }
}

function fallbackReview(
  stage: HumanReviewRequest["stage"],
  summary: string,
  concerns: HumanReviewConcern[],
  ctx: PhaseContext,
): HumanReviewRequest {
  const selected = concerns.slice(0, 5);
  return {
    stage,
    summary: summary || "研究仍有无法自动解决的问题，需要确认如何处理。",
    questions: selected.map((concern, index) => ({
      id: concern.id || `review_${index + 1}`,
      title: concern.title || `待决定问题 ${index + 1}`,
      question: `对于“${concern.description}”，你希望继续补充研究、保留但明确标注证据不足，还是从最终报告中省略？`,
      whyNeeded: "该决定会影响最终报告是否保留相关结论以及结论的确定程度。",
      answerFormat: "请回答：继续研究 / 降级保留 / 省略，并可补充你认可的来源或判断依据。",
      options: ["继续研究", "降级保留", "省略"],
      recommendedAnswer: concern.suggestedAction || "降级保留",
      reportNodeId: concern.reportNodeId,
      issueCode: concern.issueCode || concern.title,
      requirementIds: concern.requirementIds,
    })),
    responseInstructions: `请按问题 ID 逐项回答，例如“${selected[0]?.id || "review_1"}：降级保留”。回答后可使用当前 checkpoint 继续运行。`,
    generatedAt: new Date(ctx.now()).toISOString(),
  };
}

function normalizeQuestions(value: HumanReviewJson["questions"], concerns: HumanReviewConcern[]): HumanReviewQuestion[] {
  if (!Array.isArray(value)) return [];
  const concernById = new Map(concerns.map((item) => [item.id, item]));
  return value.flatMap((item, index) => {
    const question = cleanText(item.question);
    if (!question) return [];
    const safetyText = [item.title, item.question, item.whyNeeded, item.recommendedAnswer, ...stringArray(item.options)].map(cleanText).join(" ");
    if (isBlockedSourceDecision(safetyText) || isFabricatedEvidenceDecision(safetyText) || isRequirementWeakeningDecision(safetyText)) return [];
    const reportNodeId = cleanText(item.reportNodeId);
    const concern = concerns.find((candidate) => reportNodeId && candidate.reportNodeId === reportNodeId)
      ?? concernById.get(cleanText(item.id))
      ?? concerns[index];
    return [{
      id: cleanText(item.id) || concern?.id || `review_${index + 1}`,
      title: cleanText(item.title) || concern?.title || `待决定问题 ${index + 1}`,
      question,
      whyNeeded: cleanText(item.whyNeeded) || "该决定会影响最终报告如何处理相关结论。",
      answerFormat: cleanText(item.answerFormat) || "请明确回答继续研究、降级保留或省略。",
      options: stringArray(item.options).slice(0, 5),
      recommendedAnswer: cleanText(item.recommendedAnswer) || concern?.suggestedAction,
      reportNodeId: reportNodeId || concern?.reportNodeId,
      issueCode: concern?.issueCode || concern?.title,
      requirementIds: concern?.requirementIds,
    }];
  }).slice(0, 5);
}

function isBlockedSourceDecision(text: string): boolean {
  return /\b(?:blocked|forbidden|prohibited|excluded)\s+(?:reference|source|article|paper|url)\b|(?:屏蔽|禁止|禁用|排除)(?:的)?(?:来源|文献|文章|论文|链接)/iu.test(text);
}

function isFabricatedEvidenceDecision(text: string): boolean {
  return /\b(?:hypothetical|fabricated|invented|made[- ]?up|placeholder)\s+(?:example|evidence|source|study|citation)s?\b|\b(?:generic|general)\s+(?:description|claim|example)s?\s+without\s+(?:specific\s+)?citations?\b|\b(?:use|include|proceed\s+with)\s+[^.!?]{0,60}\bwithout\s+(?:a\s+)?citations?\b|\b(?:use|fill|report)\s+(?:an?\s+)?(?:approximate|estimated|assumed|inferred)\s+(?:value|number|sample|size)s?\b|\buse\s+[^.!?]{0,60}\bas\s+(?:an?\s+)?proxy\b|(?:假设性|虚构|编造|捏造|占位)(?:示例|证据|来源|研究|引用)|(?:近似|估算|假定|推断)(?:值|数字|样本量)|用[^。！？]{0,40}替代(?:要求的)?(?:方法|类别)|(?:无|没有)(?:具体)?引用(?:的)?(?:描述|结论|示例)/iu.test(text);
}

function isRequirementWeakeningDecision(text: string): boolean {
  return /\b(?:reduce|lower|decrease)\s+(?:the\s+)?(?:minimum|required)\b|\baccept\s+(?:a\s+report\s+with\s+)?fewer\s+than\s+(?:the\s+)?(?:minimum|required|\d+)\b|\b(?:drop|waive|remove|omit)\s+(?:the\s+)?(?:requirement|methodolog(?:y|ies)|citations?)\b|\baccept\s+(?:the\s+)?report\s+(?:as\s+is|with\s+(?:all\s+)?gaps?)\b|\bproceed\s+(?:to\s+final\s+output\s+)?(?:despite|without)\s+(?:the\s+)?(?:required|missing)\b|(?:降低|减少)(?:最低|必需|要求的)(?:数量|标准)|接受少于(?:最低|要求的|\d+)|(?:删除|放弃|省略)(?:要求|方法|引用)|接受(?:当前)?(?:带有|存在)?缺口的报告/iu.test(text);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(cleanText).filter(Boolean) : [];
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}
