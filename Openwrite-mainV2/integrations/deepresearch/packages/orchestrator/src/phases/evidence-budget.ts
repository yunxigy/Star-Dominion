import type { AgentNodePartPlan, ReportNode, ResearchRequirement, TaskItem } from "@deepresearch/contracts";
import { countedRowEvidenceTarget } from "../counted-rows.js";
import { explicitTablePartitionLabels } from "../rendered-contracts.js";
import type { PhaseContext } from "../types.js";
import { positiveOptional } from "./evidence-utils.js";

const MAX_EVIDENCE_RUNTIME_HISTORY_CHARS = 8_000;

const MAX_AGENT_NODE_PARTS = 3;

export function evidenceTaskRuntimeBudget(
  task: Pick<TaskItem, "acceptanceCriteria" | "plannedReportlets">,
  evidenceCfg: Partial<NonNullable<PhaseContext["state"]["runtimeProfile"]["agents"]["evidence"]>> | undefined,
) {
  const baseMaxReactSteps = Math.max(1, evidenceCfg?.maxReactSteps ?? 8);
  const baseMaxToolCalls = Math.max(1, evidenceCfg?.maxToolCalls ?? 16);
  const baseMaxSearchCalls = Math.max(1, evidenceCfg?.maxSearchCalls ?? 3);
  const baseMaxFetchCalls = Math.max(0, evidenceCfg?.maxFetchCalls ?? 3);
  const rowTarget = countedRowEvidenceTarget(task);
  if (!rowTarget) {
    const entityParts = task.plannedReportlets?.reduce((counts, part) => {
      const compound = (part.researchQuestion.match(/(?:实体章节与表格素材|entity\s+section\s+and\s+comparison\s+row)/giu) ?? []).length;
      const taxonomy = (part.researchQuestion.match(/(?:分类组成员行|taxonomy\s+group\s+member\s+rows)/giu) ?? []).length;
      const all = (part.researchQuestion.match(/(?:对比表行|比较表行|案例章节素材|实体章节与表格素材|分类组成员行|comparison\s+row|entity\s+profile|entity\s+section\s+and\s+comparison\s+row|taxonomy\s+group\s+member\s+rows)/giu) ?? []).length;
      return { all: counts.all + all, compound: counts.compound + compound, taxonomy: counts.taxonomy + taxonomy };
    }, { all: 0, compound: 0, taxonomy: 0 }) ?? { all: 0, compound: 0, taxonomy: 0 };
    const entityRowPartCount = entityParts.all;
    const taxonomyTaskCount = Math.max(entityParts.taxonomy, task.acceptanceCriteria.some((criterion) => (
      /(?:分类组|类别名称).{0,30}(?:不是|并非).{0,20}(?:最终行|表格行)|grouping\s+label[^.]{0,40}not\s+a\s+final\s+row/iu.test(criterion)
    )) ? 1 : 0);
    if (entityRowPartCount >= 2 || taxonomyTaskCount >= 1) {
      const ordinaryPartCount = Math.max(0, entityRowPartCount - entityParts.compound - entityParts.taxonomy);
      const targetSearchCalls = Math.max(1, entityParts.compound + taxonomyTaskCount + Math.ceil(ordinaryPartCount / 2));
      const targetFetchCalls = entityParts.compound * 2 + taxonomyTaskCount * 2 + ordinaryPartCount;
      const maxSearchCalls = Math.max(baseMaxSearchCalls, targetSearchCalls);
      const maxFetchCalls = Math.max(baseMaxFetchCalls, targetFetchCalls);
      const targetToolCalls = targetSearchCalls + targetFetchCalls;
      const maxToolCalls = Math.max(baseMaxToolCalls, targetToolCalls + 2);
      const maxReactSteps = Math.max(baseMaxReactSteps, maxToolCalls + 2);
      return {
        maxReactSteps,
        maxToolCalls,
        maxSearchCalls,
        maxFetchCalls,
        targetReactSteps: Math.min(maxReactSteps, Math.max(positiveOptional(evidenceCfg?.targetReactSteps) ?? 0, targetToolCalls + 1)),
        targetToolCalls: Math.min(maxToolCalls, Math.max(positiveOptional(evidenceCfg?.targetToolCalls) ?? 0, targetToolCalls)),
        targetSearchCalls: Math.min(maxSearchCalls, Math.max(positiveOptional(evidenceCfg?.targetSearchCalls) ?? 0, targetSearchCalls)),
        targetFetchCalls: Math.min(maxFetchCalls, Math.max(positiveOptional(evidenceCfg?.targetFetchCalls) ?? 0, targetFetchCalls)),
      };
    }
    const examplePartCount = task.plannedReportlets?.filter((part) => (
      /(?:必需叙事案例|required\s+narrative\s+example)/iu.test(part.researchQuestion)
    )).length ?? 0;
    if (examplePartCount >= 2) {
      const targetSearchCalls = Math.max(1, Math.ceil(examplePartCount / 2));
      const targetFetchCalls = examplePartCount;
      const maxSearchCalls = Math.max(baseMaxSearchCalls, targetSearchCalls);
      const maxFetchCalls = Math.max(baseMaxFetchCalls, targetFetchCalls);
      const targetToolCalls = targetSearchCalls + targetFetchCalls;
      const maxToolCalls = Math.max(baseMaxToolCalls, targetToolCalls + 2);
      const maxReactSteps = Math.max(baseMaxReactSteps, maxToolCalls + 2);
      return {
        maxReactSteps,
        maxToolCalls,
        maxSearchCalls,
        maxFetchCalls,
        targetReactSteps: Math.min(maxReactSteps, Math.max(positiveOptional(evidenceCfg?.targetReactSteps) ?? 0, targetToolCalls + 1)),
        targetToolCalls: Math.min(maxToolCalls, Math.max(positiveOptional(evidenceCfg?.targetToolCalls) ?? 0, targetToolCalls)),
        targetSearchCalls: Math.min(maxSearchCalls, Math.max(positiveOptional(evidenceCfg?.targetSearchCalls) ?? 0, targetSearchCalls)),
        targetFetchCalls: Math.min(maxFetchCalls, Math.max(positiveOptional(evidenceCfg?.targetFetchCalls) ?? 0, targetFetchCalls)),
      };
    }
    const temporalPartCount = task.plannedReportlets?.filter((part) => (
      /\b(?:19|20)\d{2}\s*[-–]\s*(?:19|20)\d{2}\b|\bpre[- ]?(?:19|20)\d{2}\b|(?:19|20)\d{2}.*(?:每年|逐年)|year[- ]by[- ]year/iu.test(part.researchQuestion)
    )).length ?? 0;
    if (temporalPartCount >= 2) {
      const maxSearchCalls = Math.max(baseMaxSearchCalls, temporalPartCount);
      const maxFetchCalls = Math.max(baseMaxFetchCalls, temporalPartCount * 2);
      const targetToolCalls = Math.max(positiveOptional(evidenceCfg?.targetToolCalls) ?? 0, maxSearchCalls + maxFetchCalls);
      const maxToolCalls = Math.max(baseMaxToolCalls, targetToolCalls + 2);
      const maxReactSteps = Math.max(baseMaxReactSteps, maxToolCalls + 2);
      return {
        maxReactSteps,
        maxToolCalls,
        maxSearchCalls,
        maxFetchCalls,
        targetReactSteps: Math.min(maxReactSteps, Math.max(positiveOptional(evidenceCfg?.targetReactSteps) ?? 0, targetToolCalls + 1)),
        targetToolCalls: Math.min(maxToolCalls, targetToolCalls),
        targetSearchCalls: Math.min(maxSearchCalls, Math.max(positiveOptional(evidenceCfg?.targetSearchCalls) ?? 0, temporalPartCount)),
        targetFetchCalls: Math.min(maxFetchCalls, Math.max(positiveOptional(evidenceCfg?.targetFetchCalls) ?? 0, temporalPartCount)),
      };
    }
    return {
      maxReactSteps: baseMaxReactSteps,
      maxToolCalls: baseMaxToolCalls,
      maxSearchCalls: baseMaxSearchCalls,
      maxFetchCalls: baseMaxFetchCalls,
      targetReactSteps: positiveOptional(evidenceCfg?.targetReactSteps),
      targetToolCalls: positiveOptional(evidenceCfg?.targetToolCalls),
      targetSearchCalls: positiveOptional(evidenceCfg?.targetSearchCalls),
      targetFetchCalls: positiveOptional(evidenceCfg?.targetFetchCalls),
    };
  }

  const globalRepair = isGlobalRowRepairAllocation(task);
  if (globalRepair) {
    const maxSearchCalls = Math.max(baseMaxSearchCalls, 2);
    const maxFetchCalls = Math.max(baseMaxFetchCalls, Math.min(rowTarget, 4));
    const targetToolCalls = Math.min(baseMaxToolCalls, Math.max(positiveOptional(evidenceCfg?.targetToolCalls) ?? 0, rowTarget + 1));
    const maxToolCalls = Math.max(baseMaxToolCalls, targetToolCalls + 2);
    const maxReactSteps = Math.max(baseMaxReactSteps, maxToolCalls + 2);
    return {
      maxReactSteps,
      maxToolCalls,
      maxSearchCalls,
      maxFetchCalls,
      targetReactSteps: Math.min(maxReactSteps, Math.max(positiveOptional(evidenceCfg?.targetReactSteps) ?? 0, targetToolCalls + 1)),
      targetToolCalls,
      targetSearchCalls: Math.min(maxSearchCalls, Math.max(positiveOptional(evidenceCfg?.targetSearchCalls) ?? 0, 1)),
      targetFetchCalls: Math.min(maxFetchCalls, Math.max(positiveOptional(evidenceCfg?.targetFetchCalls) ?? 0, Math.min(rowTarget, 3))),
    };
  }
  const searchTarget = globalRepair
    ? Math.min(rowTarget, 4)
    : Math.max(1, Math.ceil(rowTarget / 3));
  const maxSearchCalls = Math.max(baseMaxSearchCalls, searchTarget);
  const fetchTarget = globalRepair ? rowTarget * 2 : rowTarget;
  const maxFetchCalls = Math.max(baseMaxFetchCalls, fetchTarget);
  const targetToolFloor = rowTarget + fetchTarget + searchTarget;
  const maxToolCalls = Math.max(baseMaxToolCalls, targetToolFloor + 2);
  const targetToolCalls = Math.min(maxToolCalls, Math.max(positiveOptional(evidenceCfg?.targetToolCalls) ?? 0, targetToolFloor));
  const maxReactSteps = Math.max(baseMaxReactSteps, maxToolCalls + 2);
  return {
    maxReactSteps,
    maxToolCalls,
    maxSearchCalls,
    maxFetchCalls,
    targetReactSteps: Math.min(maxReactSteps, Math.max(positiveOptional(evidenceCfg?.targetReactSteps) ?? 0, targetToolCalls + 1)),
    targetToolCalls,
    targetSearchCalls: Math.min(maxSearchCalls, Math.max(positiveOptional(evidenceCfg?.targetSearchCalls) ?? 0, searchTarget)),
    targetFetchCalls: Math.min(maxFetchCalls, Math.max(positiveOptional(evidenceCfg?.targetFetchCalls) ?? 0, fetchTarget)),
  };
}

export function evidenceRuntimeHistoryMaxChars(contextTokenLimit = 64_000): number {
  // ReAct resends its complete history on every turn. Keep enough detail for the
  // latest fetched source while compacting older pages to stable IDs and URLs,
  // otherwise a few PDF fetches multiply into hundreds of thousands of tokens.
  return Math.max(2_048, Math.min(MAX_EVIDENCE_RUNTIME_HISTORY_CHARS, Math.floor(contextTokenLimit) * 4));
}

function maxAgentNodeParts(ctx: PhaseContext, requirements: ResearchRequirement[] = []): number {
  const configured = ctx.state.runtimeProfile.debug?.maxAgentNodeParts;
  if (typeof configured === "number" && Number.isFinite(configured)) {
    return Math.max(1, Math.floor(configured));
  }
  const substantive = requirements.filter((requirement) => (
    requirement.evidenceRequired !== false && requirement.visibility !== "internal"
  ));
  if (substantive.length !== 1) return MAX_AGENT_NODE_PARTS;
  const requirement = substantive[0]!;
  const text = [requirement.description, ...requirement.successCriteria].join(" ");
  const structured = countedRowEvidenceTarget({ acceptanceCriteria: requirement.successCriteria })
    || (requirement.entityScope?.filter((item) => item.trim()).length ?? 0) >= 2
    || (requirement.exampleScope?.filter((item) => item.trim()).length ?? 0) >= 2
    || (requirement.metricScope?.filter((item) => item.trim()).length ?? 0) >= 2
    || /(?:每年|逐年|年度|year[- ]by[- ]year|each\s+year)/iu.test(text);
  return structured ? MAX_AGENT_NODE_PARTS : 1;
}

export function agentNodePartPlans(
  task: TaskItem,
  reportNode: ReportNode,
  maxParts = MAX_AGENT_NODE_PARTS,
  language = "zh-CN",
  requirements: ResearchRequirement[] = [],
): AgentNodePartPlan[] {
  if (task.taskId.startsWith("T_part_") || task.plannedReportlet) return [];
  const rowTarget = countedRowEvidenceTarget(task);
  if (rowTarget) {
    const parts = Array.from({ length: Math.min(rowTarget, maxParts) }, (_, index) => (
      `Study row ${index + 1} of ${rowTarget}: identify one distinct eligible primary study not used by another row and extract every requested table field.`
    ));
    return buildPartPlans(task, reportNode, parts, language).map((part) => ({
      ...part,
      searchGoal: language.startsWith("zh")
        ? `为“${part.researchQuestion}”查找一项独立且合格的原始研究。严格遵循任务目标“${task.objective}”，如果任务允许任意地区，不要继承父节点的地区限制。`
        : `Find one distinct eligible primary study for "${part.researchQuestion}". Follow the task objective exactly: "${task.objective}". If the task allows any geography, do not inherit a geographic restriction from the parent report node.`,
      writingGoal: language.startsWith("zh")
        ? `为该槽位写一行可复用、带精确引用的完整研究记录，包含任务要求的每个字段。`
        : "Write one reusable, precisely cited complete study row for this slot, including every field requested by the task.",
    }));
  }
  if (/^(T_writer_repair_|T_publish_repair_)/.test(task.taskId)) return [];
  const repairTask = /^(T_reflect_|T_gap_|T_repair_|T_completion_)/.test(task.taskId);
  if (!repairTask || task.objective.includes("[quality:incomplete_entity_coverage]")) {
    const entityFieldParts = entityFieldReportletParts(task, reportNode, requirements, maxParts, language);
    if (entityFieldParts.length >= 2) return buildPartPlans(task, reportNode, entityFieldParts, language);
  }
  const text = [
    task.title,
    task.objective,
    ...task.acceptanceCriteria,
    reportNode.label,
    reportNode.scopeNote,
    reportNode.hypothesis?.statement,
    reportNode.hypothesis?.researchBrief,
  ].filter(Boolean).join("\n");
  // Broad follow-up evidence tasks must retain the same temporal decomposition as
  // their original task. Otherwise a repair for an annual series or event timeline
  // falls back to one oversized query and repeats the failure that triggered it.
  // Writer/publish repairs and repairs already scoped to one planned reportlet
  // remain atomic because subdividing those would change their target.
  const temporalParts = temporalReportletParts(text, task, reportNode, maxParts, language);
  if (temporalParts.length >= 2) return buildPartPlans(task, reportNode, temporalParts, language);
  const timelineParts = timelineReportletParts(text, task, reportNode, maxParts, language);
  if (timelineParts.length >= 2) return buildPartPlans(task, reportNode, timelineParts, language);
  if (repairTask) return [];
  const narrativeExampleParts = narrativeExampleReportletParts(requirements, maxParts, language);
  if (narrativeExampleParts.length >= 2) return buildPartPlans(task, reportNode, narrativeExampleParts, language);
  const criteriaParts = task.acceptanceCriteria
    .map((item) => cleanPart(item))
    .filter((item) => item && !isGenericAcceptanceCriterion(item));
  if (criteriaParts.length >= 3) return buildPartPlans(task, reportNode, boundedParts(uniqueParts(criteriaParts), maxParts), language);

  if (!looksLikeBroadAgentTask(text)) return [];
  const enumerated = extractEnumeratedParts(text);
  return buildPartPlans(task, reportNode, boundedParts(uniqueParts(enumerated), maxParts), language);
}

function narrativeExampleReportletParts(
  requirements: ResearchRequirement[],
  maxParts: number,
  language: string,
): string[] {
  if (maxParts < 2) return [];
  const seen = new Set<string>();
  const examples = requirements.flatMap((requirement) => (requirement.exampleScope ?? []).flatMap((example) => {
    const normalized = example.replace(/\s+/gu, " ").trim();
    const key = normalized.normalize("NFKC").toLocaleLowerCase();
    if (!key || seen.has(key)) return [];
    seen.add(key);
    return [{ example: normalized, requirement: requirement.description }];
  }));
  if (examples.length < 2) return [];
  const chinese = language.startsWith("zh");
  const parts = examples.map(({ example, requirement }) => chinese
    ? `分析必需叙事案例“${example}”，以回答：${requirement}。查找并引用该案例自身的证据，解释其独特事实、角色、机制及其与上层分析的关系；不得用另一个点名案例替代，并保持叙事分析而非强制结构化成行。`
    : `Analyze required narrative example "${example}" for: ${requirement}. Find and cite evidence specific to this example; explain its distinct facts, actors, mechanism, and relevance to the broader requirement. Do not substitute another named example, and keep the treatment narrative rather than forcing a structured row.`);
  return boundedParts(parts, maxParts);
}

function temporalReportletParts(
  text: string,
  task: TaskItem,
  reportNode: ReportNode,
  maxParts: number,
  language: string,
): string[] {
  if (maxParts < 2 || !/(?:每年|逐年|年度|年均|yearly|annually|each\s+year|year[- ]by[- ]year)/iu.test(text)) return [];
  const years = Array.from(text.matchAll(/\b(20\d{2})\b/gu), (match) => Number(match[1]))
    .filter((year) => year >= 2000 && year <= 2099);
  if (years.length < 2) return [];
  const min = Math.min(...years);
  const max = Math.max(...years);
  const span = max - min + 1;
  if (span < 4) return [];
  const partCount = Math.min(maxParts, Math.max(2, Math.ceil(span / 4)));
  const chunkSize = Math.ceil(span / partCount);
  const chinese = language.startsWith("zh");
  const scope = [reportNode.label, reportNode.scopeNote, task.title]
    .filter(Boolean)
    .join("；");
  const parts: string[] = [];
  for (let start = min; start <= max; start += chunkSize) {
    const end = Math.min(max, start + chunkSize - 1);
    parts.push(chinese
      ? `逐年核验${start}-${end}年：${scope}。只负责该时间窗口内的年度数据、单位和来源，不延伸到其他年份。`
      : `Verify ${start}-${end} year by year for: ${scope}. Cover only annual data, units, and sources in this time window; do not broaden to other years.`);
  }
  return parts;
}

function timelineReportletParts(
  text: string,
  task: TaskItem,
  reportNode: ReportNode,
  maxParts: number,
  language: string,
): string[] {
  if (maxParts < 2 || !looksLikeChronologicalTimeline(text) || looksLikeResearchCorpusWindow(text)) return [];
  const range = explicitTimelineRange(text);
  if (!range || range.end - range.start + 1 < 6) return [];
  const years = Array.from(text.matchAll(/\b((?:19|20)\d{2})\b/gu), (match) => Number(match[1]));
  const priorYears = uniqueNumbers(years.filter((year) => year < range.start));
  const includeFoundation = /(?:此前|之前|既有|先前|早于|前置|早期(?:法规|法律|制度|定义|承诺)|前期(?:法规|法律|制度|定义|承诺)|previous|prior|before|earlier|pre-existing)/iu.test(text);
  const mainPartLimit = Math.max(1, maxParts - (includeFoundation ? 1 : 0));
  const span = range.end - range.start + 1;
  const mainPartCount = Math.min(mainPartLimit, Math.max(2, Math.ceil(span / 4)));
  const chunkSize = Math.ceil(span / mainPartCount);
  const chinese = language.startsWith("zh");
  const scope = [reportNode.label, reportNode.scopeNote, task.title]
    .filter(Boolean)
    .join("；");
  const parts: string[] = [];
  if (includeFoundation) {
    const namedEarlierYears = priorYears.length > 0
      ? chinese ? `（任务明确提及：${priorYears.join("、")}年）` : ` (explicitly named earlier year(s): ${priorYears.join(", ")})`
      : "";
    parts.push(chinese
      ? `核验${range.start}年前的前置制度基础${namedEarlierYears}：${scope}。只追踪任务要求关联的早期法规、定义或承诺，以及它们与主时间线的关系；不要扩展成无关通史。`
      : `Verify pre-${range.start} foundations${namedEarlierYears} for: ${scope}. Trace only earlier laws, definitions, or commitments the task asks to relate to the main timeline; do not broaden into unrelated history.`);
  }
  for (let start = range.start; start <= range.end; start += chunkSize) {
    const end = Math.min(range.end, start + chunkSize - 1);
    parts.push(chinese
      ? `按时间顺序核验${start}-${end}年的关键节点：${scope}。提取有具体日期和引用的政策、法规、官方声明、重大事件、相关数据及阶段转折；不要求每年都有事件。`
      : `Trace ${start}-${end} chronologically for: ${scope}. Extract specifically dated and cited policies, regulations, official statements, significant events, relevant data, and transitions; do not require an event in every year.`);
  }
  return parts.slice(0, maxParts);
}

function entityFieldReportletParts(
  task: TaskItem,
  reportNode: ReportNode,
  requirements: ResearchRequirement[],
  maxParts: number,
  language: string,
): string[] {
  if (maxParts < 2) return [];
  const structured = requirements.filter((requirement) => (
    (requirement.entityScope ?? []).filter((value) => value.trim()).length >= 2
    && (requirement.metricScope ?? []).filter((value) => value.trim()).length >= 2
    && /(?:表格|对比|比较|案例|逐个|每个|每一(?:个|类|种)|分别|章节|档案|画像|table|compare|comparison|case\s+stud|for\s+each|each\s+(?:company|product|case|entity|category|class|material)|section|profile)/iu.test([
      requirement.description,
      ...requirement.successCriteria,
    ].join(" "))
  ));
  if (structured.length === 0) return [];
  const scopeText = [task.title, task.objective, ...task.acceptanceCriteria, reportNode.label, reportNode.scopeNote]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
  const chinese = language.startsWith("zh");
  const groups = groupEntityFieldRequirements(structured).map((group) => ({
    ...group,
    mentioned: group.entities.filter((entity) => entityAliases(entity).some((alias) => scopeText.includes(alias))),
  }));
  const anyMentioned = groups.some((group) => group.mentioned.length > 0);
  const rows = groups
    .filter((group) => !anyMentioned || group.mentioned.length > 0)
    .flatMap((group) => {
      const selected = group.mentioned.length > 0 ? group.mentioned : group.entities;
      const requirementText = group.requirements.flatMap((requirement) => [requirement.description, ...requirement.successCriteria]).join(" ");
      const tableLike = /(?:表格|对比表|比较表|table|matrix)/iu.test(requirementText);
      const profileLike = /(?:(?:分成|分为).{0,16}(?:部分|章节|小节)|(?:每个|每一(?:个|类|种)|逐个|分别|各(?:个|类)?).{0,18}(?:介绍|说明|分析|讨论|详述|展开)|独立.{0,8}(?:章节|小节)|案例(?:章节|研究|分析)|divide.{0,24}into.{0,12}(?:parts?|sections?)|for\s+each.{0,30}(?:explain|describe|analy[sz]e|discuss|section)|each\s+(?:company|product|case|entity|category|class|material).{0,24}(?:explain|describe|analy[sz]e|discuss|section)|separate\s+subsections?|separate\s+sections?|subsection\s+for\s+(?:each|every)|section\s+for\s+(?:each|every)|case\s+stud(?:y|ies)|entity\s+profiles?)/iu.test(requirementText);
      const taxonomyGroup = group.scopeRole === "groups";
      const fieldList = group.fields.join(chinese ? "、" : ", ");
      const partitions = explicitTablePartitionLabels(requirementText);
      const partitionSuffix = partitions
        ? chinese
          ? ` 另需根据直接证据将该实体恰好归入一个表格分区（${partitions.join("、")}）；在报告片段中保留判定依据，但除非用户要求，不要把分区重复成数据列。`
          : ` Also use direct evidence to assign this entity to exactly one table partition (${partitions.join(", ")}); preserve the classification basis in the reportlet, but do not duplicate it as a data column unless requested.`
        : "";
      return selected.map((entity) => {
        const row = taxonomyGroup
        ? chinese
          ? `完成“${entity}”分类组成员行：先从权威清单、标准、官方资料或一手研究中发现多个具体命名成员，核验每个成员确属该组并去重别名；再为每个成员逐字段填写 ${fieldList}。类别名称本身不是最终行，不得虚构成员数量或用一个成员的值代替另一个成员。`
          : `Complete taxonomy group member rows for "${entity}": first discover multiple concrete named members from authoritative inventories, standards, official references, or primary literature; verify membership and deduplicate aliases, then fill every field (${fieldList}) for each member. The group label is not a final row; do not invent a member quota or substitute one member's values for another.`
        : tableLike && profileLike
        ? chinese
          ? `完成“${entity}”的实体章节与表格素材：逐项核验并覆盖 ${fieldList}。先形成可独立成章的解释、实例、量化指标与边界，再给出同一实体的简洁总结表行；两种渲染必须共享直接支撑各事实的引用。`
          : `Complete the entity section and comparison row for "${entity}": verify every dimension (${fieldList}). Provide reusable narrative explanation, examples, quantitative evidence, and boundaries for its own section, plus a concise row derived from the same cited facts.`
        : tableLike
          ? chinese
            ? `完成“${entity}”的对比表行：逐字段核验并填写 ${fieldList}。保留明确的分类值（如内置、额外库、不支持、不适用），每个事实只使用直接支撑它的引用，不得用同一行其他字段代替。`
            : `Complete the comparison row for "${entity}": verify and fill every field (${fieldList}). Preserve explicit categorical values such as built in, additional library, unsupported, or not applicable; cite each fact directly and do not substitute a neighboring field.`
          : chinese
            ? `完成“${entity}”的案例章节素材：逐项核验并覆盖 ${fieldList}。保留具体量化成果和边界条件，每个事实只使用直接支撑它的引用，供上层写作独立成章。`
            : `Complete the entity profile for "${entity}": verify and cover every dimension (${fieldList}). Preserve quantitative outcomes and boundaries, cite every fact directly, and provide material for its own final section.`;
        return `${row}${partitionSuffix}`;
      });
    });
  if (rows.length === 0) return [];
  return boundedParts(rows, maxParts);
}

function groupEntityFieldRequirements(requirements: ResearchRequirement[]): Array<{
  requirements: ResearchRequirement[];
  entities: string[];
  fields: string[];
  scopeRole: ResearchRequirement["entityScopeRole"];
}> {
  const groups = new Map<string, { requirements: ResearchRequirement[]; entities: string[]; fields: string[]; scopeRole: ResearchRequirement["entityScopeRole"] }>();
  for (const requirement of requirements) {
    const entities = uniqueParts((requirement.entityScope ?? []).map(cleanPart).filter(Boolean));
    const fields = uniqueParts((requirement.metricScope ?? []).map(cleanPart).filter(Boolean));
    if (entities.length < 2 || fields.length < 2) continue;
    const scopeRole = requirement.entityScopeRole ?? "members";
    const key = `${scopeRole}\u0001${entities
      .map((entity) => entityAliases(entity).sort((left, right) => left.length - right.length || left.localeCompare(right))[0] ?? entity.toLocaleLowerCase())
      .sort()
      .join("\u0000")}`;
    const group = groups.get(key);
    if (group) {
      group.requirements.push(requirement);
      group.entities = uniqueParts([...group.entities, ...entities]);
      group.fields = uniqueParts([...group.fields, ...fields]);
    } else {
      groups.set(key, { requirements: [requirement], entities, fields, scopeRole });
    }
  }
  return Array.from(groups.values());
}

function entityAliases(entity: string): string[] {
  const withoutParenthetical = entity.replace(/[（(][^（）()]+[）)]/gu, " ");
  const categoryStem = withoutParenthetical
    .replace(/^\s*基于/gu, "")
    .replace(/(?:的)?(?:阻挡层|材料类别|候选材料|材料|类别|技术|方案)\s*$/gu, "")
    .trim();
  const values = [entity, withoutParenthetical, categoryStem];
  for (const match of entity.matchAll(/[（(]([^（）()]+)[）)]/gu)) values.push(match[1] ?? "");
  return uniqueParts(values
    .flatMap((value) => value.split(/[/／]/u))
    .map((value) => value.replace(/\s+/gu, " ").trim().toLocaleLowerCase())
    .filter((value) => value.length >= 2));
}

function looksLikeChronologicalTimeline(text: string): boolean {
  return /(?:时间线|时间轴|时间顺序|按时间|历程|演变|沿革|里程碑|关键节点|重大事件|政策变化|政策变迁|chronolog(?:y|ical|ically)|timeline|milestones?|key\s+events?|policy\s+(?:changes|development|evolution))/iu.test(text);
}

function looksLikeResearchCorpusWindow(text: string): boolean {
  return /(?:stud(?:y|ies)|research|literature|trial(?:s)?|article(?:s)?|paper(?:s)?|publication(?:s)?)\s+(?:published\s+|conducted\s+)?(?:from|between|during|spanning)\s+(?:19|20)\d{2}/iu.test(text)
    || /(?:19|20)\d{2}\s*年?\s*(?:至|到|[-–—])\s*(?:19|20)\d{2}\s*年?(?:间|期间)?(?:所)?(?:发表|发布|开展|进行|完成|收录)?(?:的)?(?:实证)?(?:研究|文献|试验|论文)/u.test(text);
}

function explicitTimelineRange(text: string): { start: number; end: number } | undefined {
  const direct = text.match(/(?:from\s+)?((?:19|20)\d{2})\s*年?\s*(?:至|到|[-–—]|through|to)\s*(?:the\s+end\s+of\s+)?((?:19|20)\d{2})\s*年?/iu);
  const between = text.match(/between\s+((?:19|20)\d{2})\s+and\s+((?:19|20)\d{2})/iu);
  const match = direct ?? between;
  if (!match?.[1] || !match[2]) return undefined;
  const start = Number(match[1]);
  const end = Number(match[2]);
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start <= end && end - start <= 100
    ? { start, end }
    : undefined;
}

function uniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values)).sort((a, b) => a - b);
}

function isGlobalRowRepairAllocation(task: Pick<TaskItem, "acceptanceCriteria">): boolean {
  return task.acceptanceCriteria.some((criterion) => /\bglobal repair allocation\b/iu.test(criterion));
}

function buildPartPlans(task: TaskItem, reportNode: ReportNode, parts: string[], language: string): AgentNodePartPlan[] {
  return parts.map((part, index) => {
    const expectedHeading = inferExpectedHeading(part, reportNode);
    return {
      partId: `P_${index + 1}`,
      parentAgentTaskId: task.taskId,
      parentReportNodeId: reportNode.nodeId,
      researchQuestion: part,
      searchGoal: inferSearchGoal(part, task, reportNode, language),
      writingGoal: inferWritingGoal(part, task, reportNode, language),
      expectedHeading,
      evidenceNeeds: inferEvidenceNeeds(part, language),
    };
  });
}

function inferExpectedHeading(part: string, reportNode: ReportNode): string {
  const cleaned = cleanPart(part)
    .replace(/^(解释|分析|讨论|描述|明确|提供|比较|说明)/u, "")
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 60) : reportNode.label;
}

function inferSearchGoal(part: string, task: TaskItem, reportNode: ReportNode, language: string): string {
  return language.startsWith("zh")
    ? `查找能够直接支撑或限定“${part}”的资料，优先匹配上级 agent 节点“${reportNode.label}”和任务“${task.title}”的范围。`
    : `Find sources that directly support or qualify "${part}" within the scope of report node "${reportNode.label}" and task "${task.title}".`;
}

function inferWritingGoal(part: string, task: TaskItem, reportNode: ReportNode, language: string): string {
  return language.startsWith("zh")
    ? `写成一个可直接并入“${reportNode.label}”的小报告片段：回答“${part}”，说明机制或事实，并只引用本部分实际保存/关联的资料。`
    : `Write a reusable reportlet for "${reportNode.label}" that answers "${part}", explains the relevant facts or mechanism, and cites only evidence saved or linked for this part.`;
}

function inferEvidenceNeeds(part: string, language: string): string[] {
  const chinese = language.startsWith("zh");
  const needs = chinese
    ? ["直接相关的权威或高质量来源", "支撑核心断言的具体事实、数据、机制或案例"]
    : ["Directly relevant authoritative or high-quality sources", "Specific facts, data, mechanisms, or cases supporting the core claim"];
  if (/(数据|百分比|收入|面积|年份|增长率|总额|元|万亿|data|percent|rate|range|cost|year|\d)/iu.test(part)) {
    needs.push(chinese ? "可核验的数据点和年份口径" : "Verifiable data points, ranges, units, and dates");
  }
  if (/(定义|什么是|概念|definition|concept)/iu.test(part)) needs.push(chinese ? "定义或概念来源" : "A source defining the relevant concept");
  if (/(机制|为何|如何|导致|影响|挤出|固化|mechanism|cause|impact|effect)/iu.test(part)) needs.push(chinese ? "因果机制解释来源" : "A source explaining the causal or technical mechanism");
  if (/(案例|东莞|华为|例子|case|example)/iu.test(part)) needs.push(chinese ? "具体案例来源" : "A concrete case or example source");
  return uniqueParts(needs).slice(0, 5);
}

function boundedParts(parts: string[], maxParts: number): string[] {
  if (parts.length <= maxParts) return parts;
  const chinese = parts.some((part) => /\p{Script=Han}/u.test(part));
  if (maxParts <= 1) return [chinese ? `合并覆盖以下全部要求：${parts.join("；")}` : `Cover all of these requirements together: ${parts.join("; ")}`];
  const bucketCount = Math.min(maxParts, parts.length);
  const baseSize = Math.floor(parts.length / bucketCount);
  const remainder = parts.length % bucketCount;
  const buckets: string[] = [];
  let cursor = 0;
  for (let index = 0; index < bucketCount; index += 1) {
    const size = baseSize + (index < remainder ? 1 : 0);
    const group = parts.slice(cursor, cursor + size);
    cursor += size;
    if (group.length === 1) {
      buckets.push(group[0]!);
      continue;
    }
    buckets.push(chinese
      ? `合并覆盖第${index + 1}组要求：${group.join("；")}`
      : `Cover requirement group ${index + 1} together: ${group.join("; ")}`);
  }
  return buckets;
}

function looksLikeBroadAgentTask(text: string): boolean {
  if (/(至少|包括|涵盖|分别|多个|三个方面|两种|四种|比较表|机制|后果|影响|困境|转型|定义|解释|分析|讨论)/u.test(text) && /[、；;:：]/u.test(text)) return true;
  if (/\b(include|including|cover|at least|three|four|compare|mechanism|impact|definition|explain|analyze)\b/i.test(text) && /[,;:]/.test(text)) return true;
  return text.length > 260 && /[、；;]/u.test(text);
}

function extractEnumeratedParts(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\n+/)) {
    const numbered = line.match(/(?:^|[。；;])\s*(?:\d+[.、)]|[一二三四五六七八九十]+[、.])\s*([^。；;\n]+)/gu);
    if (numbered) {
      for (const item of numbered) out.push(cleanPart(item.replace(/^(?:[。；;]\s*)?(?:\d+[.、)]|[一二三四五六七八九十]+[、.])\s*/u, "")));
    }
  }
  const focused = text.match(/(?:包括|涵盖|至少涵盖|涉及|分为|分别是|namely|including|covers?|include)([^。.\n]{12,240})/iu)?.[1] ?? text;
  const split = focused
    .replace(/以及|并且|同时|还有|和(?=[^和]{2,24}(?:、|；|;|$))/gu, "、")
    .replace(/\band\b/giu, ",")
    .split(/[、；;,，]/u)
    .map((item) => cleanPart(item))
    .filter((item) => item.length >= 4 && item.length <= 90);
  out.push(...split);
  return out.filter((item) => item && !isGenericAcceptanceCriterion(item));
}

function cleanPart(value: string): string {
  return value
    .replace(/^[\s"'“”‘’`，,。；;:：、\-–—]+/u, "")
    .replace(/[\s"'“”‘’`，,。；;:：、\-–—]+$/u, "")
    .replace(/^(?:请|需要|必须|应|需|and|or)\s*/iu, "")
    .trim();
}

function isGenericAcceptanceCriterion(value: string): boolean {
  return [
    /^(find|save|link|record|collect|search)\b/i,
    /^保存证据/u,
    /^查找证据/u,
    /^记录/u,
    /^至少一个可信/u,
    /^Inspect at least one full authoritative or primary source\b/i,
    /^Corroborate consequential claims with an independent source\b/i,
    /^Find supporting or contradicting evidence\.?$/i,
    /^Find evidence\.?$/i,
    /^Save evidence\.?$/i,
  ].some((pattern) => pattern.test(value.trim()));
}

function uniqueParts(parts: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const key = part.toLowerCase().replace(/\s+/g, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(part);
  }
  return out;
}

function localizeEvidenceSummary(summary: string, language: string, stats: {
  knowledgeNodeCount: number;
  evidenceLinkCount: number;
  openGapCount: number;
  nodeStatus: ReportNode["status"];
}): string {
  if (!language.startsWith("zh")) return summary;
  const translated = summary
    .replace(/^Gathered\s+(\d+)\s+credible sources?\s+on\s+([^,，.。]+)[,，]?\s*/i, "已收集 $1 个关于 $2 的可信来源，")
    .replace(/^Found\s+two\s+credible sources?:?\s*/i, "已找到两个可信来源：")
    .replace(/^Found\s+(\d+)\s+credible sources?:?\s*/i, "已找到 $1 个可信来源：")
    .replace(/^The\s+14th\s+Five-Year Plan\s+\(2021-2025\)\s+explicitly states that\s+/i, "《“十四五”规划纲要（2021-2025）》明确指出，")
    .replace(/^Evidence agent stopped after reaching runtime budget\.\s*/i, "子代理到达运行预算后停止。")
    .replace(/^Using partial evidence collected before the limit\./i, "已保留预算耗尽前收集到的部分证据。")
    .replace(/^No saved evidence was available before the limit\./i, "预算耗尽前没有保存可用证据。")
    .replace(/Kept\s+(\d+)\s+evidence node\(s\) collected before the budget limit\./gi, "已保留预算耗尽前收集到的 $1 个证据节点。")
    .replace(/official party history sites/gi, "官方党史网站")
    .replace(/academic articles/gi, "学术文章")
    .replace(/confirming its core contribution/gi, "确认其核心贡献")
    .replace(/which states that/gi, "其中指出")
    .trim();
  if (!looksMostlyEnglish(translated)) return translated;
  const statusText: Record<string, string> = {
    supported: "已支持",
    partially_supported: "部分支持",
    contradicted: "存在反证",
    insufficient_evidence: "证据不足",
    downplayed: "已降级处理",
    planned: "待研究",
    researching: "研究中",
    needs_review: "待审查",
    needs_repair: "待修复",
    pruned: "已剪枝",
  };
  return `子代理完成本任务：保存 ${stats.knowledgeNodeCount} 个资料节点，关联 ${stats.evidenceLinkCount} 条证据，节点状态为${statusText[stats.nodeStatus] ?? stats.nodeStatus}。${stats.openGapCount > 0 ? `仍记录 ${stats.openGapCount} 个待补证缺口。` : "未新增待补证缺口。"}`;
}

function looksMostlyEnglish(value: string): boolean {
  const letters = value.match(/[A-Za-z]/g)?.length ?? 0;
  const cjk = value.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  return letters > 24 && letters > cjk * 1.5;
}

export { MAX_AGENT_NODE_PARTS, localizeEvidenceSummary, maxAgentNodeParts };
