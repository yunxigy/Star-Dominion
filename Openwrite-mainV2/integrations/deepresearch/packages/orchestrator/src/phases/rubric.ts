import type { GlobalRubric, ResearchRequirement, TaskItem } from "@deepresearch/contracts";
import { isExplicitTestLlm } from "../infra/ai.js";
import { isoNow } from "../infra/ids.js";
import { parseJsonObject } from "../infra/json.js";
import { RUBRIC_SYSTEM_PROMPT } from "../prompts.js";
import { explicitComparisonDimensions, explicitNestedSectionGroups, explicitTableColumns, explicitTableCount, explicitTablePartitionLabels, explicitTopLevelSectionNames } from "../rendered-contracts.js";
import { isGlobalTemporalRequirement, isGlobalTemporalText } from "../requirement-temporal.js";
import { traceWrite, tracedLlmChat } from "../trace.js";
import { inferRequirementFailurePolicy, inferRequirementVisibility } from "../requirement-policy.js";
import type { PhaseContext, RubricJson } from "../types.js";

export async function rubricPhase(ctx: PhaseContext): Promise<GlobalRubric> {
  const llmCfg = ctx.state.runtimeProfile.llm.rubric;
  if (!llmCfg) throw new Error("rubric LLM config required");
  const submission = ctx.state.submission;
  const userPrompt = `Build GlobalRubric JSON for this task.

User input:
${submission.userInput}

Research execution date:
${new Date(ctx.now()).toISOString().slice(0, 10)}
Interpret "current", "latest", "recent", and relative dates against this date.

UI options:
${JSON.stringify(submission.uiOptions ?? {})}

Output schema:
{"rubricText":string,"outputHints":{"titleHint":string,"language":string,"citationRequired":boolean,"format":"markdown"},"researchQuestionHints":string[],"requirements":[{"requirementId":string,"description":string,"kind":"question"|"constraint"|"comparison"|"deliverable"|"risk","priority":"must"|"should"|"exploratory","evidenceRequired":boolean,"evidenceNeeds":string[],"successCriteria":string[],"failurePolicy":"degrade"|"block","visibility":"reader"|"internal","temporalScope":{"mode":"current"|"historical"|"as_of"|"range"|"timeless","basis":"source_publication"|"covered_period","asOf":string|null,"start":string|null,"end":string|null,"maxAgeDays":number|null,"exemptSources":[{"title":string,"aliases":string[],"identifiers":string[]}]},"geographicScope":string[],"entityScope":string[],"entityScopeRole":"members"|"groups","exampleScope":string[],"metricScope":string[]}]}

Requirement rules:
- Decompose every explicit user constraint and major research question into a separately testable requirement.
- Use priority=must for anything whose omission would make the answer fail the request.
- Make successCriteria observable in the final report; avoid vague criteria such as "be comprehensive".
- Do not invent counts, minimum numbers of reasons/sources/citations, word limits, recency windows, dates, geographies, entities, fields, examples, or coverage thresholds that the user did not state. Qualitative words such as "brief", "compare", or "current" do not authorize a made-up numeric threshold.
- When the user does not request current/latest/recent information or give a date boundary, use temporalScope.mode="timeless" with maxAgeDays=null. Named sources keep their real publication dates but do not create an implicit freshness requirement.
- Mark time-sensitive requirements as current/as_of/range and provide maxAgeDays when freshness matters.
- Preserve month/day boundary semantics exactly, including both endpoints of ranges: "before March 2025" is exclusive and ends on 2025-02-28, "through March 2025" is inclusive and ends on 2025-03-31, and "from January 2020 to August 2023" runs from 2020-01-01 through 2023-08-31. Do not round these phrases to whole years.
- Normalize qualified year periods consistently: "early YEAR"/Q1/"年初" ends March 31, "mid YEAR"/Q2/first half/"上半年" ends June 30, Q3 ends September 30, and late YEAR/Q4/second half ends December 31.
- Set temporalScope.basis=source_publication when the user limits eligible studies, papers, literature, academic perspectives, or other sources by publication date. Set basis=covered_period when the limit concerns the events, measurements, policies, or conditions described; a later source may then be valid only if it explicitly covers the requested period.
- When the user explicitly requires a named source that falls outside the otherwise applicable time boundary, add one temporalScope.exemptSources object with its title and only unambiguous official-language aliases/stable identifiers. Keep localized and official titles as aliases of one source, not separate exceptions. Do not weaken the boundary for unnamed sources or invent an exception.
- For a table, structured comparison, or repeated case-study/profile/category section with explicitly named subjects, list their exact names in entityScope (for example product, company, material class, city, framework, or named study) and set entityScopeRole="members". When the user says "the following N countries/products/etc.", preserve all N names in order and attach them to the requirement that produces their rows or profiles. Do not put answer values in entityScope.
- For tables, comparisons, or repeated profiles/categories with multiple requested fields, list the exact field/column/dimension names in metricScope, including categorical fields such as architecture, core advantage, challenge, or built-in support. Do not put units or entities in metricScope.
- When the user explicitly requires named narrative cases, figures, stories, incidents, or examples inside a broader analysis, preserve their exact names in exampleScope. These are cited coverage obligations, not entityScope rows/profiles; do not use exampleScope for optional examples supplied only by the model.
- For an open taxonomy whose members must be discovered (for example, common items organized under requested top-level categories), keep only those top-level groups in entityScope, set entityScopeRole="groups", and put any user-named required members in successCriteria. Do not mix parent categories and their members as peer entities. If the named categories themselves are the requested comparison rows/profiles, use entityScopeRole="members" instead.
- If the same named subjects require both detailed sections and a summary table, preserve both renderings in the requirement description/successCriteria and reuse the same entityScope; do not collapse the obligation into table-only output.
- When the user explicitly frames two analytical perspectives with "on the one hand ... on the other hand" or “一方面…另一方面”, retain both sides as separate observable success criteria on the same substantive requirement, followed by a comparison/synthesis criterion.
- When the user names an ordered set of top-level report sections, preserve the exact section names and order in one evidence-free deliverable requirement. If every section must use bullets or another repeated format, make that per-section obligation observable rather than treating one occurrence anywhere in the report as sufficient.
- If an abstract section count conflicts with a longer complete sequence of top-level deliverables introduced by First/Second/Finally or 首先/其次/最后, preserve every concrete sequence component as a must requirement and retain that sequence in rubricText. Concrete named outputs take precedence over the inconsistent smaller count.
- Set evidenceRequired=false only for presentation/output constraints (language, format, length, organization) that are verified on the rendered report rather than by external sources.
- Set failurePolicy=block only for non-waivable prohibitions or safety/integrity constraints, especially forbidden-source rules. Use failurePolicy=degrade for ordinary research coverage and deliverables so exhausted evidence can be transparently qualified or omitted without claiming false completion.
- Set visibility=internal for policy-only constraints that must be enforced but must not appear in reader-facing prose, especially forbidden-source directives. Use visibility=reader for substantive questions and deliverables.
- Keep 2-12 non-overlapping requirements.`;
  const maxLlmCalls = Math.max(1, ctx.state.runtimeProfile.phases.rubric?.maxLlmCalls ?? 1);
  let parsed: RubricJson | undefined;
  let invalidOutput = "";
  for (let attempt = 0; attempt < maxLlmCalls; attempt += 1) {
    const response = await tracedLlmChat(ctx, attempt === 0 ? "rubric" : "rubric.repair", {
      system: attempt === 0
        ? RUBRIC_SYSTEM_PROMPT
        : `${RUBRIC_SYSTEM_PROMPT}\nThe previous response was not valid JSON. Regenerate one complete, concise JSON object from the original task. Keep descriptions to one sentence and each criteria/evidence list to at most three items.`,
      user: attempt === 0
        ? userPrompt
        : `${userPrompt}\n\nPrevious invalid response preview (do not continue it; regenerate):\n${invalidOutput.slice(0, 2_000)}\n...\n${invalidOutput.slice(-2_000)}`,
      json: true,
      ...llmCfg,
      temperature: attempt === 0 ? llmCfg.temperature : 0,
    });
    invalidOutput = response.content || response.reasoning || "";
    parsed = parseJsonObject<RubricJson>(invalidOutput) ?? undefined;
    if (parsed) break;
    if (isExplicitTestLlm(ctx.stack.llm.name)) {
      parsed = fallbackRubric(submission.userInput, submission.uiOptions);
      break;
    }
  }
  if (!parsed) {
    parsed = fallbackRubric(submission.userInput, submission.uiOptions);
    await traceWrite(ctx, "llm", "rubricFallback", {
      reason: "invalid_json_after_repairs",
      attempts: maxLlmCalls,
      invalidOutputPreview: `${invalidOutput.slice(0, 500)}${invalidOutput.length > 1000 ? " ... " : ""}${invalidOutput.slice(-500)}`,
    }, { taskId: "T_root", reportNodeId: "R_root" });
  }
  const rubric: GlobalRubric = {
    rubricId: parsed.rubricId ?? `RB_${ctx.state.episodeId}_001`,
    episodeId: ctx.state.episodeId,
    rubricText: parsed.rubricText,
    outputHints: {
      titleHint: parsed.outputHints?.titleHint ?? submission.userInput.slice(0, 60),
      language: parsed.outputHints?.language ?? submission.uiOptions?.outputLanguage ?? "zh-CN",
      citationRequired: parsed.outputHints?.citationRequired ?? submission.uiOptions?.citationRequired ?? true,
      format: "markdown",
    },
    researchQuestionHints: parsed.researchQuestionHints?.slice(0, 6) ?? [submission.userInput],
    requirements: normalizeRequirements(parsed.requirements, parsed.researchQuestionHints, submission.userInput),
  };
  const now = isoNow(ctx.now);
  const rootTask: TaskItem = {
    taskId: "T_root",
    parentTaskId: null,
    reportNodeId: "R_root",
    title: `Research: ${rubric.outputHints.titleHint ?? "Deep Research"}`,
    objective: "Complete the global research task under the rubric.",
    status: "queued",
    priority: 100,
    branchId: "B_root",
    acceptanceCriteria: [
      "Cover the report tree created by architect-tree.",
      "Bind evidence through EvidenceLink only.",
      "Publish gate has no missing citations.",
      ...(rubric.requirements ?? []).filter((requirement) => requirement.priority === "must").slice(0, 6)
        .map((requirement) => `Must cover ${requirement.requirementId}: ${requirement.description}`),
    ],
    createdAt: now,
    updatedAt: now,
  };
  await ctx.stack.ledger.upsert(rootTask);
  await traceWrite(ctx, "ledger", "upsert", { task: rootTask }, { taskId: rootTask.taskId, reportNodeId: rootTask.reportNodeId, branchId: rootTask.branchId });
  ctx.state.globalRubric = rubric;
  ctx.state.rootTask = rootTask;
  await ctx.emit({
    eventType: "rubric_created",
    payload: {
      rubricId: rubric.rubricId,
      titleHint: rubric.outputHints.titleHint,
      requirementCount: rubric.requirements?.length ?? 0,
      mustRequirementIds: rubric.requirements?.filter((item) => item.priority === "must").map((item) => item.requirementId) ?? [],
    },
  });
  return rubric;
}

export function normalizeRequirements(
  value: unknown,
  _researchQuestionHints: unknown,
  userInput: string,
): ResearchRequirement[] {
  const raw = Array.isArray(value) ? value : [];
  const normalized: ResearchRequirement[] = [];
  const seenIds = new Set<string>();
  for (let index = 0; index < raw.length && normalized.length < 12; index++) {
    const record = objectValue(raw[index]);
    if (!record) continue;
    const rawDescription = text(record.description) || text(record.question) || text(record.requirement);
    if (!rawDescription) continue;
    const description = sanitizeModelInventedRenderedFormats(rawDescription, userInput);
    const baseId = normalizeRequirementId(text(record.requirementId) || text(record.id) || `RQ_${index + 1}`);
    const requirementId = uniqueRequirementId(baseId, seenIds);
    const priority = ["must", "should", "exploratory"].includes(text(record.priority))
      ? text(record.priority) as ResearchRequirement["priority"]
      : normalized.length === 0 ? "must" : "should";
    const temporal = objectValue(record.temporalScope);
    const temporalMode = temporal && ["current", "historical", "as_of", "range", "timeless"].includes(text(temporal.mode))
      ? text(temporal.mode) as NonNullable<ResearchRequirement["temporalScope"]>["mode"]
      : undefined;
    const declaredKind = text(record.kind) || "question";
    const successCriteria = sanitizeUngroundedThresholds(
      stringList(record.successCriteria, ["The report explicitly answers: " + description])
        .map((criterion) => sanitizeModelInventedRenderedFormats(criterion, userInput)),
      userInput,
    );
    const obligationText = description + " " + successCriteria.join(" ");
    const renderedArtifact = asksForRenderedArtifact(obligationText);
    const kind = renderedArtifact
      ? "deliverable"
      : declaredKind === "deliverable" && isPresentationConstraint(obligationText)
        ? "constraint"
        : declaredKind;
    const evidenceRequired = kind === "constraint" && isEvidenceFreeQualityConstraint(obligationText)
      ? false
      : record.evidenceRequired === false
      ? !isEvidenceFreeOutputOrPolicyConstraint(obligationText)
      : record.evidenceRequired === true
        ? true
        : renderedArtifact || !["constraint", "deliverable"].includes(kind);
    const temporalScope = normalizeTemporalScope(temporal, temporalMode, obligationText);
    const entityScope = stringList(record.entityScope, [], 64);
    normalized.push({
      requirementId,
      description,
      kind,
      priority,
      evidenceRequired,
      evidenceNeeds: stringList(record.evidenceNeeds, evidenceRequired ? ["Direct evidence addressing this requirement."] : []),
      successCriteria,
      temporalScope,
      geographicScope: stringList(record.geographicScope, []),
      entityScope,
      entityScopeRole: normalizeEntityScopeRole(record.entityScopeRole, obligationText, entityScope),
      exampleScope: stringList(record.exampleScope, [], 32),
      metricScope: stringList(record.metricScope, [], 64),
      failurePolicy: inferRequirementFailurePolicy(record.failurePolicy, description),
      visibility: inferRequirementVisibility(record.visibility, description),
    });
  }
  if (normalized.length === 0) {
    const descriptions = [userInput].filter(Boolean);
    normalized.push(...descriptions.map((description, index): ResearchRequirement => ({
      requirementId: `RQ_${String(index + 1).padStart(2, "0")}`,
      description,
      kind: "question",
      priority: index === 0 ? "must" : "should",
      evidenceRequired: true,
      evidenceNeeds: ["Direct evidence addressing this requirement."],
      successCriteria: [`The final report explicitly and evidenceably addresses: ${description}`],
      failurePolicy: "degrade",
      visibility: "reader",
    })));
  }
  recoverNumberedResearchRequirements(normalized, userInput);
  recoverExplicitNestedOutlineGroups(normalized, userInput);
  recoverExplicitComparisonEntityScopes(normalized, userInput);
  recoverExplicitNamedEntityScopes(normalized, userInput);
  recoverExplicitComparisonDimensions(normalized, userInput);
  recoverExplicitNamedExampleScopes(normalized, userInput);
  recoverExplicitDualPerspectives(normalized, userInput);
  recoverExplicitTopLevelSectionContract(normalized, userInput);
  removeTopLevelSectionExamplePollution(normalized, userInput);
  recoverExplicitNestedSectionContracts(normalized, userInput);
  recoverExplicitTableSchemaRequirement(normalized, userInput);
  recoverExplicitTableCountRequirement(normalized, userInput);
  recoverExplicitTablePartitionContract(normalized, userInput);
  recoverNamedPrimarySourcePolicies(normalized, userInput);
  recoverRenderedExclusions(normalized, userInput);
  recoverGlobalTemporalRequirement(normalized, userInput);
  recoverNamedTemporalSourceExceptions(normalized, userInput);
  removeModelInventedCurrentScopes(normalized, userInput);
  applyExplicitCoveredPeriodFocus(normalized, userInput);
  if (!normalized.some((requirement) => requirement.priority === "must")) normalized[0]!.priority = "must";
  propagateGlobalTemporalScope(normalized);
  return normalized;
}

function applyExplicitCoveredPeriodFocus(requirements: ResearchRequirement[], userInput: string): void {
  const match = userInput.match(/(?:focus(?:ing)?|concentrat(?:e|ing))\s+(?:primarily|mainly|chiefly)\s+on\s+(?:discoveries|findings|events|developments|research|evidence)[^.!?\n]{0,40}(?:before|prior\s+to)\s+((?:19|20)\d{2})/iu);
  const year = Number(match?.[1]);
  if (!Number.isSafeInteger(year)) return;
  const asOf = `${year - 1}-12-31`;
  for (const requirement of requirements) {
    if (requirement.evidenceRequired === false) continue;
    requirement.temporalScope = {
      mode: "as_of",
      basis: "covered_period",
      asOf,
      end: asOf,
      exemptSources: requirement.temporalScope?.exemptSources,
    };
  }
}

function removeTopLevelSectionExamplePollution(requirements: ResearchRequirement[], userInput: string): void {
  const sections = explicitTopLevelSectionNames(userInput) ?? [];
  const sectionKeys = new Set(sections.map(scopePhraseKey).filter(Boolean));
  if (sectionKeys.size === 0) return;
  for (const requirement of requirements) {
    const examples = requirement.exampleScope ?? [];
    if (examples.length === 0) continue;
    const combined = scopePhraseKey(examples.join(" "));
    if (!sectionKeys.has(combined)) continue;
    requirement.exampleScope = [];
    requirement.successCriteria = requirement.successCriteria.filter((criterion) => {
      const match = criterion.match(/^Cover every explicitly requested narrative example with cited substantive analysis:\s*(.+?)\.?$/iu);
      return !match?.[1] || !sectionKeys.has(scopePhraseKey(match[1].replace(/,/gu, " ")));
    });
  }
}

function scopePhraseKey(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase()
    .replace(/\b(?:and|the|of)\b/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function recoverNamedPrimarySourcePolicies(requirements: ResearchRequirement[], userInput: string): void {
  const candidates = namedPrimarySourceCandidates(userInput);
  for (const candidate of candidates) {
    if (candidate.identifiers.length === 0) continue;
    for (const requirement of requirements) {
      if (requirement.evidenceRequired === false) continue;
      const obligation = [requirement.description, ...requirement.evidenceNeeds, ...requirement.successCriteria].join(" ");
      if (!candidate.identifiers.some((identifier) => obligation.includes(identifier))) continue;
      requirement.sourcePolicy = {
        mode: "named_primary_sufficient",
        sources: [{
          title: candidate.title,
          identifiers: candidate.identifiers,
        }],
      };
    }
  }
}

function namedPrimarySourceCandidates(userInput: string): Array<{ title: string; identifiers: string[] }> {
  const sourcePhrases = [
    ...Array.from(userInput.matchAll(/(?:依据|根据)\s*([^，。；;\n]{3,180}?)(?:的)?(?:正式文本|官方文本)/gu), (match) => match[1]?.trim() ?? ""),
    ...Array.from(userInput.matchAll(/(?:based\s+(?:solely\s+)?on|according\s+to)\s+([^,.;\n]{3,180}?)(?:the\s+)?(?:official\s+text|official\s+version)/giu), (match) => match[1]?.trim() ?? ""),
  ].filter(Boolean);
  return sourcePhrases.map((title) => ({
    title,
    identifiers: Array.from(new Set([
      ...Array.from(title.matchAll(/\b(?:19|20)\d{2}\/\d{1,4}\b/gu), (match) => match[0]),
      ...Array.from(title.matchAll(/\b(?:ISO|IEC|IEEE|NIST|RFC|CELEX)\s*[-:]?\s*[A-Z0-9][A-Z0-9./:-]*(?:\s+\d+(?:\.\d+)*)?\b/giu), (match) => match[0].replace(/\s+/gu, " ").trim()),
    ])),
  })).filter((candidate) => candidate.identifiers.length === 1);
}

function recoverRenderedExclusions(requirements: ResearchRequirement[], userInput: string): void {
  const exclusions = [
    ...Array.from(userInput.matchAll(/(?:不要|不得|严禁|禁止)\s*(混入|引用|采用|使用|包含|提及)?\s*([^。；;\n]{2,120})/gu), (match) => ({
      verb: match[1]?.trim() ?? "",
      scope: match[2]?.trim() ?? "",
    })),
    ...Array.from(userInput.matchAll(/\b(?:do\s+not|must\s+not|never)\s+(mix\s+in|include|cite|use|reference|mention)\s+([^.;\n]{2,120})/giu), (match) => ({
      verb: match[1]?.trim().toLocaleLowerCase() ?? "",
      scope: match[2]?.trim() ?? "",
    })),
  ].filter(({ scope }) => /\bPart\s+[A-Z0-9]+\b|recycling\s+efficiency|回收效率|\b(?:source|reference|appendix|annex|section|article)\b/iu.test(scope));
  for (const { verb, scope } of exclusions) {
    const aliases = Array.from(new Set([
      ...Array.from(scope.matchAll(/\bPart\s+[A-Z0-9]+\b/giu), (match) => match[0]),
      ...Array.from(scope.matchAll(/\b(?:recycling|recovery|collection)\s+(?:efficiency|rate|target)s?\b/giu), (match) => match[0]),
      ...Array.from(scope.matchAll(/(?:整电池)?回收效率|材料回收率|收集率/gu), (match) => match[0]),
    ]));
    const ranked = requirements
      .filter((requirement) => requirement.evidenceRequired !== false)
      .map((requirement, index) => ({
        requirement,
        index,
        score: exclusionOverlapScore(scope, [requirement.description, ...requirement.evidenceNeeds, ...requirement.successCriteria].join(" ")),
      }))
      .sort((left, right) => right.score - left.score || left.index - right.index);
    const target = ranked[0]?.score ? ranked[0].requirement : undefined;
    if (!target) continue;
    target.renderedExclusions = [...(target.renderedExclusions ?? []), {
      scope,
      aliases,
      mode: /^(?:混入|mix\s+in)$/iu.test(verb) || /(?:values?|rates?|percentages?|targets?|数值|比例|百分比|目标)/iu.test(scope)
        ? "quantitative_claims"
        : "all_mentions",
    }];
  }
}

function exclusionOverlapScore(left: string, right: string): number {
  const tokens = (value: string) => new Set(value.normalize("NFKC").toLocaleLowerCase().match(/[a-z0-9]+|[\p{Script=Han}]{2,}/gu) ?? []);
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  let score = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) score += token.length;
  return score;
}

function sanitizeModelInventedRenderedFormats(value: string, userInput: string): string {
  const userRequestsTable = /\b(?:provide|create|render|include|show|present|classify|organize|output|write|use|format(?:ted)?\s+as)\b[^.!?\n]{0,80}\b(?:tables?|matrix|matrices|tabular)\b|\b(?:tables?|matrix|matrices)\b[^.!?\n]{0,60}\b(?:with|containing|covering|comparing|should\s+(?:include|contain|show)|must\s+(?:include|contain|show))\b|(?:提供|创建|制作|生成|输出|使用|采用|以)[^。！？\n]{0,40}(?:表格|对比表|比较表|矩阵)|(?:表格|对比表|比较表|矩阵)[^。！？\n]{0,30}(?:列出|展示|呈现|比较)/iu.test(userInput);
  const userRequestsList = /\b(?:provide|create|render|include|show|output|write|use|format(?:ted)?\s+as)\b[^.!?\n]{0,80}\b(?:lists?|checklists?|bullet(?:ed)?\s+(?:lists?|points?)|numbered\s+lists?)\b|\b(?:lists?|checklists?)\b[^.!?\n]{0,60}\b(?:of|with|containing|covering)\b|(?:提供|创建|制作|生成|输出|使用|采用|以)[^。！？\n]{0,40}(?:列表|清单|条目|项目符号|编号列表)|(?:列表|清单)[^。！？\n]{0,30}(?:列出|展示|呈现)/iu.test(userInput);
  let sanitized = value;
  if (!userRequestsTable) {
    sanitized = sanitized
      .replace(/\b(?:a\s+|the\s+)?(?:comparison\s+)?table\s+of\b/giu, "comparison of")
      .replace(/\b(?:in|as|using)\s+(?:a\s+)?(?:markdown\s+)?(?:table|matrix|tabular\s+format)\b/giu, "")
      .replace(/(?:表格|对比表|比较表|矩阵)(?=中|内|形式|格式)/gu, "内容")
      .replace(/(?:表格|对比表|比较表|矩阵)/gu, "内容");
  }
  if (!userRequestsList) {
    sanitized = sanitized
      .replace(/\b(?:a\s+|the\s+)?(?:bullet(?:ed)?\s+|numbered\s+)?(?:checklist|list)\s+of\b/giu, "description of")
      .replace(/\b(?:in|as|using)\s+(?:a\s+)?(?:bullet(?:ed)?\s+|numbered\s+)?(?:checklist|list)\b/giu, "")
      .replace(/(?:项目符号|编号)(?:列表|清单)/gu, "内容")
      .replace(/(?:列表|清单|条目)/gu, "内容");
  }
  return sanitized.replace(/\s+/gu, " ").replace(/[（(]\s*[）)]/gu, "").trim();
}

function removeModelInventedCurrentScopes(requirements: ResearchRequirement[], userInput: string): void {
  const explicitlyCurrent = /\b(?:current(?:ly)?|latest|recent|today|present[- ]day|up[- ]to[- ]date|as\s+of\s+(?:today|now))\b|(?:最新|当前|目前|现状|近期|近年|截至(?:今日|今天|现在))/iu.test(userInput);
  if (explicitlyCurrent) return;
  for (const requirement of requirements) {
    if (requirement.temporalScope?.mode !== "current") continue;
    requirement.temporalScope = {
      mode: "timeless",
      basis: requirement.temporalScope.basis,
    };
  }
}

function sanitizeUngroundedThresholds(criteria: string[], userInput: string): string[] {
  const userDeclaredThreshold = /(?:至少|不少于|不低于|至多|不超过|最多)\s*(?:\d+|[零一二三四五六七八九十百两]+)|\b(?:at\s+least|no\s+fewer\s+than|minimum(?:\s+of)?|at\s+most|no\s+more\s+than|maximum(?:\s+of)?)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/iu.test(userInput);
  if (userDeclaredThreshold) return criteria;
  return criteria.map((criterion) => criterion
    .replace(/(?:至少|不少于|不低于|至多|不超过|最多)\s*(?:\d+|[零一二三四五六七八九十百两]+)\s*(?:个|条|项|种|类|篇|份)?/gu, "")
    .replace(/\b(?:at\s+least|no\s+fewer\s+than|minimum(?:\s+of)?|at\s+most|no\s+more\s+than|maximum(?:\s+of)?)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/giu, "")
    .replace(/[（(]\s*[）)]/gu, "")
    .replace(/\s+/gu, " ")
    .trim());
}

interface ExplicitNestedOutlineGroup {
  headings: string[];
  context: string;
}

function recoverExplicitNestedOutlineGroups(requirements: ResearchRequirement[], userInput: string): void {
  const dimensions = explicitPerItemDimensions(userInput);
  const topLevelSections = explicitTopLevelSectionNames(userInput)?.map(normalizeOutlinePhrase);
  const groups = explicitNestedOutlineGroups(userInput);
  for (const group of groups.filter((candidate) => isReportLevelOutlineGroup(candidate, topLevelSections))) {
    removeReportLevelOutlinePollution(requirements, group.headings);
  }
  for (const group of groups) {
    if (isReportLevelOutlineGroup(group, topLevelSections)) continue;
    const ranked = requirements
      .filter((requirement) => (
        requirement.evidenceRequired !== false
        && ["question", "comparison", "deliverable"].includes(requirement.kind)
        && scopeCompatibleWithOutline(requirement.entityScope, group.headings)
      ))
      .map((requirement, index) => {
        const obligation = [requirement.description, ...requirement.evidenceNeeds, ...requirement.successCriteria].join(" ");
        const overlap = numberedRequirementOverlap(group.context, obligation);
        const headingMatches = group.headings.filter((heading) => normalizedPhrasePresent(obligation, heading)).length;
        return {
          requirement,
          index,
          overlap: overlap.overlap,
          headingMatches,
          score: overlap.score * 5 + (headingMatches >= 2 ? 1.5 : headingMatches === 1 ? -0.5 : 0),
        };
      })
      .sort((left, right) => right.score - left.score || right.overlap - left.overlap || left.index - right.index);
    const best = ranked[0];
    const runnerUp = ranked[1];
    if (!best || (best.overlap < 2 && best.headingMatches < 2)) continue;
    if (runnerUp && best.score - runnerUp.score < 0.12 && best.overlap === runnerUp.overlap) continue;
    // A numbered outline that explicitly requires one rendered subsection per
    // item is a concrete output contract, even when the rubric parser labeled
    // the broader prompt as a question. The report gate only enforces rendered
    // structure for deliverables, so preserve that stronger user intent here.
    best.requirement.kind = "deliverable";
    best.requirement.entityScope = group.headings;
    best.requirement.entityScopeRole = "members";
    if (dimensions.length >= 2) best.requirement.metricScope = dimensions;
    const criteria = [
      `Cover every explicitly named outline item: ${group.headings.join(", ")}.`,
      "Render one substantive subsection for every explicitly named outline item.",
      ...(dimensions.length >= 2
        ? [`For every outline item, cover each required dimension: ${dimensions.join(", ")}.`]
        : []),
    ];
    best.requirement.successCriteria = Array.from(new Set([...best.requirement.successCriteria, ...criteria]));
  }
}

function isReportLevelOutlineGroup(group: ExplicitNestedOutlineGroup, topLevelSections: string[] | undefined): boolean {
  if (topLevelSections
    && group.headings.length === topLevelSections.length
    && group.headings.every((heading, index) => normalizeOutlinePhrase(heading) === topLevelSections[index])) return true;
  return /\b(?:report|answer|response)\b[^.!?\n]{0,180}\b(?:covers?|includes?|contains?|comprises?|consists?\s+of)\b[^.!?\n]{0,100}\b(?:the\s+)?following\b[^.!?\n]{0,50}\b(?:(?:core|main|major|key)\s+)?(?:areas?|sections?|parts?)\b/iu.test(group.context);
}

function removeReportLevelOutlinePollution(requirements: ResearchRequirement[], headings: string[]): void {
  const normalizedHeadings = headings.map(normalizeOutlinePhrase);
  for (const requirement of requirements) {
    if (requirement.evidenceRequired === false || requirement.entityScope?.length !== headings.length) continue;
    if (!requirement.entityScope.every((item, index) => normalizeOutlinePhrase(item) === normalizedHeadings[index])) continue;
    const substantive = [requirement.description, ...requirement.evidenceNeeds].join(" ");
    const substantiveHeadingMatches = headings.filter((heading) => numberedRequirementOverlap(heading, substantive).overlap >= 2).length;
    if (substantiveHeadingMatches > 1) continue;
    requirement.entityScope = [];
    requirement.successCriteria = requirement.successCriteria.filter((criterion) => {
      if (/^(?:Cover every explicitly named outline item|Render one substantive subsection for every explicitly named outline item|For every outline item, cover each required dimension):?/u.test(criterion)) return false;
      const nested = criterion.match(/^Research nested subsection \[([^\]]+)\] under \[([^\]]+)\]/u);
      if (!nested) return true;
      return [nested[1], nested[2]].some((heading) => heading && numberedRequirementOverlap(heading, substantive).overlap >= 2);
    });
  }
}

function explicitNestedOutlineGroups(value: string): ExplicitNestedOutlineGroup[] {
  const matches = Array.from(value.matchAll(/(?:^|\n)[ \t]{0,3}(\d{1,2})[.)、．][ \t]+([^\n]+)/gu));
  const out: ExplicitNestedOutlineGroup[] = [];
  let cursor = 0;
  while (cursor < matches.length) {
    if (Number(matches[cursor]?.[1]) !== 1) {
      cursor += 1;
      continue;
    }
    const start = cursor;
    const items: string[] = [];
    let expected = 1;
    while (cursor < matches.length && Number(matches[cursor]?.[1]) === expected) {
      items.push((matches[cursor]?.[2] ?? "").trim());
      cursor += 1;
      expected += 1;
    }
    if (items.length < 3 || items.length > 12) continue;
    const first = matches[start]!;
    const previous = matches[start - 1];
    const prefixStart = previous
      ? (previous.index ?? 0) + previous[0].length
      : Math.max(0, (first.index ?? 0) - 700);
    const leadIn = value.slice(prefixStart, first.index ?? 0).slice(-700);
    if (!explicitOutlineLeadIn(leadIn)) continue;
    const headings = items.flatMap((item) => {
      const match = item.match(/^(?:\*\*|__)([^*_\n]{2,120})(?:\*\*|__)\s*[:：]/u);
      const heading = match?.[1]?.replace(/\s+/gu, " ").trim();
      return heading ? [heading] : [];
    });
    if (headings.length !== items.length || uniqueCaseInsensitive(headings).length !== headings.length) continue;
    out.push({ headings, context: `${leadIn}\n${items.join("\n")}`.trim() });
  }
  return out;
}

function explicitOutlineLeadIn(value: string): boolean {
  return /\b(?:following|below)\s+(?:[\p{L}-]+\s+){0,2}(?:stages?|scenarios?|applications?|tasks?|steps?|areas?|sections?|subsections?|topics?|dimensions?|aspects?)\b/iu.test(value)
    || /(?:以下|下列)(?:阶段|场景|应用|任务|步骤|领域|部分|小节|主题|维度|方面)/u.test(value);
}

function explicitPerItemDimensions(value: string): string[] {
  const candidates = [
    ...value.matchAll(/\bfor\s+each\s+(?:application\s+)?(?:point|item|stage|scenario|task|section|subsection)[^.!?\n]{0,1200}/giu),
    ...value.matchAll(/(?:每个|每一)(?:应用点|项目|阶段|场景|任务|部分|小节)[^。！？\n]{0,1000}/gu),
  ].flatMap((match) => {
    const dimensions = Array.from((match[0] ?? "").matchAll(/\*\*([^*\n]{2,120})\*\*/gu), (item) => (
      (item[1] ?? "").replace(/\s+/gu, " ").trim()
    )).filter(Boolean);
    const unique = uniqueCaseInsensitive(dimensions);
    return unique.length >= 2 && unique.length <= 8 ? [unique] : [];
  });
  if (candidates.length !== 1) return [];
  return candidates[0]!;
}

function scopeCompatibleWithOutline(current: string[] | undefined, headings: string[]): boolean {
  if (!current?.length) return true;
  const headingKeys = new Set(headings.map(normalizeOutlinePhrase));
  return current.every((item) => headingKeys.has(normalizeOutlinePhrase(item)));
}

function normalizedPhrasePresent(value: string, phrase: string): boolean {
  const normalizedValue = ` ${normalizeOutlinePhrase(value)} `;
  const normalizedPhrase = normalizeOutlinePhrase(phrase);
  return Boolean(normalizedPhrase && normalizedValue.includes(` ${normalizedPhrase} `));
}

function normalizeOutlinePhrase(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/gu, " ").trim();
}

interface ExplicitDualPerspective {
  first: string;
  second: string;
  context: string;
}

function recoverExplicitDualPerspectives(requirements: ResearchRequirement[], userInput: string): void {
  for (const pair of explicitDualPerspectives(userInput)) {
    const ranked = requirements
      .filter((requirement) => requirement.evidenceRequired !== false && ["question", "comparison", "deliverable"].includes(requirement.kind))
      .map((requirement, index) => {
        const obligation = [requirement.description, ...requirement.evidenceNeeds, ...requirement.successCriteria].join(" ");
        const overlap = numberedRequirementOverlap(pair.context, obligation);
        return { requirement, index, ...overlap };
      })
      .sort((left, right) => right.score - left.score || right.overlap - left.overlap || left.index - right.index);
    const best = ranked[0];
    const runnerUp = ranked[1];
    if (!best || best.overlap < 2 || (runnerUp && best.score - runnerUp.score < 0.08 && best.overlap === runnerUp.overlap)) continue;
    const criteria = [
      `Research this explicit perspective separately: ${pair.first}.`,
      `Research this explicit perspective separately: ${pair.second}.`,
      "Compare and synthesize both explicit perspectives without collapsing either side.",
    ];
    best.requirement.successCriteria = Array.from(new Set([...best.requirement.successCriteria, ...criteria]));
  }
}

function explicitDualPerspectives(value: string): ExplicitDualPerspective[] {
  const out: ExplicitDualPerspective[] = [];
  for (const match of value.matchAll(/\bon\s+the\s+one\s+hand\b\s*[,:—-]?\s*([^;.!?\n]{10,600})\s*[;.]\s*\bon\s+the\s+other\s+hand\b\s*[,:—-]?\s*([^.!?\n]{10,600})/giu)) {
    const first = cleanPerspective(match[1] ?? "");
    const second = cleanPerspective(match[2] ?? "");
    if (!first || !second || first.toLocaleLowerCase() === second.toLocaleLowerCase()) continue;
    const index = match.index ?? 0;
    out.push({
      first,
      second,
      context: value.slice(Math.max(0, index - 240), Math.min(value.length, index + match[0].length + 240)),
    });
  }
  for (const match of value.matchAll(/一方面\s*[,，:：—-]?\s*([^；;。！？\n]{6,500})\s*[；;。]\s*(?:另一方面|另方面|同时)\s*[,，:：—-]?\s*([^。！？\n]{6,500})/gu)) {
    const first = cleanPerspective(match[1] ?? "");
    const second = cleanPerspective(match[2] ?? "");
    if (!first || !second || first === second) continue;
    const index = match.index ?? 0;
    out.push({
      first,
      second,
      context: value.slice(Math.max(0, index - 180), Math.min(value.length, index + match[0].length + 180)),
    });
  }
  return out;
}

function cleanPerspective(value: string): string {
  return value
    .replace(/^(?:please\s+)?(?:also\s+)?(?:explain|analy[sz]e|describe|discuss|show)\s+(?:how|why|that)?\s*/iu, "")
    .replace(/^(?:请)?(?:同时|也|还)?(?:解释|分析|说明|讨论)?\s*/u, "")
    .replace(/[\s,，;；:：]+$/gu, "")
    .trim();
}

interface ExplicitComparisonPair {
  first: string;
  second: string;
}

function recoverExplicitComparisonEntityScopes(requirements: ResearchRequirement[], userInput: string): void {
  const pairs = explicitComparisonPairs(userInput);
  if (pairs.length === 0) return;
  for (const requirement of requirements) {
    if (requirement.kind !== "comparison" || requirement.evidenceRequired === false) continue;
    if (requirement.successCriteria.some((criterion) => /^Cover every explicitly named item in the .+ list:/u.test(criterion))) continue;
    const obligation = [requirement.description, ...requirement.evidenceNeeds, ...requirement.successCriteria].join(" ");
    const matches = pairs.filter((pair) => comparisonEntityPresent(obligation, pair.first) && comparisonEntityPresent(obligation, pair.second));
    if (matches.length !== 1) continue;
    const pair = matches[0]!;
    requirement.entityScope = [pair.first, pair.second];
    requirement.entityScopeRole = "members";
  }
}

function comparisonEntityPresent(value: string, entity: string): boolean {
  const escaped = entity.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").test(value)
    || value.normalize("NFKC").toLocaleLowerCase().includes(entity.normalize("NFKC").toLocaleLowerCase());
}

function explicitComparisonPairs(value: string): ExplicitComparisonPair[] {
  const out: ExplicitComparisonPair[] = [];
  const add = (first: string, second: string): void => {
    const cleanedFirst = cleanComparisonEntity(first);
    const cleanedSecond = cleanComparisonEntity(second);
    if (!cleanedFirst || !cleanedSecond || cleanedFirst.toLocaleLowerCase() === cleanedSecond.toLocaleLowerCase()) return;
    if ([cleanedFirst, cleanedSecond].some((item) => item.length > 80)) return;
    if (out.some((pair) => pair.first.toLocaleLowerCase() === cleanedFirst.toLocaleLowerCase()
      && pair.second.toLocaleLowerCase() === cleanedSecond.toLocaleLowerCase())) return;
    out.push({ first: cleanedFirst, second: cleanedSecond });
  };
  // Acronym pairs are intentionally high precision. They cover regulator,
  // standards-body and company comparisons without treating a product and its
  // generic-name alias as the compared subjects.
  for (const match of value.matchAll(/\b([A-Z][A-Z0-9&.-]{1,19})\s+(?:and|with|vs\.?|versus)\s+([A-Z][A-Z0-9&.-]{1,19})\b/gu)) {
    add(match[1] ?? "", match[2] ?? "");
  }
  for (const match of value.matchAll(/(?:比较|对比)\s*([A-Z][A-Z0-9&.-]{1,19})\s*(?:与|和|及|对比|vs\.?)\s*([A-Z][A-Z0-9&.-]{1,19})\b/gu)) {
    add(match[1] ?? "", match[2] ?? "");
  }
  for (const match of value.matchAll(/[“"]([^”"\n]{2,80})[”"]\s*(?:与|和|及|vs\.?|versus|and)\s*[“"]([^”"\n]{2,80})[”"]/giu)) {
    add(match[1] ?? "", match[2] ?? "");
  }
  return out;
}

function cleanComparisonEntity(value: string): string {
  return value.replace(/^[\s'"“”‘’【】[\]()（）]+|[\s'"“”‘’【】[\]()（）,，:：;；]+$/gu, "").trim();
}

interface ExplicitNamedEntityList {
  entityType: string;
  entities: string[];
  context: string;
}

function recoverExplicitNamedEntityScopes(requirements: ResearchRequirement[], userInput: string): void {
  for (const candidate of explicitCountedEntityLists(userInput)) {
    const ranked = requirements
      .filter((requirement) => requirement.evidenceRequired !== false && ["question", "comparison", "deliverable"].includes(requirement.kind))
      .map((requirement, index) => {
        const stableCriteria = requirement.successCriteria.filter((criterion) => !/^Cover every explicitly named item in the .+ list:/u.test(criterion));
        const obligation = [requirement.description, ...requirement.evidenceNeeds, ...stableCriteria].join(" ");
        const overlap = numberedRequirementOverlap(candidate.context, obligation);
        const typeMatch = entityTypePattern(candidate.entityType).test(obligation);
        const rowIntent = /\b(?:each|every|per)\b|\b(?:rows?|profiles?|tables?)\b|每个|每一|各|逐个|表格|行/iu.test(obligation);
        const aggregateOnly = /\b(?:overall|aggregate|regional)\b[^.!?\n]{0,40}\b(?:index|trend|total)\b|总体|整体|区域(?:指数|趋势)/iu.test(obligation);
        return {
          requirement,
          index,
          typeMatch,
          overlap: overlap.overlap,
          score: (typeMatch ? 4 : 0) + overlap.score * 4 + (rowIntent ? 0.75 : 0) - (aggregateOnly ? 1.5 : 0),
        };
      })
      .sort((left, right) => right.score - left.score || right.overlap - left.overlap || left.index - right.index);
    const duplicateOwners = ranked.filter((item) => sameOrderedScope(item.requirement.entityScope, candidate.entities));
    const selectable = duplicateOwners.length > 0
      ? ranked.filter((item) => !duplicateOwners.includes(item))
      : ranked;
    const best = selectable[0];
    const runnerUp = selectable[1];
    if (!best || (!best.typeMatch && best.overlap < 2)) continue;
    if (duplicateOwners.length > 0 && (!best.typeMatch || best.overlap < 2)) continue;
    if (runnerUp && best.score - runnerUp.score < 0.15 && best.typeMatch === runnerUp.typeMatch) continue;
    best.requirement.entityScope = candidate.entities;
    best.requirement.entityScopeRole = "members";
    const criterion = `Cover every explicitly named item in the ${candidate.entityType} list: ${candidate.entities.join(", ")}.`;
    if (!best.requirement.successCriteria.includes(criterion)) best.requirement.successCriteria.push(criterion);
  }
}

function sameOrderedScope(current: string[] | undefined, candidate: string[]): boolean {
  return current?.length === candidate.length && current.every((entity, index) => entity === candidate[index]);
}

function explicitCountedEntityLists(value: string): ExplicitNamedEntityList[] {
  const englishTypes = "countries|cities|regions|states|provinces|companies|manufacturers|products|frameworks|materials|technologies|industries|organizations|organisations|institutions|species";
  const chineseTypes = "国家|城市|地区|州|省|公司|制造商|产品|框架|材料|技术|行业|机构|物种";
  const patterns = [
    new RegExp(`(?:\\bfor\\s+)?(?:the\\s+)?following\\s+(\\d{1,2}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\\s+(${englishTypes})\\s*[:：]`, "giu"),
    new RegExp(`(?:以下|下列)\\s*([\\d二两三四五六七八九十]{1,3})\\s*个?(${chineseTypes})\\s*[:：]`, "gu"),
  ];
  const out: ExplicitNamedEntityList[] = [];
  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) {
      const count = explicitEntityCount(match[1] ?? "");
      if (count === undefined) continue;
      const start = (match.index ?? 0) + match[0].length;
      // Do not terminate on ASCII dots: technology/product names frequently
      // contain them (Node.js, React.js, ASP.NET). Chinese sentence endings or
      // a newline still bound this prefix-list form conservatively.
      const segment = value.slice(start).split(/[。！\n]/u, 1)[0] ?? "";
      const items = segment
        .split(/\s*[,;，；、]\s*/gu)
        .map((item) => item
          .replace(/^(?:and|or)\s+/iu, "")
          .replace(/^(?:以及|和|与)\s*/u, "")
          .replace(/[.!?]+$/gu, "")
          .trim())
        .filter(Boolean);
      if (items.length === count - 1 && /\s+(?:and|or)\s+/iu.test(items.at(-1) ?? "")) {
        const last = items.pop()!;
        items.push(...last.split(/\s+(?:and|or)\s+/iu).map((item) => item.trim()).filter(Boolean));
      }
      const entities = items.slice(0, count);
      if (entities.length !== count || new Set(entities.map((item) => item.toLocaleLowerCase())).size !== count) continue;
      if (entities.some((item) => item.length < 2 || item.length > 100)) continue;
      const index = match.index ?? 0;
      out.push({
        entityType: match[2] ?? "entities",
        entities,
        context: value.slice(Math.max(0, index - 180), Math.min(value.length, start + segment.length + 800)),
      });
    }
  }
  for (const match of value.matchAll(new RegExp(`([^。！？\\n]{3,700}?)(?:这|上述|以上)\\s*([\\d二两三四五六七八九十]{1,3})\\s*个?(${chineseTypes})`, "gu"))) {
    const count = explicitEntityCount(match[2] ?? "");
    if (count === undefined) continue;
    const entities = explicitEntityItems(match[1] ?? "", count, true);
    if (!entities) continue;
    const index = match.index ?? 0;
    out.push({
      entityType: match[3] ?? "entities",
      entities,
      context: localEntityListContext(value, index, index + match[0].length),
    });
  }
  const parentheticalPatterns = [
    new RegExp(`([\\d二两三四五六七八九十]{1,3})\\s*(?:个|种|类)?\\s*(?:不同(?:的)?)?\\s*(系统制式|交通制式|系统类型)\\s*[（(]([^）)\\n]{3,1200})[）)]`, "gu"),
    new RegExp(`\\b(\\d{1,2}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\\s+(?:different\\s+)?(system\\s+types|transport\\s+modes|${englishTypes})\\s*\\(([^)\\n]{3,1200})\\)`, "giu"),
  ];
  for (const pattern of parentheticalPatterns) {
    for (const match of value.matchAll(pattern)) {
      const count = explicitEntityCount(match[1] ?? "");
      if (count === undefined) continue;
      const entities = explicitEntityItems(match[3] ?? "", count, false);
      if (!entities) continue;
      const index = match.index ?? 0;
      out.push({
        entityType: match[2] ?? "entities",
        entities,
        context: localEntityListContext(value, index, index + match[0].length),
      });
    }
  }
  return out;
}

function explicitEntityItems(value: string, count: number, takeLast: boolean): string[] | undefined {
  const items = value
    .split(/\s*[,;，；、]\s*/gu)
    .map((item) => item.replace(/^(?:and|or)\s+/iu, "").replace(/^(?:以及|和|与)\s*/u, "").trim())
    .filter(Boolean);
  if (items.length === count - 1 && /\s+(?:and|or)\s+/iu.test(items.at(-1) ?? "")) {
    const last = items.pop()!;
    items.push(...last.split(/\s+(?:and|or)\s+/iu).map((item) => item.trim()).filter(Boolean));
  }
  if (items.length === count - 1 && /(?:以及|和|与)/u.test(items.at(-1) ?? "")) {
    const last = items.pop()!;
    items.push(...last.split(/(?:以及|和|与)/u).map((item) => item.trim()).filter(Boolean));
  }
  const selected = (takeLast ? items.slice(-count) : items.slice(0, count)).map((item, index) => (
    takeLast && index === 0
      ? item.replace(/^.*(?:对比分析|比较分析|展示|对比|比较|包括|涵盖|列出|分析|研究|涉及|覆盖)\s*/u, "").trim()
      : item
  ));
  if (selected.length !== count || new Set(selected.map((item) => item.toLocaleLowerCase())).size !== count) return undefined;
  if (selected.some((item) => item.length < 2 || item.length > 100 || /[:：]/u.test(item))) return undefined;
  return selected;
}

function localEntityListContext(value: string, start: number, end: number): string {
  const before = Math.max(
    value.lastIndexOf("\n", start - 1),
    value.lastIndexOf("。", start - 1),
    value.lastIndexOf("！", start - 1),
    value.lastIndexOf("？", start - 1),
  ) + 1;
  const remaining = value.slice(end);
  const boundary = remaining.search(/[。！？.!?\n]/u);
  const after = boundary >= 0 ? end + boundary + 1 : end;
  return value.slice(before, after);
}

function explicitEntityCount(value: string): number | undefined {
  const words: Record<string, number> = {
    two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
    seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
    二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  };
  const normalized = value.trim().toLocaleLowerCase();
  const chineseDigit: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const chinese = normalized.match(/^([一二两三四五六七八九])?十([一二两三四五六七八九])?$/u);
  const chineseCount = chinese
    ? (chinese[1] ? chineseDigit[chinese[1]]! * 10 : 10) + (chinese[2] ? chineseDigit[chinese[2]]! : 0)
    : undefined;
  const count = words[normalized] ?? chineseCount ?? Number(normalized);
  return Number.isSafeInteger(count) && count >= 2 && count <= 20 ? count : undefined;
}

function entityTypePattern(entityType: string): RegExp {
  const normalized = entityType.toLocaleLowerCase();
  if (/^(?:countries|国家)$/u.test(normalized)) return /\b(?:countr(?:y|ies)|nations?)\b|国家/u;
  if (/^(?:cities|城市)$/u.test(normalized)) return /\bcit(?:y|ies)\b|城市/u;
  if (/^(?:companies|公司)$/u.test(normalized)) return /\bcompan(?:y|ies)\b|公司/u;
  if (/^(?:species|物种)$/u.test(normalized)) return /\bspecies\b|物种/u;
  if (/^(?:系统制式|交通制式|系统类型)$/u.test(normalized)) return /系统制式|交通制式|系统类型|制式/u;
  if (/^(?:system\s+types|transport\s+modes)$/u.test(normalized)) return /\b(?:system\s+types?|transport\s+modes?)\b/iu;
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const singular = escaped.endsWith("ies") ? `${escaped.slice(0, -3)}y` : escaped.endsWith("s") ? escaped.slice(0, -1) : escaped;
  return new RegExp(`\\b(?:${escaped}|${singular})\\b`, "iu");
}

interface ExplicitNamedExampleList {
  examples: string[];
  context: string;
}

function recoverExplicitNamedExampleScopes(requirements: ResearchRequirement[], userInput: string): void {
  for (const candidate of explicitNamedExampleLists(userInput)) {
    const ranked = requirements
      .filter((requirement) => requirement.evidenceRequired !== false && ["question", "comparison", "deliverable", "risk"].includes(requirement.kind))
      .map((requirement, index) => {
        const obligation = [requirement.description, ...requirement.evidenceNeeds, ...requirement.successCriteria].join(" ");
        return { requirement, index, ...numberedRequirementOverlap(candidate.context, obligation) };
      })
      .sort((left, right) => right.score - left.score || right.overlap - left.overlap || left.index - right.index);
    const best = ranked[0];
    const runnerUp = ranked[1];
    if (!best || best.overlap < 1) continue;
    if (runnerUp && best.overlap === runnerUp.overlap && best.score - runnerUp.score < 0.08) continue;
    best.requirement.exampleScope = uniqueCaseInsensitive([
      ...(best.requirement.exampleScope ?? []),
      ...candidate.examples,
    ]);
    const criterion = `Cover every explicitly requested narrative example with cited substantive analysis: ${candidate.examples.join(", ")}.`;
    if (!best.requirement.successCriteria.includes(criterion)) best.requirement.successCriteria.push(criterion);
  }
}

function explicitNamedExampleLists(value: string): ExplicitNamedExampleList[] {
  const directive = /\b(?:focus(?:ing)?\s+on|illustrate(?:d)?\s+with|pay\s+(?:particular|special)\s+attention\s+to|specifically\s+(?:analy[sz]e|examine|discuss|cover)|must\s+(?:analy[sz]e|examine|discuss|cover|include)|including|such\s+as|for\s+example)\b/iu;
  const properName = String.raw`['“‘]?\p{Lu}[\p{L}\p{M}'’.-]*(?:\s+(?:\p{Lu}[\p{L}\p{M}'’.-]*|of|the|de|van|von)){0,4}['”’]?`;
  const listPattern = new RegExp(`(${properName}(?:\\s*,\\s*${properName}){0,10}\\s*,?\\s+(?:and|or)\\s+${properName})`, "gu");
  const out: ExplicitNamedExampleList[] = [];
  let cursor = 0;
  for (const sentenceMatch of value.matchAll(/[^.!?\n。！？]+[.!?。！？]?/gu)) {
    const sentence = sentenceMatch[0] ?? "";
    const sentenceStart = sentenceMatch.index ?? cursor;
    cursor = sentenceStart + sentence.length;
    if (!directive.test(sentence)) continue;
    for (const listMatch of sentence.matchAll(listPattern)) {
      const examples = (listMatch[1] ?? "")
        .replace(/\s*,?\s+(?:and|or)\s+/giu, ",")
        .split(/\s*,\s*/gu)
        .map((item) => item.replace(/^[\s'“”‘’]+|[\s'“”‘’.,;:]+$/gu, "").trim())
        .filter(Boolean);
      const unique = uniqueCaseInsensitive(examples);
      if (unique.length < 2 || unique.length > 12) continue;
      if (unique.some((item) => item.length < 2 || item.length > 80 || /^(?:Please|How|What|Why|When|Where|The)$/u.test(item))) continue;
      out.push({
        examples: unique,
        context: value.slice(Math.max(0, sentenceStart - 220), sentenceStart + sentence.length),
      });
    }
  }
  for (const match of value.matchAll(/\b(?:elaborat(?:e|ing)\s+on|focus(?:ing)?\s+on|discuss(?:ing)?)\s+(?:the\s+)?case\s+of\s+([a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,3})\b/giu)) {
    const example = (match[1] ?? "").trim();
    if (!example || example.length > 80) continue;
    const start = match.index ?? 0;
    out.push({ examples: [example], context: localEntityListContext(value, start, start + match[0].length) });
  }
  return out.filter((candidate, index) => out.findIndex((other) => (
    candidate.examples.length === other.examples.length
      && candidate.examples.every((example, exampleIndex) => example.toLocaleLowerCase() === other.examples[exampleIndex]?.toLocaleLowerCase())
  )) === index);
}

function uniqueCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.normalize("NFKC").toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function recoverExplicitTopLevelSectionContract(requirements: ResearchRequirement[], userInput: string): void {
  const sections = explicitTopLevelSectionNames(userInput);
  if (!sections) return;
  const requiresBullets = /(?:each|every)\s+(?:required\s+)?section[^.!?\n]{0,100}\b(?:bullet(?:ed)?|bullet[- ]points?|lists?)\b|\b(?:bullet(?:ed)?|bullet[- ]points?|lists?)\b[^.!?\n]{0,100}(?:each|every)\s+(?:required\s+)?section/iu.test(userInput)
    || /(?:每个|每一个|各)(?:必需|要求)?(?:章节|部分|小节)[^。！？\n]{0,80}(?:项目符号|项目列表|列表|要点)/u.test(userInput);
  const description = `The report must include exactly ${sections.length} top-level sections in this order: ${sections.map((section) => `[${section}]`).join(", ")}.${requiresBullets ? " Use a Markdown bullet list in every section." : ""}`;
  const criteria = [
    "Render one section for each named topic.",
    ...(requiresBullets ? ["Every required top-level section contains a Markdown bullet list."] : []),
  ];
  const existing = requirements.find((requirement) => requirement.requirementId === "RQ_TOP_LEVEL_SECTION_CONTRACT");
  if (existing) {
    existing.description = description;
    existing.kind = "deliverable";
    existing.priority = "must";
    existing.evidenceRequired = false;
    existing.evidenceNeeds = [];
    existing.successCriteria = criteria;
    existing.entityScope = sections;
    return;
  }
  if (requirements.length >= 12) {
    const target = requirements.find((requirement) => requirement.evidenceRequired === false);
    if (!target) return;
    target.kind = "deliverable";
    target.successCriteria = Array.from(new Set([...target.successCriteria, description, ...criteria]));
    target.entityScope = sections;
    return;
  }
  const used = new Set(requirements.map((requirement) => requirement.requirementId));
  requirements.push({
    requirementId: uniqueRequirementId("RQ_TOP_LEVEL_SECTION_CONTRACT", used),
    description,
    kind: "deliverable",
    priority: "must",
    evidenceRequired: false,
    evidenceNeeds: [],
    successCriteria: criteria,
    entityScope: sections,
  });
}

function recoverExplicitNestedSectionContracts(requirements: ResearchRequirement[], userInput: string): void {
  const groups = explicitNestedSectionGroups(userInput);
  if (groups.length === 0) return;
  const used = new Set(requirements.map((requirement) => requirement.requirementId));
  const claimed = new Set<ResearchRequirement>();
  let evidenceSlots = Math.max(0, 12 - requirements.length - groups.length);
  for (const [groupIndex, group] of groups.entries()) {
    const substantive = requirements.filter((requirement) => (
      requirement.evidenceRequired !== false
      && ["question", "comparison", "deliverable", "risk"].includes(requirement.kind)
      && !claimed.has(requirement)
    ));
    const pairs = group.children.flatMap((child, childIndex) => substantive.map((requirement, requirementIndex) => {
      const obligation = [requirement.description, ...requirement.evidenceNeeds, ...requirement.successCriteria].join(" ");
      const childOverlap = numberedRequirementOverlap(`${child.heading} ${child.instruction}`, obligation);
      const parentOverlap = numberedRequirementOverlap(group.parent, obligation);
      const headingMatch = normalizedOutlineHeadingPresent(obligation, child.heading);
      const groupHeadingMatches = group.children.filter((candidate) => normalizedOutlineHeadingPresent(obligation, candidate.heading)).length;
      return {
        childIndex,
        requirementIndex,
        childOverlap: childOverlap.overlap,
        parentOverlap: parentOverlap.overlap,
        headingMatch,
        groupHeadingMatches,
        score: childOverlap.score * 5 + parentOverlap.score + (headingMatch ? 2 : 0),
      };
    })).sort((left, right) => right.score - left.score || right.childOverlap - left.childOverlap);
    const matchedChildren = new Set<number>();
    const matchedRequirements = new Set<number>();
    for (const pair of pairs) {
      if (pair.groupHeadingMatches > 1) continue;
      if ((!pair.headingMatch && (pair.childOverlap < 2 || pair.parentOverlap < 2)) || pair.score < 0.12) continue;
      if (matchedChildren.has(pair.childIndex) || matchedRequirements.has(pair.requirementIndex)) continue;
      const requirement = substantive[pair.requirementIndex];
      const child = group.children[pair.childIndex];
      if (!requirement || !child) continue;
      matchedChildren.add(pair.childIndex);
      matchedRequirements.add(pair.requirementIndex);
      claimed.add(requirement);
      const criterion = nestedSectionEvidenceCriterion(group.parent, child.heading);
      requirement.successCriteria = Array.from(new Set([...requirement.successCriteria, criterion]));
    }
    for (const [childIndex, child] of group.children.entries()) {
      if (matchedChildren.has(childIndex) || evidenceSlots <= 0) continue;
      const instruction = child.instruction || `Research the explicitly requested nested topic ${child.heading}.`;
      const recovered: ResearchRequirement = {
        requirementId: uniqueRequirementId(`RQ_NESTED_${groupIndex + 1}_${childIndex + 1}`, used),
        description: `${group.parent} — ${child.heading}: ${instruction}`.slice(0, 800),
        kind: asksForRenderedArtifact(instruction) ? "deliverable" : "question",
        priority: "must",
        evidenceRequired: true,
        evidenceNeeds: [`Direct evidence for ${child.heading} within ${group.parent}.`],
        successCriteria: [nestedSectionEvidenceCriterion(group.parent, child.heading)],
      };
      requirements.push(recovered);
      claimed.add(recovered);
      evidenceSlots -= 1;
    }
    if (requirements.length >= 12) continue;
    const headings = group.children.map((child) => child.heading);
    requirements.push({
      requirementId: uniqueRequirementId(`RQ_NESTED_SECTION_CONTRACT_${groupIndex + 1}`, used),
      description: `Under top-level section [${group.parent}], render these ${headings.length} named subsections: ${headings.map((heading) => `[${heading}]`).join(", ")}.`,
      kind: "deliverable",
      priority: "must",
      evidenceRequired: false,
      evidenceNeeds: [],
      successCriteria: [`Every named subsection is non-empty and nested under [${group.parent}].`],
      entityScope: headings,
      entityScopeRole: "members",
    });
  }
}

function nestedSectionEvidenceCriterion(parent: string, heading: string): string {
  return `Research nested subsection [${heading}] under [${parent}] with direct cited evidence.`;
}

function normalizedOutlineHeadingPresent(value: string, heading: string): boolean {
  const withoutParenthetical = heading.replace(/[（(][^（）()]{1,120}[）)]/gu, " ").replace(/\s+/gu, " ").trim();
  const compactValue = value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  return [heading, withoutParenthetical].some((candidate) => {
    if (normalizedPhrasePresent(value, candidate)) return true;
    const compact = candidate.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    return /\p{Script=Han}/u.test(compact) && Array.from(compact).length >= 4 && compactValue.includes(compact);
  });
}

function recoverExplicitTableSchemaRequirement(requirements: ResearchRequirement[], userInput: string): void {
  const columns = explicitTableColumns(userInput);
  const groups = explicitRequiredTaxonomyGroups(userInput);
  if (!columns && !groups) return;
  const tableRequirements = requirements.filter((requirement) => (
    requirement.kind === "deliverable"
    && /(?:\btables?\b|表格)/iu.test([requirement.description, ...requirement.successCriteria].join(" "))
  ));
  if (tableRequirements.length !== 1) return;
  const requirement = tableRequirements[0]!;
  if (columns) {
    requirement.metricScope = columns;
    const criterion = `The Markdown table headers must appear exactly in this order: ${columns.map((column) => `[${column}]`).join(", ")}.`;
    if (!requirement.successCriteria.includes(criterion)) requirement.successCriteria.push(criterion);
  }
  if (groups) {
    requirement.entityScope = groups;
    requirement.entityScopeRole = "groups";
    const criterion = `The table covers every required category: ${groups.join(", ")}.`;
    if (!requirement.successCriteria.includes(criterion)) requirement.successCriteria.push(criterion);
  }
}

function explicitRequiredTaxonomyGroups(value: string): string[] | undefined {
  const candidates = [
    ...value.matchAll(/\b(?:[\p{L}\p{N}-]+\s+){0,3}categories?\s+(?:should|must|shall)\s+(?:cover|include|contain)\s+(?:at\s+least\s*)?[:：]\s*([^.!?\n]{3,800})/giu),
    ...value.matchAll(/(?:类别|分类|类型)[^:：。\n]{0,40}(?:至少包括|应包括|应涵盖|必须包括)[^:：。\n]{0,10}[:：]\s*([^。！？\n]{3,800})/gu),
  ].flatMap((match) => {
    if (!match[1]) return [];
    const groups = match[1]
      .replace(/\s*,?\s+and\s+/giu, ",")
      .replace(/\s*,?\s+or\s+/giu, ",")
      .split(/\s*[,;，；、|]\s*/gu)
      .map((item) => item.replace(/^[\s*_~"'“”‘’[\]【】]+|[\s*_~"'“”‘’[\]【】]+$/gu, "").trim())
      .filter(Boolean);
    if (groups.length < 2 || groups.length > 12 || groups.some((group) => group.length > 120)) return [];
    const unique = Array.from(new Set(groups));
    return unique.length >= 2 ? [unique] : [];
  });
  const uniqueCandidates = candidates.filter((candidate, index) => (
    candidates.findIndex((other) => (
      candidate.length === other.length
      && candidate.every((item, itemIndex) => item.toLocaleLowerCase() === other[itemIndex]?.toLocaleLowerCase())
    )) === index
  ));
  return uniqueCandidates.length === 1 ? uniqueCandidates[0] : undefined;
}

function recoverExplicitTableCountRequirement(requirements: ResearchRequirement[], userInput: string): void {
  const count = explicitTableCount(userInput);
  if (count === undefined) return;
  const tableRequirements = requirements.filter((requirement) => (
    requirement.kind === "deliverable"
    && /(?:\btables?\b|表格)/iu.test([requirement.description, ...requirement.successCriteria].join(" "))
  ));
  if (tableRequirements.length !== 1) return;
  const requirement = tableRequirements[0]!;
  const obligationText = [requirement.description, ...requirement.successCriteria].join(" ");
  if ((explicitTableCount(obligationText) ?? 0) >= count) return;
  requirement.successCriteria.push(`The final report renders ${count} separate Markdown tables.`);
}

function recoverExplicitComparisonDimensions(requirements: ResearchRequirement[], userInput: string): void {
  const dimensions = explicitComparisonDimensions(userInput);
  if (!dimensions) return;
  const candidates = structuredTableRequirements(requirements);
  const scoped = candidates.filter((requirement) => (requirement.entityScope ?? []).filter((entity) => entity.trim()).length >= 2);
  const partitions = explicitTablePartitionLabels(userInput);
  const targets = candidates.length === 1
    ? candidates
    : partitions && scoped.length > 0 && scoped.length <= partitions.length
      ? scoped
      : [];
  for (const requirement of targets) {
    const current = requirement.metricScope ?? [];
    const genericSecurity = current.some((field) => /\bsecurity\b|安全支持/iu.test(field));
    if (current.length === 0 || current.length < dimensions.length || genericSecurity) requirement.metricScope = dimensions;
    const criterion = `For every scoped entity, cover each explicit comparison dimension: ${dimensions.join(", ")}.`;
    requirement.successCriteria = Array.from(new Set([...requirement.successCriteria, criterion]));
  }
}

function recoverExplicitTablePartitionContract(requirements: ResearchRequirement[], userInput: string): void {
  const partitions = explicitTablePartitionLabels(userInput);
  if (!partitions || explicitTableCount(userInput) !== partitions.length) return;
  const tableRequirements = structuredTableRequirements(requirements);
  const scoped = tableRequirements.filter((requirement) => (
    requirement.entityScopeRole !== "groups" && (requirement.entityScope ?? []).filter((entity) => entity.trim()).length >= 2
  ));
  const entities = compatiblePartitionEntityScope(scoped.map((requirement) => requirement.entityScope ?? []), partitions.length);
  if (!entities) return;
  const criterion = `Assign every scoped entity to exactly one table partition: ${partitions.map((partition) => `[${partition}]`).join(", ")}.`;
  for (const requirement of scoped) {
    requirement.successCriteria = Array.from(new Set([...requirement.successCriteria, criterion]));
  }
  if (requirements.some((requirement) => requirement.requirementId.startsWith("RQ_TABLE_PARTITION_CONTRACT")) || requirements.length >= 12) return;
  const used = new Set(requirements.map((requirement) => requirement.requirementId));
  requirements.push({
    requirementId: uniqueRequirementId("RQ_TABLE_PARTITION_CONTRACT", used),
    description: `Render exactly ${partitions.length} labeled Markdown table partitions: ${partitions.map((partition) => `[${partition}]`).join(", ")}. Every scoped entity must appear in exactly one partition table.`,
    kind: "deliverable",
    priority: "must",
    evidenceRequired: false,
    evidenceNeeds: [],
    successCriteria: ["Every partition is labeled, no scoped entity is omitted, and no scoped entity appears in more than one partition."],
    entityScope: entities,
    entityScopeRole: "members",
  });
}

function structuredTableRequirements(requirements: ResearchRequirement[]): ResearchRequirement[] {
  return requirements.filter((requirement) => (
    requirement.evidenceRequired !== false
    && ["comparison", "deliverable"].includes(requirement.kind)
    && (/(?:\btables?\b|表格)/iu.test([requirement.description, ...requirement.successCriteria].join(" "))
      || (requirement.metricScope ?? []).length >= 2)
  ));
}

function compatiblePartitionEntityScope(scopes: string[][], partitionCount: number): string[] | undefined {
  const normalized = scopes
    .map((scope) => uniqueCaseInsensitive(scope.map((entity) => entity.replace(/\s+/gu, " ").trim()).filter(Boolean)))
    .filter((scope) => scope.length >= 2);
  if (normalized.length === 0) return undefined;
  const ordered = [...normalized].sort((left, right) => right.length - left.length);
  const largest = ordered[0]!;
  const largestKeys = new Set(largest.map(normalizeOutlinePhrase));
  if (ordered.slice(1).every((scope) => scope.every((entity) => largestKeys.has(normalizeOutlinePhrase(entity))))) return largest;
  if (normalized.length !== partitionCount) return undefined;
  const seen = new Set<string>();
  const union: string[] = [];
  for (const scope of normalized) {
    for (const entity of scope) {
      const key = normalizeOutlinePhrase(entity);
      if (!key || seen.has(key)) return undefined;
      seen.add(key);
      union.push(entity);
    }
  }
  return union;
}

interface NumberedResearchItem {
  number: number;
  text: string;
}

function recoverNumberedResearchRequirements(requirements: ResearchRequirement[], userInput: string): void {
  const items = numberedResearchItems(userInput).filter((item) => !isAncillaryNumberedItem(item.text));
  if (items.length < 3) return;
  const researchRequirements = requirements.filter((requirement) => {
    if (!["question", "comparison", "deliverable", "risk"].includes(requirement.kind)) return false;
    return !isAncillaryNumberedItem([requirement.description, ...requirement.successCriteria].join(" "));
  });
  const deficit = items.length - researchRequirements.length;
  if (deficit <= 0 || requirements.length >= 12) return;
  const pairs = items.flatMap((item, itemIndex) => researchRequirements.map((requirement, requirementIndex) => {
    const score = numberedRequirementOverlap(item.text, [requirement.description, ...requirement.successCriteria].join(" "));
    return { itemIndex, requirementIndex, ...score };
  })).sort((left, right) => right.score - left.score || right.overlap - left.overlap);
  const matchedItems = new Set<number>();
  const matchedRequirements = new Set<number>();
  for (const pair of pairs) {
    if (pair.overlap < 2 || pair.score < 0.12) continue;
    if (matchedItems.has(pair.itemIndex) || matchedRequirements.has(pair.requirementIndex)) continue;
    matchedItems.add(pair.itemIndex);
    matchedRequirements.add(pair.requirementIndex);
  }
  const used = new Set(requirements.map((requirement) => requirement.requirementId));
  const missing = items.filter((_item, index) => !matchedItems.has(index)).slice(0, Math.min(deficit, 12 - requirements.length));
  for (const item of missing) {
    const description = item.text.replace(/[*_`~]+/gu, "").replace(/\s+/gu, " ").trim().slice(0, 800);
    requirements.push({
      requirementId: uniqueRequirementId(`RQ_ENUM_${String(item.number).padStart(2, "0")}`, used),
      description,
      kind: asksForRenderedArtifact(description) ? "deliverable" : "question",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Direct evidence addressing this numbered research task."],
      successCriteria: [`The final report explicitly and evidenceably completes numbered task ${item.number}.`],
    });
  }
}

function numberedResearchItems(userInput: string): NumberedResearchItem[] {
  const matches = Array.from(userInput.matchAll(/(?:^|\n)[ \t]{0,1}(\d{1,2})[.)、．][ \t]+([^\n]+)/gu));
  const startIndex = matches.findIndex((match) => Number(match[1]) === 1);
  if (startIndex < 0) return [];
  const first = matches[startIndex]!;
  const prefix = userInput.slice(Math.max(0, (first.index ?? 0) - 240), first.index ?? 0);
  if (!/(?:tasks?|questions?|requirements?|items?|points?)\s*(?:are\s+)?(?:as\s+follows|below)|(?:following|below)\s+(?:tasks?|questions?|requirements?|items?|points?)|以下[^\n。！？]{0,24}(?:任务|问题|要求|事项|要点)|具体完成[^\n。！？]{0,20}(?:任务|问题)/iu.test(prefix)) return [];
  const items: NumberedResearchItem[] = [];
  let expected = 1;
  for (const match of matches.slice(startIndex)) {
    const number = Number(match[1]);
    if (number !== expected) break;
    const text = (match[2] ?? "").trim();
    if (!text) break;
    items.push({ number, text });
    expected += 1;
    if (items.length >= 12) break;
  }
  return items.length >= 3 ? items : [];
}

function isAncillaryNumberedItem(value: string): boolean {
  const text = value.trim();
  const researchContent = /(?:define|explain|analy[sz]e|compare|trace|evaluate|identify|investigate|review|summarize|describe|discuss|research)|(?:定义|解释|分析|比较|对比|追溯|评估|识别|调研|研究|总结|阐述|说明|讨论)/iu.test(text);
  if (researchContent) return false;
  return /(?:write|respond|answer|output|format|use|include)[^.!?。！？\n]{0,80}(?:english|chinese|language|markdown|headings?|citations?|references?|bibliography|words?|characters?)|(?:使用|采用|以|用)[^。！？\n]{0,40}(?:中文|英文|语言|格式|Markdown|标题|引用|参考文献|字数|字符)/iu.test(text);
}

function numberedRequirementOverlap(left: string, right: string): { score: number; overlap: number } {
  const leftTokens = requirementRecoveryTokens(left);
  const rightTokens = requirementRecoveryTokens(right);
  let overlap = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) overlap += 1;
  const score = leftTokens.size > 0 && rightTokens.size > 0
    ? overlap / Math.sqrt(leftTokens.size * rightTokens.size)
    : 0;
  return { score, overlap };
}

function requirementRecoveryTokens(value: string): Set<string> {
  const normalized = value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const stopWords = new Set(["the", "and", "for", "with", "from", "this", "that", "please", "report", "answer", "research", "explain"]);
  const english = normalized.split(/\s+/gu).filter((token) => token.length >= 3 && !stopWords.has(token));
  const chineseStop = new Set(["请分", "分别", "清晰", "说明", "解释", "分析", "研究", "具体", "需要", "如何", "最后", "回答"]);
  const chinese = Array.from(normalized.matchAll(/[\p{Script=Han}]{2,}/gu)).flatMap((match) => {
    const chars = Array.from(match[0]);
    return chars.slice(0, -1).map((char, index) => `${char}${chars[index + 1]}`);
  }).filter((token) => !chineseStop.has(token));
  return new Set([...english, ...chinese]);
}

function recoverGlobalTemporalRequirement(requirements: ResearchRequirement[], userInput: string): void {
  const segments = userInput.match(/[^.!?。！？\n]+[.!?。！？]?/gu)?.map((segment) => segment.trim()).filter(Boolean) ?? [];
  const inferred = [...segments, userInput].flatMap((segment) => {
    if (!isGlobalTemporalText(segment)) return [];
    const scope = normalizeTemporalScope(undefined, undefined, segment);
    return scope ? [scope] : [];
  })[0];
  if (!inferred) return;
  const existing = requirements.find(isGlobalTemporalRequirement);
  if (existing) {
    existing.temporalScope = structuredClone(inferred);
    return;
  }
  if (requirements.length < 12) {
    const used = new Set(requirements.map((requirement) => requirement.requirementId));
    const requirementId = uniqueRequirementId("RQ_GLOBAL_TEMPORAL_CUTOFF", used);
    const boundary = inferred.mode === "range"
      ? `${inferred.start ?? "the stated start"} through ${inferred.end ?? "the stated end"}`
      : inferred.asOf ?? "the stated cutoff";
    requirements.push({
      requirementId,
      description: inferred.basis === "source_publication"
        ? `Use only research sources published or publicly available through ${boundary}.`
        : `Apply the report-wide evidence cutoff through ${boundary}.`,
      kind: "constraint",
      priority: "must",
      evidenceRequired: false,
      evidenceNeeds: [],
      successCriteria: ["Every ordinary evidence source respects the user-specified global temporal boundary."],
      temporalScope: structuredClone(inferred),
    });
    return;
  }
  for (const requirement of requirements) {
    if (requirement.evidenceRequired === false) continue;
    if (!shouldApplyGlobalTemporalScope(requirement.temporalScope, inferred)) continue;
    requirement.temporalScope = inheritGlobalTemporalScope(requirement.temporalScope, inferred);
  }
}

function recoverNamedTemporalSourceExceptions(requirements: ResearchRequirement[], userInput: string): void {
  const global = requirements.find(isGlobalTemporalRequirement);
  const boundary = global?.temporalScope?.asOf ?? global?.temporalScope?.end;
  const cutoffYear = boundary?.match(/^((?:19|20)\d{2})/u)?.[1];
  if (!global?.temporalScope || !cutoffYear) return;
  const sources = requiredNamedSourcesAfterYear(userInput, Number(cutoffYear));
  if (sources.length === 0) return;
  const substantive = requirements.filter((requirement) => (
    requirement !== global
    && requirement.evidenceRequired === true
    && !isGlobalTemporalRequirement(requirement)
  ));
  for (const source of sources) {
    const ranked = substantive.map((requirement, index) => ({
      requirement,
      index,
      ...numberedRequirementOverlap(
        source.title,
        [requirement.description, ...requirement.evidenceNeeds, ...requirement.successCriteria].join(" "),
      ),
    })).sort((left, right) => right.score - left.score || right.overlap - left.overlap || left.index - right.index);
    const target = ranked.find((candidate) => candidate.overlap >= 2 && candidate.score >= 0.12)?.requirement;
    if (!target) continue;
    const temporalScope = structuredClone(global.temporalScope);
    const existing = target.temporalScope?.exemptSources ?? [];
    if (existing.some((item) => temporalExceptionTitle(item).toLowerCase() === source.title.toLowerCase())) continue;
    temporalScope.exemptSources = [...existing, { title: source.title }].slice(0, 32);
    target.temporalScope = temporalScope;
  }
}

function requiredNamedSourcesAfterYear(userInput: string, cutoffYear: number): Array<{ title: string }> {
  const taskText = userInput.split(/\*\*important\*\*|the following is a rule of highest priority|during the research process,?\s+you are not allowed/iu)[0] ?? userInput;
  const matches = [
    ...taskText.matchAll(/《([^》\n]{3,180})》/gu),
    ...taskText.matchAll(/[“"]([^”"\n]{3,180})[”"]/gu),
  ];
  const out: Array<{ title: string }> = [];
  for (const match of matches) {
    const title = (match[1] ?? "").replace(/\s+/gu, " ").trim();
    const year = Number(title.match(/(?:19|20)\d{2}/u)?.[0]);
    if (!title || !Number.isSafeInteger(year) || year <= cutoffYear) continue;
    if (!/(?:reports?|stud(?:y|ies)|surveys?|datasets?|indices|index|standards?|guidelines?|white\s+papers?|报告|研究|调查|数据集|指数|标准|指南|白皮书)/iu.test(title)) continue;
    const index = match.index ?? 0;
    const context = namedSourceInstructionSegment(taskText, index, index + match[0].length);
    if (/(?:do\s+not|must\s+not|not\s+allowed|forbid|exclude|ignore|不得|禁止|不允许|不要|排除|忽略)/iu.test(context)) continue;
    if (!/(?:compare|comparison|use|using|based\s+on|according\s+to|cite|include|required|must|published\s+by|reference|对比|比较|使用|采用|依据|根据|引用|纳入|必须|需要|发布的)/iu.test(context)) continue;
    if (!out.some((item) => item.title.toLowerCase() === title.toLowerCase())) out.push({ title });
  }
  return out;
}

function namedSourceInstructionSegment(value: string, start: number, end: number): string {
  const separators = ["\n", ".", "!", "?", "。", "！", "？", ";", "；"];
  const segmentStart = Math.max(0, ...separators.map((separator) => value.lastIndexOf(separator, Math.max(0, start - 1)) + 1));
  const following = separators
    .map((separator) => value.indexOf(separator, end))
    .filter((index) => index >= 0);
  const segmentEnd = following.length > 0 ? Math.min(...following) + 1 : value.length;
  return value.slice(segmentStart, segmentEnd);
}

function temporalExceptionTitle(
  exception: NonNullable<NonNullable<ResearchRequirement["temporalScope"]>["exemptSources"]>[number],
): string {
  return typeof exception === "string" ? exception : exception.title;
}

function normalizeEntityScopeRole(
  value: unknown,
  obligationText: string,
  entityScope: string[],
): ResearchRequirement["entityScopeRole"] {
  const explicit = text(value);
  if (explicit === "members" || explicit === "groups") return explicit;
  if (entityScope.length < 2) return undefined;
  const openTaxonomy = /\b(?:comprehensive|as\s+complete\s+as\s+possible)\b[^.!?\n]{0,180}\b(?:categor(?:y|ies|ization|isation|ize|ise|ized|ised)|classif(?:y|ied|ication))\b|\b(?:categor(?:y|ies|ization|isation|ize|ise|ized|ised)|classif(?:y|ied|ication))\b[^.!?\n]{0,180}\b(?:comprehensive|as\s+complete\s+as\s+possible)\b|(?:尽可能完整|全面)[^。！？\n]{0,80}(?:分类|类别)|(?:分类|类别)[^。！？\n]{0,80}(?:尽可能完整|全面)/iu.test(obligationText);
  const membersInsideGroups = /\b(?:in|within)\s+(?:each|every)\s+(?:category|class|group)\b[^.!?\n]{0,100}\b(?:main|key|common|named|member|item|example)s?\b|(?:每一|每个|各)(?:类|组)(?:中|内|里的)[^。！？\n]{0,60}(?:主要|关键|常见|具体|成员|项目|蛋白)/iu.test(obligationText);
  return openTaxonomy || membersInsideGroups ? "groups" : undefined;
}

function propagateGlobalTemporalScope(requirements: ResearchRequirement[]): void {
  const global = requirements.find(isGlobalTemporalRequirement);
  if (!global?.temporalScope) return;
  for (const requirement of requirements) {
    if (requirement === global || requirement.evidenceRequired === false) continue;
    if (!shouldApplyGlobalTemporalScope(requirement.temporalScope, global.temporalScope)) continue;
    requirement.temporalScope = inheritGlobalTemporalScope(requirement.temporalScope, global.temporalScope);
  }
}

function shouldApplyGlobalTemporalScope(
  local: ResearchRequirement["temporalScope"],
  global: NonNullable<ResearchRequirement["temporalScope"]>,
): boolean {
  if (!local || ["historical", "timeless"].includes(local.mode)) return true;
  if (local.mode !== "as_of" || global.mode !== "as_of" || !local.asOf || !global.asOf) return false;
  return local.asOf >= global.asOf;
}

function inheritGlobalTemporalScope(
  local: ResearchRequirement["temporalScope"],
  global: NonNullable<ResearchRequirement["temporalScope"]>,
): NonNullable<ResearchRequirement["temporalScope"]> {
  const inherited = structuredClone(global);
  const exceptions = [...(global.exemptSources ?? []), ...(local?.exemptSources ?? [])];
  if (exceptions.length > 0) {
    const exceptionKey = (exception: (typeof exceptions)[number]): string => typeof exception === "string"
      ? `string:${exception}`
      : JSON.stringify([exception.title, exception.aliases ?? [], exception.identifiers ?? []]);
    inherited.exemptSources = exceptions.filter((exception, index) => (
      exceptions.findIndex((candidate) => exceptionKey(candidate) === exceptionKey(exception)) === index
    ));
  }
  return inherited;
}

function normalizeTemporalScope(
  temporal: Record<string, unknown> | undefined,
  declaredMode: NonNullable<ResearchRequirement["temporalScope"]>["mode"] | undefined,
  obligationText: string,
): ResearchRequirement["temporalScope"] {
  const laterSourcesAllowed = allowsLaterSourcesForCoveredPeriod(obligationText);
  const inferredPublicationBasis = !laterSourcesAllowed && describesSourcePublicationWindow(obligationText);
  const explicitBasis = temporal && ["source_publication", "covered_period"].includes(text(temporal.basis))
    ? text(temporal.basis) as NonNullable<ResearchRequirement["temporalScope"]>["basis"]
    : undefined;
  const publicationBound = inferredPublicationBasis || (!laterSourcesAllowed && explicitBasis === "source_publication");
  const inferredRange = publicationBound || declaredMode === "range"
    ? naturalLanguageRangeDates(obligationText)
    : undefined;
  const inferredCutoff = (publicationBound ? publicationCutoffDate(obligationText) : undefined)
    ?? naturalLanguageCutoffDate(obligationText);
  const inferredMode = inferredRange ? "range" : inferredCutoff ? "as_of" : undefined;
  const mode = inferredMode && (!declaredMode || declaredMode === "historical") ? inferredMode : declaredMode;
  if (!mode) return undefined;
  const asOf = normalizeBoundaryDate(
    mode === "as_of" ? inferredCutoff ?? optionalText(temporal?.asOf) : optionalText(temporal?.asOf),
    "end",
  );
  const start = normalizeBoundaryDate(optionalText(temporal?.start) ?? (mode === "range" ? inferredRange?.start : undefined), "start");
  const end = normalizeBoundaryDate(optionalText(temporal?.end) ?? (mode === "range" ? inferredRange?.end : undefined), "end");
  const exemptSources = temporalSourceExceptions(temporal?.exemptSources);
  return {
    mode,
    basis: laterSourcesAllowed ? "covered_period" : inferredPublicationBasis ? "source_publication" : explicitBasis ?? "covered_period",
    asOf,
    start,
    end,
    maxAgeDays: positiveNumber(temporal?.maxAgeDays),
    exemptSources: exemptSources.length > 0 ? exemptSources : undefined,
  };
}

function allowsLaterSourcesForCoveredPeriod(value: string): boolean {
  return /(?:sources?|stud(?:y|ies)|papers?|literature)[^.!?\n]{0,100}(?:published|released)[^.!?\n]{0,60}(?:later|after|in\s+(?:19|20)\d{2}\s+or\s+later)[^.!?\n]{0,100}(?:acceptable|allowed|may\s+be\s+used|can\s+be\s+used)[^.!?\n]{0,140}(?:cover|describe|document|report|concern)[^.!?\n]{0,80}(?:before|prior\s+to|earlier)|(?:later|newer|subsequent)[^.!?\n]{0,60}(?:sources?|stud(?:y|ies)|papers?|literature)[^.!?\n]{0,80}(?:acceptable|allowed|may\s+be\s+used|can\s+be\s+used)[^.!?\n]{0,140}(?:earlier|historical|prior)\s+(?:events?|findings?|discoveries|period)|(?:较晚|后续|更新)[^。！？\n]{0,40}(?:来源|研究|论文|文献)[^。！？\n]{0,60}(?:可以|允许|可用于)[^。！？\n]{0,80}(?:较早|此前|截止前|历史)(?:事件|发现|时期|内容)/iu.test(value);
}

function temporalSourceExceptions(value: unknown): NonNullable<NonNullable<ResearchRequirement["temporalScope"]>["exemptSources"]> {
  if (!Array.isArray(value)) return [];
  const out: NonNullable<NonNullable<ResearchRequirement["temporalScope"]>["exemptSources"]> = [];
  for (const item of value.slice(0, 32)) {
    if (typeof item === "string") {
      const title = text(item);
      if (title) out.push({ title });
      continue;
    }
    const record = objectValue(item);
    if (!record) continue;
    const title = text(record.title) || text(record.name);
    if (!title) continue;
    const aliases = stringList(record.aliases, [], 16);
    const identifiers = stringList(record.identifiers, [], 16);
    out.push({
      title,
      aliases: aliases.length > 0 ? aliases : undefined,
      identifiers: identifiers.length > 0 ? identifiers : undefined,
    });
  }
  return out;
}

function describesSourcePublicationWindow(value: string): boolean {
  const explicitPublication = /(?:stud(?:y|ies)|research|literature|articles?|papers?|publications?|sources?|学术(?:研究|观点|文献|来源)|研究|文献|论文|文章|来源)[^.!?。！？\n]{0,60}(?:publish(?:ed|ing|ation)?|dated|appearing|发表于|发表|发布|出版)/iu.test(value)
    || /(?:publish(?:ed|ing|ation)?|dated|appearing|发表于|发表|发布|出版)[^.!?。！？\n]{0,60}(?:stud(?:y|ies)|research|literature|articles?|papers?|publications?|sources?|研究|文献|论文|文章|来源)/iu.test(value);
  const academicCutoff = /(?:academic\s+(?:research|perspectives?|literature|sources?)|学术(?:研究|观点|文献|来源))[^.!?。！？\n]{0,60}(?:(?:19|20)\d{2}\s+(?:and|or)\s+earlier|(?:截至|不晚于)?\s*(?:19|20)\d{2}\s*年?\s*(?:及以前|以前|或更早|及更早))/iu.test(value);
  const corpusRange = /(?:stud(?:y|ies)|research|literature|articles?|papers?|publications?|sources?)\s+(?:published\s+|dated\s+)?(?:from|between|during|spanning)\s+(?:19|20)\d{2}/iu.test(value)
    || /(?:from|between|during|spanning)\s+(?:19|20)\d{2}[^.!?\n]{0,60}(?:stud(?:y|ies)|research|literature|articles?|papers?|publications?|sources?)/iu.test(value)
    || /(?:19|20)\d{2}\s*年?\s*(?:至|到|[-–—])\s*(?:19|20)\d{2}\s*年?(?:间|期间)?(?:所)?(?:发表|发布|开展|进行|完成|收录)?(?:的)?(?:学术|实证)?(?:研究|文献|论文|文章|来源)/u.test(value);
  const publicResearchCutoff = /(?:publicly\s+available|published)\s+(?:academic\s+)?(?:research(?:\s+results?)?|literature|stud(?:y|ies)|papers?|articles?|sources?)[^.!?\n]{0,60}(?:up\s+to|through|as\s+of|by)\s+(?:the\s+)?(?:(?:early|mid(?:dle)?|late)\s*[-–—]?\s*|q[1-4]\s+)?(?:19|20)\d{2}/iu.test(value)
    || /(?:research(?:\s+results?)?|literature|stud(?:y|ies)|papers?|articles?|sources?)[^.!?\n]{0,50}(?:publicly\s+available|published)[^.!?\n]{0,50}(?:up\s+to|through|as\s+of|by)\s+(?:the\s+)?(?:(?:early|mid(?:dle)?|late)\s*[-–—]?\s*|q[1-4]\s+)?(?:19|20)\d{2}/iu.test(value);
  return explicitPublication || academicCutoff || corpusRange || publicResearchCutoff;
}

const ENGLISH_MONTH_PATTERN = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const ENGLISH_DATE_PATTERN = `(?:${ENGLISH_MONTH_PATTERN}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,)?\\s+(?:19|20)\\d{2}|\\d{1,2}(?:st|nd|rd|th)?\\s+${ENGLISH_MONTH_PATTERN}(?:,)?\\s+(?:19|20)\\d{2}|${ENGLISH_MONTH_PATTERN}\\s+(?:19|20)\\d{2}|(?:19|20)\\d{2}[-/]\\d{1,2}(?:[-/]\\d{1,2})?|(?:19|20)\\d{2})`;

function naturalLanguageRangeDates(value: string): { start: string; end: string } | undefined {
  const english = value.match(new RegExp(
    `(?:from|between|during|spanning)\\s+(${ENGLISH_DATE_PATTERN})\\s*(?:to|through|and|[-–—])\\s*(?:the\\s+end\\s+of\\s+)?(${ENGLISH_DATE_PATTERN})`,
    "iu",
  ));
  const chineseDatePattern = "(?:19|20)\\d{2}\\s*年(?:\\s*\\d{1,2}\\s*月(?:份)?(?:\\s*\\d{1,2}\\s*[日号]?)?)?";
  const chinese = value.match(new RegExp(`(${chineseDatePattern})\\s*(?:至|到|[-–—])\\s*(${chineseDatePattern})`, "u"));
  const startExpression = english?.[1] ?? chinese?.[1];
  const endExpression = english?.[2] ?? chinese?.[2];
  if (!startExpression || !endExpression) return undefined;
  const start = naturalDateRange(startExpression);
  const end = naturalDateRange(endExpression);
  if (!start || !end || start.start > end.end) return undefined;
  return { start: start.start, end: end.end };
}

function publicationCutoffDate(value: string): string | undefined {
  const qualifiedYear = qualifiedYearCutoffDate(value);
  if (qualifiedYear) return qualifiedYear;
  const inclusive = value.match(/(?:from\s+)?((?:19|20)\d{2})\s+(?:and|or)\s+earlier|(?:no\s+later\s+than|on\s+or\s+before|up\s+to|through)\s+((?:19|20)\d{2})|((?:19|20)\d{2})\s*年?\s*(?:及以前|以前|或更早|及更早)|(?:截至|不晚于)\s*((?:19|20)\d{2})/iu);
  const inclusiveYear = [inclusive?.[1], inclusive?.[2], inclusive?.[3], inclusive?.[4]].find(Boolean);
  if (inclusiveYear) return `${inclusiveYear}-12-31`;
  const exclusive = value.match(/(?:published|publication|academic\s+perspectives?|stud(?:y|ies)|research|literature|papers?|articles?|sources?|发表于|发表|发布|出版|研究|文献|论文|来源)[^.!?。！？\n]{0,50}(?:before|prior\s+to|早于)\s*((?:19|20)\d{2})/iu);
  if (!exclusive?.[1]) return undefined;
  return `${Number(exclusive[1]) - 1}-12-31`;
}

function naturalLanguageCutoffDate(value: string): string | undefined {
  const negatedExclusiveEnglish = new RegExp(`\\b(?:not|never|no)\\b[^.!?\\n]{0,50}(?:before|prior\\s+to|earlier\\s+than)\\s+(?:the\\s+)?${ENGLISH_DATE_PATTERN}`, "iu").test(value);
  const exclusiveEnglish = negatedExclusiveEnglish
    ? undefined
    : value.match(new RegExp(`(?:before|prior\\s+to|earlier\\s+than)\\s+(?:the\\s+)?(${ENGLISH_DATE_PATTERN})`, "iu"));
  if (exclusiveEnglish?.[1]) return cutoffForDateExpression(exclusiveEnglish[1], "exclusive");
  const qualifiedYear = qualifiedYearCutoffDate(value);
  if (qualifiedYear) return qualifiedYear;
  const inclusiveEnglish = value.match(new RegExp(`(?:as\\s+of|no\\s+later\\s+than|on\\s+or\\s+before|by(?:\\s+the\\s+end\\s+of)?)\\s+(?:the\\s+)?(${ENGLISH_DATE_PATTERN})`, "iu"))
    ?? value.match(new RegExp(`(?:available|released|introduced|published|include(?:d)?|limit(?:ed)?|restrict(?:ed)?)[^.!?\\n]{0,60}(?:through|until|up\\s+to)\\s+(?:the\\s+)?(${ENGLISH_DATE_PATTERN})`, "iu"))
    ?? value.match(new RegExp(`up\\s+to\\s+(?:the\\s+end\\s+of\\s+)?(?:the\\s+)?(${ENGLISH_DATE_PATTERN})`, "iu"));
  if (inclusiveEnglish?.[1]) return cutoffForDateExpression(inclusiveEnglish[1], "inclusive");

  const chineseDatePattern = "((?:19|20)\\d{2}\\s*年(?:\\s*\\d{1,2}\\s*月(?:份)?(?:\\s*\\d{1,2}\\s*[日号]?)?)?)";
  const exclusiveChinese = value.match(new RegExp(`${chineseDatePattern}\\s*(?:之前|以前|前)`, "u"))
    ?? value.match(new RegExp(`(?<!不)早于\\s*${chineseDatePattern}`, "u"));
  if (exclusiveChinese?.[1]) return cutoffForDateExpression(exclusiveChinese[1], "exclusive");
  const inclusiveChinese = value.match(new RegExp(`(?:截至|截止(?:到)?|不晚于)\\s*${chineseDatePattern}`, "u"))
    ?? value.match(new RegExp(`${chineseDatePattern}\\s*(?:及以前|或更早|及更早)`, "u"));
  return inclusiveChinese?.[1] ? cutoffForDateExpression(inclusiveChinese[1], "inclusive") : undefined;
}

function qualifiedYearCutoffDate(value: string): string | undefined {
  const candidates: Array<{ index: number; year: number; month: number; boundary: "exclusive" | "inclusive" }> = [];
  const add = (pattern: RegExp, resolve: (match: RegExpMatchArray) => { year: number; month: number } | undefined): void => {
    for (const match of value.matchAll(pattern)) {
      const index = match.index ?? 0;
      const boundary = qualifiedCutoffBoundary(value, index, match[0].length);
      if (!boundary) continue;
      const resolved = resolve(match);
      if (resolved) candidates.push({ index, boundary, ...resolved });
    }
  };
  add(/\b(early|mid(?:dle)?|late)\s*[-–—]?\s*((?:19|20)\d{2})\b/giu, (match) => ({
    year: Number(match[2]),
    month: /^early$/iu.test(match[1] ?? "") ? 3 : /^mid/iu.test(match[1] ?? "") ? 6 : 12,
  }));
  add(/\b(beginning|start|end)\s+of\s+(?:the\s+)?((?:19|20)\d{2})\b/giu, (match) => ({
    year: Number(match[2]),
    month: /^(?:beginning|start)$/iu.test(match[1] ?? "") ? 3 : 12,
  }));
  add(/\bq([1-4])\s+((?:19|20)\d{2})\b/giu, (match) => ({ year: Number(match[2]), month: Number(match[1]) * 3 }));
  add(/\b(first|second|third|fourth)\s+quarter\s+(?:of\s+)?((?:19|20)\d{2})\b/giu, (match) => {
    const quarter = ["first", "second", "third", "fourth"].indexOf((match[1] ?? "").toLocaleLowerCase()) + 1;
    return quarter > 0 ? { year: Number(match[2]), month: quarter * 3 } : undefined;
  });
  add(/\b(first|second)\s+half\s+(?:of\s+)?((?:19|20)\d{2})\b/giu, (match) => ({
    year: Number(match[2]),
    month: /^first$/iu.test(match[1] ?? "") ? 6 : 12,
  }));
  add(/\bh([12])\s+((?:19|20)\d{2})\b/giu, (match) => ({ year: Number(match[2]), month: Number(match[1]) * 6 }));
  add(/((?:19|20)\d{2})\s*年\s*(初|中期|第一季度|第二季度|第三季度|第四季度|上半年|年中|下半年|年底|年末)/gu, (match) => {
    const qualifier = match[2] ?? "";
    const month = /^(?:初|第一季度)$/u.test(qualifier)
      ? 3
      : /^(?:中期|第二季度|上半年|年中)$/u.test(qualifier)
        ? 6
        : qualifier === "第三季度"
          ? 9
          : 12;
    return { year: Number(match[1]), month };
  });
  const first = candidates.sort((left, right) => left.index - right.index)[0];
  if (!first) return undefined;
  const range = dateRange(first.year, first.month);
  return first.boundary === "exclusive" && range
    ? shiftIsoDate(range.start, -1)
    : range?.end;
}

function qualifiedCutoffBoundary(value: string, index: number, length: number): "exclusive" | "inclusive" | undefined {
  const prefix = value.slice(Math.max(0, index - 60), index);
  const suffix = value.slice(index + length, index + length + 16);
  if (/\b(?:not|never|no)\b[^.!?\n]{0,36}(?:before|prior\s+to|earlier\s+than)\s+(?:the\s+)?$/iu.test(prefix)) return undefined;
  if (/(?:before|prior\s+to|earlier\s+than)\s+(?:the\s+)?$/iu.test(prefix) || /^\s*(?:之前|以前|前)(?:的)?/u.test(suffix)) {
    return "exclusive";
  }
  if (/(?:as\s+of|no\s+later\s+than|on\s+or\s+before|by|through|until|up\s+to)\s+(?:the\s+)?$/iu.test(prefix)
    || /(?:截至|截止(?:到)?|不晚于|到|至)\s*$/u.test(prefix)
    || /^\s*(?:及以前|或更早|及更早)/u.test(suffix)) return "inclusive";
  return undefined;
}

function cutoffForDateExpression(value: string, boundary: "exclusive" | "inclusive"): string | undefined {
  const range = naturalDateRange(value);
  if (!range) return undefined;
  return boundary === "exclusive" ? shiftIsoDate(range.start, -1) : range.end;
}

function naturalDateRange(value: string): { start: string; end: string } | undefined {
  const normalized = value.normalize("NFKC").replace(/,/gu, " ").replace(/\s+/gu, " ").trim();
  const iso = normalized.match(/^((?:19|20)\d{2})[-/](\d{1,2})(?:[-/](\d{1,2}))?$/u);
  if (iso?.[1] && iso[2]) return dateRange(Number(iso[1]), Number(iso[2]), iso[3] ? Number(iso[3]) : undefined);
  const chinese = normalized.match(/^((?:19|20)\d{2})\s*年(?:\s*(\d{1,2})\s*月(?:份)?(?:\s*(\d{1,2})\s*[日号]?)?)?$/u);
  if (chinese?.[1]) return dateRange(Number(chinese[1]), chinese[2] ? Number(chinese[2]) : undefined, chinese[3] ? Number(chinese[3]) : undefined);
  const yearOnly = normalized.match(/^((?:19|20)\d{2})$/u);
  if (yearOnly?.[1]) return dateRange(Number(yearOnly[1]));
  const monthFirst = normalized.match(new RegExp(`^(${ENGLISH_MONTH_PATTERN})(?:\\s+(\\d{1,2})(?:st|nd|rd|th)?)?\\s+((?:19|20)\\d{2})$`, "iu"));
  if (monthFirst?.[1] && monthFirst[3]) {
    return dateRange(Number(monthFirst[3]), englishMonthNumber(monthFirst[1]), monthFirst[2] ? Number(monthFirst[2]) : undefined);
  }
  const dayFirst = normalized.match(new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?\\s+(${ENGLISH_MONTH_PATTERN})\\s+((?:19|20)\\d{2})$`, "iu"));
  if (dayFirst?.[1] && dayFirst[2] && dayFirst[3]) {
    return dateRange(Number(dayFirst[3]), englishMonthNumber(dayFirst[2]), Number(dayFirst[1]));
  }
  return undefined;
}

function englishMonthNumber(value: string): number | undefined {
  const key = value.slice(0, 3).toLocaleLowerCase();
  const index = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(key);
  return index >= 0 ? index + 1 : undefined;
}

function dateRange(year: number, month?: number, day?: number): { start: string; end: string } | undefined {
  const startMonth = month ?? 1;
  const startDay = day ?? 1;
  const endMonth = month ?? 12;
  const endDay = day ?? new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  const start = validIsoDate(year, startMonth, startDay);
  const end = validIsoDate(year, endMonth, day ?? endDay);
  return start && end ? { start, end } : undefined;
}

function validIsoDate(year: number, month: number, day: number): string | undefined {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return date.toISOString().slice(0, 10);
}

function shiftIsoDate(value: string, days: number): string | undefined {
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) ? new Date(timestamp + days * 86_400_000).toISOString().slice(0, 10) : undefined;
}

function normalizeBoundaryDate(value: string | undefined, edge: "start" | "end"): string | undefined {
  if (!value) return undefined;
  return /^(?:19|20)\d{2}$/u.test(value) ? `${value}-${edge === "start" ? "01-01" : "12-31"}` : value;
}

function asksForRenderedArtifact(value: string): boolean {
  return /\b(tables?|matrix|matrices|checklists?|bullet lists?|numbered lists?|charts?|diagrams?|headings?|titled sections?|separate sections?|one section per|independent sections?|divide.{0,24}into.{0,12}(?:parts?|sections?))\b|表格|对比表|比较表|矩阵|清单|列表|图表|示意图|标题章节|独立章节|独立小节|分别成章|每个.{0,12}(?:章节|小节)|每一(?:个|类|种).{0,18}(?:介绍|说明|分析|讨论)|(?:分成|分为).{0,16}(?:部分|章节|小节)/i.test(value);
}

function isPresentationConstraint(value: string): boolean {
  return /\b(write|written|respond|response|report|output)\b.{0,40}\b(english|chinese|language|markdown|format|words?|characters?|length|organized|organisation|organization)\b|用.{0,12}(中文|英文)|以.{0,12}(中文|英文)|语言|字数|篇幅|格式/i.test(value);
}

function isEvidenceFreeOutputOrPolicyConstraint(value: string): boolean {
  return isPresentationConstraint(value)
    || asksForRenderedArtifact(value)
    || /\b(?:citations?|references?|bibliograph(?:y|ies)|footnotes?)\b|引用|参考文献|脚注/iu.test(value)
    || /\b(?:do\s+not|must\s+not|never|exclude|forbid|prohibit)\b[^.!?\n]{0,100}\b(?:search|open|use|cite|source|reference)\b|(?:不要|不得|禁止|排除)[^。！？\n]{0,80}(?:搜索|打开|使用|引用|来源|资料)/iu.test(value);
}

function isEvidenceFreeQualityConstraint(value: string): boolean {
  return /\b(?:all\s+)?(?:information|content|claims?|report|output)\b[^.!?\n]{0,80}\b(?:accurate|specific|clear|non[- ]vague|avoid(?:ing)?\s+vague)\b/iu.test(value)
    || /(?:所有|全部)?(?:信息|内容|表述|报告|输出)[^。！？\n]{0,60}(?:准确|具体|清晰|避免模糊|不得含糊)/u.test(value);
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function optionalText(value: unknown): string | undefined {
  return text(value) || undefined;
}

function stringList(value: unknown, fallback: string[], limit = 10): string[] {
  const items = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const out = items.map(text).filter(Boolean);
  return out.length > 0 ? Array.from(new Set(out)).slice(0, Math.max(1, limit)) : fallback;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function normalizeRequirementId(value: string): string {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "RQ";
}

function uniqueRequirementId(base: string, seen: Set<string>): string {
  let candidate = base;
  for (let suffix = 2; seen.has(candidate); suffix++) candidate = `${base}_${suffix}`;
  seen.add(candidate);
  return candidate;
}

function fallbackRubric(userInput: string, uiOptions: { outputLanguage?: string; citationRequired?: boolean } | undefined): RubricJson {
  return {
    rubricText: `${userInput}\nUse credible evidence. Strong claims must be grounded or downplayed.`,
    outputHints: {
      titleHint: userInput.slice(0, 60) || "Deep Research Report",
      language: uiOptions?.outputLanguage ?? "zh-CN",
      citationRequired: uiOptions?.citationRequired ?? true,
      format: "markdown",
    },
    researchQuestionHints: ["Background and definitions", "Evidence for key claims", "Risks and uncertainty"],
  };
}
