import { afterEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { FetchProvider, KnowledgeNode, LlmChat, ResearchRequirement, SearchProvider } from "@deepresearch/contracts";
import { loadDefaultRuntimeProfile } from "../index.js";
import { consolidateCountedRowGaps, isCompleteStudyRowReportlet } from "../counted-rows.js";
import { EchoJsonLlm } from "../infra/mock-llm.js";
import { createPhaseContext } from "../phase-runner.js";
import { consolidateCountedRowRepairRequests, shouldCreateReflectionTask } from "../phases/cycle-reflection.js";
import { agentNodePartPlans, dispatchEvidencePhase, evidenceRuntimeHistoryMaxChars, evidenceTaskRuntimeBudget } from "../phases/dispatch-evidence.js";
import { maxAgentNodeParts } from "../phases/evidence-budget.js";
import { normalizeRequirements } from "../phases/rubric.js";
import { fixedNow, submission, node, task, completeStudyRowMarkdown, requirement } from "./helpers/v5-orchestrator-fixtures.js";

describe("v5 Orchestrator", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });
  it("scales evidence-agent capacity only for counted row-production tasks", () => {
    const config = {
      targetReactSteps: 9,
      maxReactSteps: 12,
      targetToolCalls: 9,
      maxToolCalls: 11,
      targetSearchCalls: 2,
      maxSearchCalls: 2,
      targetFetchCalls: 2,
      maxFetchCalls: 3,
    };
    const ordinary = evidenceTaskRuntimeBudget({ acceptanceCriteria: ["Corroborate the main claim."] }, config);
    const rows = evidenceTaskRuntimeBudget({
      acceptanceCriteria: [
        "Aim to contribute about 5 distinct regional studies; this is a search allocation, not a per-region minimum.",
      ],
    }, config);
    const globalRows = evidenceTaskRuntimeBudget({
      acceptanceCriteria: [
        "Aim to contribute about 5 distinct eligible primary studies from any geography; this is a global repair allocation, not a regional quota.",
      ],
    }, config);

    expect(ordinary).toMatchObject({
      maxReactSteps: 12,
      maxToolCalls: 11,
      maxSearchCalls: 2,
      maxFetchCalls: 3,
      targetReactSteps: 9,
      targetToolCalls: 9,
      targetSearchCalls: 2,
      targetFetchCalls: 2,
    });
    expect(rows).toMatchObject({
      maxReactSteps: 16,
      maxToolCalls: 14,
      maxSearchCalls: 2,
      maxFetchCalls: 5,
      targetReactSteps: 13,
      targetToolCalls: 12,
      targetSearchCalls: 2,
      targetFetchCalls: 5,
    });
    expect(globalRows).toMatchObject({
      maxReactSteps: 13,
      maxToolCalls: 11,
      maxSearchCalls: 2,
      maxFetchCalls: 4,
      targetReactSteps: 10,
      targetToolCalls: 9,
      targetSearchCalls: 2,
      targetFetchCalls: 3,
    });

    const temporal = evidenceTaskRuntimeBudget({
      acceptanceCriteria: ["提供2015-2022年每年数据，单位公里"],
      plannedReportlets: [
        { partId: "P_1", parentAgentTaskId: "T_temporal", parentReportNodeId: "R_temporal", researchQuestion: "逐年核验2015-2018年", searchGoal: "", writingGoal: "", expectedHeading: "", evidenceNeeds: [] },
        { partId: "P_2", parentAgentTaskId: "T_temporal", parentReportNodeId: "R_temporal", researchQuestion: "逐年核验2019-2022年", searchGoal: "", writingGoal: "", expectedHeading: "", evidenceNeeds: [] },
      ],
    }, config);
    expect(temporal).toMatchObject({ maxSearchCalls: 2, maxFetchCalls: 4, targetSearchCalls: 2, targetFetchCalls: 2 });
    expect(temporal.maxToolCalls).toBeGreaterThanOrEqual(ordinary.maxToolCalls);

    const rowParts = agentNodePartPlans(task({
      taskId: "T_reflect_counted_rows",
      reportNodeId: "R_counted_rows",
      objective: "Find five additional primary studies from any geography.",
      acceptanceCriteria: [
        "Aim to contribute about 5 distinct eligible primary studies from any geography; this is a global repair allocation, not a regional quota.",
        "For every study, fill Authors, Country, Sample Size, Research Design, Outcome Variable, and Finding on Effectiveness.",
      ],
    }), node({
      nodeId: "R_counted_rows",
      nodeKind: "hypothesis",
      label: "Regional study rows",
    }), 5, "en");
    expect(rowParts).toHaveLength(5);
    expect(rowParts.map((part) => part.partId)).toEqual(["P_1", "P_2", "P_3", "P_4", "P_5"]);
    expect(rowParts.every((part) => part.researchQuestion.includes("distinct eligible primary study"))).toBe(true);
    expect(new Set(rowParts.map((part) => part.researchQuestion)).size).toBe(5);
    expect(rowParts.every((part) => part.searchGoal.includes("Find five additional primary studies from any geography."))).toBe(true);
    expect(rowParts.every((part) => !part.searchGoal.includes("Regional study rows"))).toBe(true);
  });

  it("caps repeated evidence-agent history while respecting smaller context limits", () => {
    expect(evidenceRuntimeHistoryMaxChars()).toBe(8_000);
    expect(evidenceRuntimeHistoryMaxChars(8_000)).toBe(8_000);
    expect(evidenceRuntimeHistoryMaxChars(1_000)).toBe(4_000);
    expect(evidenceRuntimeHistoryMaxChars(256)).toBe(2_048);
  });

  it("keeps one coherent reportlet for a simple requirement while preserving structured partitions", () => {
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile: loadDefaultRuntimeProfile(), llm: new EchoJsonLlm() });
    const simple = requirement("R_simple", "总结悬疑小说剧情设计的可操作方法。", "question");
    const structured: ResearchRequirement = {
      ...requirement("R_table", "比较多个对象并填写结构化字段。", "deliverable"),
      entityScope: ["对象甲", "对象乙", "对象丙"],
      metricScope: ["结构", "技巧"],
    };

    expect(maxAgentNodeParts(ctx, [simple])).toBe(1);
    expect(maxAgentNodeParts(ctx, [structured])).toBe(3);
    expect(maxAgentNodeParts(ctx, [simple, structured])).toBe(3);
  });

  it("splits multi-year evidence into bounded temporal reportlets", () => {
    const parts = agentNodePartPlans(task({
      taskId: "T_temporal_series",
      reportNodeId: "R_temporal_series",
      title: "R2: 列出2015年至2022年每年在建线路总里程数",
      objective: "Research and write cited reportlet material for the annual construction mileage series.",
      acceptanceCriteria: ["提供2015-2022年每年数据，单位公里", "Find direct evidence for: 每年在建线路总里程数"],
    }), node({
      nodeId: "R_temporal_series",
      nodeKind: "hypothesis",
      label: "2015-2022 年在建线路总里程",
    }), 2, "zh-CN");

    expect(parts).toHaveLength(2);
    expect(parts[0]?.researchQuestion).toContain("2015-2018");
    expect(parts[1]?.researchQuestion).toContain("2019-2022");
    expect(parts.every((part) => part.researchQuestion.includes("2015-2022 年在建线路总里程"))).toBe(true);
    expect(parts.every((part) => part.researchQuestion.includes("只负责该时间窗口"))).toBe(true);

    const nineYearParts = agentNodePartPlans(task({
      taskId: "T_temporal_nine_year_series",
      reportNodeId: "R_temporal_nine_year_series",
      title: "2015-2023年每年城市轨道交通运营里程",
      objective: "逐年核验2015年至2023年的运营里程和单位。",
      acceptanceCriteria: ["提供2015-2023年每年数据并注明来源"],
    }), node({
      nodeId: "R_temporal_nine_year_series",
      nodeKind: "hypothesis",
      label: "2015-2023 年城市轨道交通运营里程",
    }), 3, "zh-CN");
    expect(nineYearParts.map((part) => part.researchQuestion)).toEqual([
      expect.stringContaining("2015-2017"),
      expect.stringContaining("2018-2020"),
      expect.stringContaining("2021-2023"),
    ]);
  });

  it("plans required narrative examples as cited internal reportlets instead of table rows", () => {
    const requirement: ResearchRequirement = {
      requirementId: "NARRATIVE_EXAMPLES",
      description: "Analyze breastfeeding, nurturing, and rescue narratives.",
      kind: "question",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Primary texts and scholarship for the named narratives"],
      successCriteria: ["Explain the distinct role of every explicitly requested example."],
      exampleScope: ["Moses", "Mephibosheth", "Joash"],
    };
    const exampleTask = task({
      taskId: "T_narrative_examples",
      reportNodeId: "R_narrative_examples",
      title: "Breastfeeding and nurturing narratives",
      objective: "Research how the named rescue stories contribute to the broader analysis.",
      acceptanceCriteria: ["Cover Moses, Mephibosheth, and Joash with citations."],
    });
    const parts = agentNodePartPlans(exampleTask, node({
      nodeId: "R_narrative_examples",
      nodeKind: "hypothesis",
      label: "Narratives of Breastfeeding and Nurturing",
    }), 4, "en", [requirement]);

    expect(parts).toHaveLength(3);
    expect(parts.map((part) => part.researchQuestion)).toEqual([
      expect.stringContaining('narrative example "Moses"'),
      expect.stringContaining('narrative example "Mephibosheth"'),
      expect.stringContaining('narrative example "Joash"'),
    ]);
    expect(parts.every((part) => part.researchQuestion.includes("Do not substitute another named example"))).toBe(true);
    expect(parts.every((part) => !part.researchQuestion.includes("table row"))).toBe(true);
    expect(evidenceTaskRuntimeBudget({ ...exampleTask, plannedReportlets: parts }, {
      maxReactSteps: 4,
      maxToolCalls: 4,
      maxSearchCalls: 1,
      maxFetchCalls: 1,
    })).toMatchObject({
      maxSearchCalls: 2,
      maxFetchCalls: 3,
      targetSearchCalls: 2,
      targetFetchCalls: 3,
      targetToolCalls: 5,
    });
  });

  it("plans every restarted clinical outline item as an entity-field reportlet with bounded runtime", () => {
    const requirements = normalizeRequirements([{
      id: "workflow",
      description: "Analyze AI optimization across the PET imaging workflow.",
      kind: "question",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["PET workflow studies"],
      successCriteria: ["Explain workflow applications."],
    }, {
      id: "clinical",
      description: "Analyze AI tasks in clinical PET applications.",
      kind: "question",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Clinical PET AI studies"],
      successCriteria: ["Explain clinical applications."],
    }], [], [
      "Cover the applications in the following workflow stages:",
      "1. **Acquisition Enhancement**: Improve signal quality.",
      "2. **Image Reconstruction**: Reconstruct PET images.",
      "3. **Post-processing and Restoration**: Restore images.",
      "4. **Motion Artifact Correction**: Correct motion.",
      "Then cover the following clinical application tasks:",
      "1. **Image Segmentation**: Delineate anatomy and lesions.",
      "2. **Lesion Detection and Classification**: Detect and diagnose lesions.",
      "3. **Quantitative Analysis**: Derive clinical measurements.",
      "4. **Radiotherapy Planning**: Support treatment planning.",
      "5. **Dosimetry**: Personalize dose calculations.",
      "6. **Radiomics and Radiogenomics**: Link imaging and genomic features.",
      "For each application point, explain its **objective**, **main AI techniques used**, and **specific effects or advantages achieved**.",
    ].join("\n"));
    const clinical = requirements.find((requirement) => requirement.requirementId === "CLINICAL")!;
    const clinicalTask = task({
      taskId: "T_pet_clinical",
      reportNodeId: "R_pet_clinical",
      title: "Clinical PET AI applications",
      objective: "Research the six named clinical PET application tasks and their required dimensions.",
      acceptanceCriteria: clinical.successCriteria,
    });
    const parts = agentNodePartPlans(clinicalTask, node({
      nodeId: "R_pet_clinical",
      nodeKind: "hypothesis",
      label: "Clinical PET AI applications",
    }), 8, "en", [clinical]);

    expect(parts).toHaveLength(6);
    expect(parts.map((part) => part.researchQuestion)).toEqual(clinical.entityScope!.map((entity) => (
      expect.stringContaining(`entity profile for "${entity}"`)
    )));
    expect(parts.every((part) => clinical.metricScope!.every((field) => part.researchQuestion.includes(field)))).toBe(true);
    expect(evidenceTaskRuntimeBudget({ ...clinicalTask, plannedReportlets: parts }, {
      maxReactSteps: 12,
      maxToolCalls: 16,
      maxSearchCalls: 3,
      maxFetchCalls: 3,
    })).toMatchObject({
      targetSearchCalls: 3,
      targetFetchCalls: 6,
      targetToolCalls: 9,
      maxFetchCalls: 6,
    });
  });

  it("plans named comparison tables as complete entity rows with bounded tool budgets", () => {
    const frameworkRequirement: ResearchRequirement = {
      requirementId: "FRAMEWORK_TABLE",
      description: "Create a comparison table for Node.js, React.js, jQuery, Angular, and Vue.js.",
      kind: "deliverable",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Official framework documentation and release records"],
      successCriteria: [
        "Every named framework has every requested field.",
        "Assign every scoped entity to exactly one table partition: [JavaScript-based frameworks], [other-language frameworks].",
      ],
      entityScope: ["Node.js", "React.js", "jQuery", "Angular", "Vue.js"],
      metricScope: ["Release Year", "Key Area", "Software Layer", "Architecture", "Storage", "Internationalization", "XSS", "CSRF"],
    };
    const frameworkTask = task({
      taskId: "T_framework_rows",
      reportNodeId: "R_framework_rows",
      title: "JavaScript framework comparison table",
      objective: "Fill complete rows for Node.js, React.js, jQuery, Angular, and Vue.js.",
      acceptanceCriteria: ["Use explicit categorical security values and cite every row."],
    });
    const parts = agentNodePartPlans(frameworkTask, node({
      nodeId: "R_framework_rows",
      nodeKind: "hypothesis",
      label: "JavaScript frameworks",
    }), 8, "zh-CN", [frameworkRequirement]);

    expect(parts).toHaveLength(5);
    expect(parts.map((part) => part.researchQuestion)).toEqual([
      expect.stringContaining("Node.js"),
      expect.stringContaining("React.js"),
      expect.stringContaining("jQuery"),
      expect.stringContaining("Angular"),
      expect.stringContaining("Vue.js"),
    ]);
    expect(parts.every((part) => part.researchQuestion.includes("Release Year") && part.researchQuestion.includes("XSS"))).toBe(true);
    expect(parts.every((part) => (
      part.researchQuestion.includes("恰好归入一个表格分区")
      && part.researchQuestion.includes("JavaScript-based frameworks")
      && part.researchQuestion.includes("other-language frameworks")
    ))).toBe(true);
    expect(evidenceTaskRuntimeBudget({ ...frameworkTask, plannedReportlets: parts }, {
      maxReactSteps: 12,
      maxToolCalls: 16,
      maxSearchCalls: 3,
      maxFetchCalls: 3,
    })).toMatchObject({
      maxSearchCalls: 3,
      maxFetchCalls: 5,
      targetSearchCalls: 3,
      targetFetchCalls: 5,
      targetToolCalls: 8,
    });
  });

  it("plans open taxonomy categories as member discovery reportlets instead of category rows", () => {
    const requirement: ResearchRequirement = {
      requirementId: "SWEETENER_TABLE",
      description: "Create a comprehensive comparison table of common sweeteners with clear categorization.",
      kind: "deliverable",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Authoritative inventories and specifications"],
      successCriteria: ["Discover multiple concrete members in every category."],
      entityScope: ["High-Intensity Sweeteners", "Sugar Alcohols", "Natural Sweeteners"],
      entityScopeRole: "groups",
      metricScope: ["Sweetener Name", "Brand Name", "Primary Uses", "Relative Sweetness"],
    };
    const taxonomyTask = task({
      taskId: "T_sweetener_taxonomy",
      reportNodeId: "R_sweetener_taxonomy",
      title: "Common sweetener comparison",
      objective: "Cover High-Intensity Sweeteners, Sugar Alcohols, and Natural Sweeteners.",
      acceptanceCriteria: ["Make the categorized table as complete as evidence permits."],
    });
    const parts = agentNodePartPlans(taxonomyTask, node({
      nodeId: "R_sweetener_taxonomy",
      nodeKind: "hypothesis",
      label: "Common sweetener categories",
    }), 8, "en", [requirement]);

    expect(parts).toHaveLength(3);
    expect(parts.map((part) => part.researchQuestion)).toEqual([
      expect.stringContaining('taxonomy group member rows for "High-Intensity Sweeteners"'),
      expect.stringContaining('taxonomy group member rows for "Sugar Alcohols"'),
      expect.stringContaining('taxonomy group member rows for "Natural Sweeteners"'),
    ]);
    expect(parts.every((part) => part.researchQuestion.includes("group label is not a final row"))).toBe(true);
    expect(parts.every((part) => part.researchQuestion.includes("Brand Name") && part.researchQuestion.includes("Relative Sweetness"))).toBe(true);
    expect(evidenceTaskRuntimeBudget({ ...taxonomyTask, plannedReportlets: parts }, {
      maxReactSteps: 12,
      maxToolCalls: 16,
      maxSearchCalls: 3,
      maxFetchCalls: 3,
    })).toMatchObject({ targetSearchCalls: 3, targetFetchCalls: 6, maxFetchCalls: 6 });
  });

  it("plans repeated case-study sections as complete entity profiles", () => {
    const requirement: ResearchRequirement = {
      requirementId: "AI_CASES",
      description: "为每个公司或产品设立一个独立章节，形成六个案例研究。",
      kind: "deliverable",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["每个案例的研究或实践证据"],
      successCriteria: ["每个案例分别覆盖核心功能、应用场景和量化成果。"],
      entityScope: ["麦肯锡（McKinsey & Company）", "GitHub Copilot", "IBM", "微软（Microsoft IntelliCode）", "Snyk（Snyk Code）", "谷歌（Google DeepMind AlphaCode）"],
      metricScope: ["核心功能", "应用场景", "量化成果"],
    };
    const caseTask = task({
      taskId: "T_ai_cases",
      reportNodeId: "R_ai_cases",
      title: "AI软件工程案例",
      objective: "研究麦肯锡、GitHub Copilot、IBM、Microsoft IntelliCode、Snyk Code和Google DeepMind AlphaCode。",
      acceptanceCriteria: ["每个案例保留可核验的量化成果。"],
    });
    const parts = agentNodePartPlans(caseTask, node({
      nodeId: "R_ai_cases",
      nodeKind: "hypothesis",
      label: "六个AI软件工程案例",
    }), 8, "zh-CN", [requirement]);

    expect(parts).toHaveLength(6);
    expect(parts.every((part) => part.researchQuestion.includes("案例章节素材"))).toBe(true);
    expect(parts.map((part) => part.researchQuestion)).toEqual([
      expect.stringContaining("麦肯锡"),
      expect.stringContaining("GitHub Copilot"),
      expect.stringContaining("IBM"),
      expect.stringContaining("Microsoft IntelliCode"),
      expect.stringContaining("Snyk Code"),
      expect.stringContaining("Google DeepMind AlphaCode"),
    ]);
    expect(evidenceTaskRuntimeBudget({ ...caseTask, plannedReportlets: parts }, {
      maxReactSteps: 12,
      maxToolCalls: 16,
      maxSearchCalls: 3,
      maxFetchCalls: 3,
    })).toMatchObject({ targetSearchCalls: 3, targetFetchCalls: 6, maxFetchCalls: 6 });
  });

  it("plans compound detail sections and a summary table from shared entity evidence", () => {
    const requirement: ResearchRequirement = {
      requirementId: "MATERIAL_CLASSES",
      description: "将四类候选材料分成四部分分别介绍核心优势、代表性材料、关键性能指标和主要挑战，最后制作总结对比表。",
      kind: "deliverable",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["每类材料的实验与工艺证据"],
      successCriteria: ["四个详细章节和总结表完整覆盖同一组材料类别。"],
      entityScope: ["基于金属的阻挡层", "基于二维材料的阻挡层", "自组装分子层（SAMs）", "高熵合金（HEAs）"],
      metricScope: ["核心优势", "代表性材料", "关键性能指标", "主要挑战"],
    };
    const materialTask = task({
      taskId: "T_material_classes",
      reportNodeId: "R_material_classes",
      title: "四类阻挡层材料",
      objective: "研究基于金属、二维材料、自组装分子层和高熵合金四类阻挡层。",
      acceptanceCriteria: ["每类材料形成详细章节，并能压缩为总结表行。"],
    });
    const parts = agentNodePartPlans(materialTask, node({
      nodeId: "R_material_classes",
      nodeKind: "hypothesis",
      label: "新一代阻挡层材料",
    }), 8, "zh-CN", [requirement]);

    expect(parts).toHaveLength(4);
    expect(parts.every((part) => part.researchQuestion.includes("实体章节与表格素材"))).toBe(true);
    expect(parts.map((part) => part.researchQuestion)).toEqual([
      expect.stringContaining("基于金属的阻挡层"),
      expect.stringContaining("基于二维材料的阻挡层"),
      expect.stringContaining("自组装分子层"),
      expect.stringContaining("高熵合金"),
    ]);
    expect(evidenceTaskRuntimeBudget({ ...materialTask, plannedReportlets: parts }, {
      maxReactSteps: 12,
      maxToolCalls: 16,
      maxSearchCalls: 3,
      maxFetchCalls: 3,
    })).toMatchObject({ targetSearchCalls: 4, targetFetchCalls: 8, maxFetchCalls: 8 });
  });

  it("keeps independent entity-field matrices isolated inside one compressed leaf", () => {
    const taxonomy: ResearchRequirement = {
      requirementId: "PROTEIN_TAXONOMY",
      description: "对 Writers、Erasers 和 Readers 每一类中的主要蛋白详细说明具体功能和相互作用蛋白。",
      kind: "deliverable",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["蛋白功能和相互作用研究"],
      successCriteria: ["三类蛋白分别完整介绍。"],
      entityScope: ["Writers", "Erasers", "Readers"],
      metricScope: ["主要蛋白", "具体功能", "相互作用蛋白"],
    };
    const immuneCells: ResearchRequirement = {
      requirementId: "IMMUNE_CELLS",
      description: "分别介绍 NK细胞、树突状细胞、巨噬细胞和T细胞的调控机制与功能影响，最后制作总结表格。",
      kind: "deliverable",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["细胞机制研究"],
      successCriteria: ["四种细胞各有详细小节和总结表行。"],
      entityScope: ["自然杀伤细胞（NK细胞）", "树突状细胞（DC）", "巨噬细胞", "T细胞"],
      metricScope: ["关键调控蛋白", "调控目标与机制", "对细胞功能的最终影响"],
    };
    const compressedTask = task({
      taskId: "T_m6a_compressed",
      reportNodeId: "R_m6a_compressed",
      title: "m6A蛋白分类与免疫细胞机制",
      objective: "研究 Writers、Erasers、Readers，以及NK细胞、DC、巨噬细胞和T细胞。",
      acceptanceCriteria: ["两套分类分别使用自己的字段。"],
    });
    const parts = agentNodePartPlans(compressedTask, node({
      nodeId: "R_m6a_compressed",
      nodeKind: "hypothesis",
      label: "m6A调控全景",
    }), 10, "zh-CN", [taxonomy, immuneCells]);

    expect(parts).toHaveLength(7);
    const writer = parts.find((part) => part.researchQuestion.includes("Writers"))!;
    const nk = parts.find((part) => part.researchQuestion.includes("自然杀伤细胞"))!;
    expect(writer.researchQuestion).toContain("相互作用蛋白");
    expect(writer.researchQuestion).not.toContain("调控目标与机制");
    expect(nk.researchQuestion).toContain("调控目标与机制");
    expect(nk.researchQuestion).not.toContain("相互作用蛋白");
    expect(evidenceTaskRuntimeBudget({ ...compressedTask, plannedReportlets: parts }, {
      maxReactSteps: 12,
      maxToolCalls: 16,
      maxSearchCalls: 3,
      maxFetchCalls: 3,
    })).toMatchObject({ targetSearchCalls: 6, targetFetchCalls: 11, maxFetchCalls: 11 });
  });

  it("splits long policy timelines into milestone reportlets without inventing annual events", () => {
    const timelineTask = task({
      taskId: "T_policy_timeline",
      reportNodeId: "R_policy_timeline",
      title: "Chronological overview of organ-transplant policy changes",
      objective: "Organize key policies, regulations, official statements, significant events, and relevant data from 2005 to the end of 2015 in chronological order.",
      acceptanceCriteria: [
        "Explain the relationship with the prior 1984 regulation.",
        "Cover the main 2005-2015 milestones and transitions with dated citations.",
        "Do not imply that every year contained a policy event.",
      ],
    });
    const parts = agentNodePartPlans(timelineTask, node({
      nodeId: "R_policy_timeline",
      nodeKind: "hypothesis",
      label: "China organ-transplant policy chronology",
      scopeNote: "Trace official policy, implementation, and international reactions.",
    }), 4, "en");

    expect(parts.map((part) => part.researchQuestion)).toEqual([
      expect.stringContaining("pre-2005 foundations (explicitly named earlier year(s): 1984)"),
      expect.stringContaining("2005-2008"),
      expect.stringContaining("2009-2012"),
      expect.stringContaining("2013-2015"),
    ]);
    expect(parts.every((part) => part.researchQuestion.includes("do not require an event in every year")
      || part.researchQuestion.includes("do not broaden into unrelated history"))).toBe(true);
    expect(parts.every((part) => part.writingGoal.includes("reusable reportlet"))).toBe(true);

    const budget = evidenceTaskRuntimeBudget({ ...timelineTask, plannedReportlets: parts }, {
      maxReactSteps: 12,
      maxToolCalls: 16,
      maxSearchCalls: 3,
      maxFetchCalls: 3,
    });
    expect(budget).toMatchObject({ maxSearchCalls: 4, maxFetchCalls: 8, targetSearchCalls: 4, targetFetchCalls: 4 });
  });

  it("does not time-shard a publication-window literature review", () => {
    const parts = agentNodePartPlans(task({
      taskId: "T_literature_window",
      reportNodeId: "R_literature_window",
      title: "Chronological review of K-12 intelligent tutoring research",
      objective: "Review empirical studies published from 2009-2024 and summarize geography, author backgrounds, and subjects.",
      acceptanceCriteria: ["Cover the research literature published during the stated window."],
    }), node({
      nodeId: "R_literature_window",
      nodeKind: "hypothesis",
      label: "K-12 intelligent tutoring research overview",
    }), 4, "en");

    expect(parts).toHaveLength(1);
    expect(parts[0]?.researchQuestion).not.toMatch(/Trace\s+20\d{2}-20\d{2}/u);
    expect(parts[0]?.researchQuestion).not.toContain("do not require an event in every year");
  });

  it("keeps temporal decomposition for broad follow-up repairs without resplitting atomic repairs", () => {
    const reportNode = node({
      nodeId: "R_temporal_repair",
      nodeKind: "hypothesis",
      label: "2015-2022 年在建线路总里程",
    });
    const broadRepair = task({
      taskId: "T_completion_gap_R_temporal_missing_data",
      reportNodeId: reportNode.nodeId,
      title: "补齐年度数据缺口",
      objective: "补齐2015年至2022年每年在建线路总里程数。",
      acceptanceCriteria: ["逐年提供2015-2022年数据，单位公里"],
    });

    const parts = agentNodePartPlans(broadRepair, reportNode, 2, "zh-CN");
    expect(parts.map((part) => part.researchQuestion)).toEqual([
      expect.stringContaining("2015-2018"),
      expect.stringContaining("2019-2022"),
    ]);
    expect(evidenceTaskRuntimeBudget({ ...broadRepair, plannedReportlets: parts }, {
      maxReactSteps: 12,
      maxToolCalls: 11,
      maxSearchCalls: 2,
      maxFetchCalls: 3,
    })).toMatchObject({ maxSearchCalls: 2, maxFetchCalls: 4, targetSearchCalls: 2, targetFetchCalls: 2 });

    const atomicRepair = task({
      ...broadRepair,
      taskId: "T_completion_gap_R_temporal_planned_part",
      plannedReportlet: {
        partId: "P_2",
        parentAgentTaskId: "T_temporal_original",
        parentReportNodeId: reportNode.nodeId,
        researchQuestion: "仅补齐2019-2022年",
        searchGoal: "查找2019-2022年数据",
        writingGoal: "写出2019-2022年数据",
        expectedHeading: "2019-2022年",
        evidenceNeeds: ["年度数据"],
      },
    });
    expect(agentNodePartPlans(atomicRepair, reportNode, 2, "zh-CN")).toEqual([]);

    const nonTemporalRepair = task({
      taskId: "T_repair_R_temporal_source_quality",
      reportNodeId: reportNode.nodeId,
      objective: "寻找一个独立来源交叉验证现有结论。",
      acceptanceCriteria: ["新增一个独立权威来源", "核验统计口径", "记录来源发布日期"],
    });
    expect(agentNodePartPlans(nonTemporalRepair, reportNode, 3, "zh-CN")).toEqual([]);
  });

  it("balances oversized requirement lists across bounded reportlets and drops process-only criteria", () => {
    const systems = ["地铁", "轻轨", "单轨", "市域快轨", "有轨电车", "磁浮", "自动旅客捷运", "智轨", "胶轮捷运", "悬挂式单轨"];
    const parts = agentNodePartPlans(task({
      taskId: "T_system_mileage",
      reportNodeId: "R_system_mileage",
      title: "城轨系统制式构成",
      objective: "整理十种城市轨道交通制式的总运营里程。",
      acceptanceCriteria: [
        ...systems.map((system) => `核验${system}截至2023年底的总运营里程并注明来源。`),
        "Inspect at least one full authoritative or primary source for the focused requirement.",
        "Corroborate consequential claims with an independent source and record unresolved boundaries.",
      ],
    }), node({
      nodeId: "R_system_mileage",
      nodeKind: "hypothesis",
      label: "截至2023年底十种城轨制式的总运营里程",
    }), 3, "zh-CN");

    expect(parts).toHaveLength(3);
    expect(parts[0]?.researchQuestion).toContain("地铁");
    expect(parts[0]?.researchQuestion).toContain("市域快轨");
    expect(parts[0]?.researchQuestion).not.toContain("有轨电车");
    expect(parts[1]?.researchQuestion).toContain("有轨电车");
    expect(parts[1]?.researchQuestion).toContain("自动旅客捷运");
    expect(parts[1]?.researchQuestion).not.toContain("智轨");
    expect(parts[2]?.researchQuestion).toContain("智轨");
    expect(parts[2]?.researchQuestion).toContain("悬挂式单轨");
    expect(parts.every((part) => !part.researchQuestion.includes("Inspect at least one"))).toBe(true);
    expect(parts.every((part) => !part.researchQuestion.includes("Corroborate consequential"))).toBe(true);
  });

  it("consolidates soft regional row gaps into one collective remaining-row gap", async () => {
    const runtimeProfile = loadDefaultRuntimeProfile();
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_collective_row_gap";
    const rowCriteria = [
      "Aim to contribute about 5 distinct regional studies; this is a search allocation, not a per-region minimum. Only the collective minimum of 15 studies is mandatory.",
    ];
    for (let index = 1; index <= 3; index += 1) {
      const reportNodeId = `R_rows_${index}`;
      await ctx.stack.kg.upsertReportNode(node({ nodeId: reportNodeId, nodeKind: "hypothesis", label: `Row batch ${index}` }));
      await ctx.stack.ledger.upsert(task({
        taskId: `T_rows_${index}`,
        reportNodeId,
        acceptanceCriteria: rowCriteria,
      }));
    }
    for (let index = 1; index <= 13; index += 1) {
      const reportNodeId = `R_rows_${((index - 1) % 3) + 1}`;
      const source: KnowledgeNode = {
        nodeId: `K_rows_${index}`,
        nodeType: "Paper",
        title: `Primary row study ${index}`,
        url: `https://journal${index}.example/study`,
        contentHash: `hash:rows:${index}`,
        summary: "Eligible primary study with complete review-table fields.",
        sourceTier: "primary",
        qualityScore: 0.8,
        retrievedByTaskId: `T_rows_${((index - 1) % 3) + 1}`,
        retrievedAt: new Date(fixedNow()).toISOString(),
        metadata: {},
      };
      await ctx.stack.kg.upsertKnowledgeNode(source);
      await ctx.stack.kg.upsertEvidenceLink({
        linkId: `E_rows_${index}`,
        reportNodeId,
        knowledgeNodeId: source.nodeId,
        relation: "supports",
        claimText: `Complete table row ${index}.`,
        confidence: 0.8,
        createdByTaskId: source.retrievedByTaskId,
        createdAt: source.retrievedAt,
      });
      await ctx.stack.kg.upsertReportlet?.({
        reportletId: `RL_rows_${index}`,
        reportNodeId,
        taskId: source.retrievedByTaskId,
        title: `Complete row ${index}`,
        markdown: completeStudyRowMarkdown(index, `E_rows_${index}`),
        citedEvidenceLinkIds: [`E_rows_${index}`],
        citedKnowledgeNodeIds: [source.nodeId],
        createdAt: source.retrievedAt,
        updatedAt: source.retrievedAt,
      });
    }
    await ctx.stack.kg.addOpenGap?.({
      gapType: "missing_studies",
      description: "Need 3 additional European studies to reach target of 5 rows.",
      suggestedQuery: "European studies",
      reportNodeId: "R_rows_2",
      taskId: "T_rows_2",
      impact: "medium",
      status: "open",
    });
    await ctx.stack.kg.addOpenGap?.({
      gapType: "planned_reportlet_not_completed",
      description: "报告任务 P_5 未完成：Study row 5 of 5: identify one distinct eligible primary study.",
      suggestedQuery: "row five",
      reportNodeId: "R_rows_3",
      taskId: "T_rows_3",
      impact: "medium",
      status: "open",
    });
    await ctx.stack.kg.addOpenGap?.({
      gapType: "insufficient_studies",
      description: "Only 5 rows were provided; need at least 15 studies total across all geographic groups.",
      suggestedQuery: "more European and African studies",
      reportNodeId: "R_rows_2",
      taskId: "T_rows_2",
      impact: "medium",
      status: "open",
    });
    await ctx.stack.kg.addOpenGap?.({
      gapType: "incomplete_source",
      description: "One included study is missing its exact sample size.",
      suggestedQuery: "exact sample size",
      reportNodeId: "R_rows_1",
      taskId: "T_rows_1",
      impact: "medium",
      status: "open",
    });

    const first = await consolidateCountedRowGaps(ctx);
    const firstGaps = await ctx.stack.kg.listOpenGaps?.() ?? [];
    expect(first).toMatchObject({ sourceCount: 13, collectiveMinimum: 15, remaining: 2, closedSoftGapCount: 3 });
    expect(firstGaps.filter((gap) => gap.gapType === "counted_rows_remaining" && gap.status === "open")).toEqual([
      expect.objectContaining({ description: expect.stringContaining("needs 2 additional distinct eligible primary studies from any geography") }),
    ]);
    expect(firstGaps.find((gap) => gap.gapType === "incomplete_source")?.status).toBe("open");
    expect(isCompleteStudyRowReportlet({
      markdown: completeStudyRowMarkdown(99, "E_invalid").replace("**Sample Size:** 199", "**Sample Size:** Not reported"),
      citedKnowledgeNodeIds: ["K_invalid"],
    })).toBe(false);
    expect(isCompleteStudyRowReportlet({
      markdown: completeStudyRowMarkdown(99, "E_invalid")
        .replace("**Sample Size:** 199", "**Sample Size:** Survey of three universities; response rate 44.5%")
        .replace("**Finding on Effectiveness:** Effective", "**Finding on Effectiveness:** Mixed"),
      citedKnowledgeNodeIds: ["K_invalid"],
    })).toBe(false);

    const consolidatedReflection = await consolidateCountedRowRepairRequests(ctx, {
      continueDispatch: true,
      taskUpdates: [],
      newTasks: [{
        parentTaskId: "T_root",
        reportNodeId: "R_rows_1",
        title: "Find 3 additional Asia-Pacific studies",
        objective: "Find more regional studies to complete rows 3-5.",
        priority: 80,
        acceptanceCriteria: ["Add three studies."],
      }, {
        parentTaskId: "T_root",
        reportNodeId: "R_rows_2",
        title: "Find 4 additional European studies",
        objective: "Reach the regional target of five studies.",
        priority: 80,
        acceptanceCriteria: ["Add four studies."],
      }, {
        parentTaskId: "T_root",
        reportNodeId: "R_other",
        title: "Repair methodology synthesis",
        objective: "Find longitudinal evidence.",
        priority: 70,
        acceptanceCriteria: ["Add methodology evidence."],
      }],
      skipReasons: [],
    }, first, [], { currentCycle: 1, maxCycles: 2 });
    expect(consolidatedReflection.newTasks.map((request) => request.title)).toEqual([
      "Fill global summary-table row deficit",
      "Repair methodology synthesis",
    ]);
    expect(consolidatedReflection.newTasks[0]).toMatchObject({
      reportNodeId: "R_rows_1",
      objective: expect.stringContaining("Find 2 additional distinct eligible primary studies from any geography"),
    });
    expect(consolidatedReflection.newTasks[0]?.acceptanceCriteria[0]).toContain("Only the collective minimum of 15 studies is mandatory");
    await ctx.stack.ledger.upsert(task({
      taskId: "T_completion_rows_old_1",
      reportNodeId: "R_rows_1",
      title: "Old row-node repair 1",
      status: "completed",
    }));
    await ctx.stack.ledger.upsert(task({
      taskId: "T_completion_rows_old_2",
      reportNodeId: "R_rows_1",
      title: "Old row-node repair 2",
      status: "completed",
    }));
    expect(await shouldCreateReflectionTask(ctx, consolidatedReflection.newTasks[0]!)).toBe(true);
    for (let index = 1; index <= 3; index += 1) {
      await ctx.stack.ledger.upsert(task({
        taskId: `T_reflect_global_rows_${index}`,
        reportNodeId: "R_rows_1",
        title: "Fill global summary-table row deficit",
        status: "completed",
      }));
    }
    expect(await shouldCreateReflectionTask(ctx, consolidatedReflection.newTasks[0]!)).toBe(false);

    for (let index = 14; index <= 15; index += 1) {
      const source: KnowledgeNode = {
        nodeId: `K_rows_${index}`,
        nodeType: "Paper",
        title: `Primary row study ${index}`,
        url: `https://journal${index}.example/study`,
        contentHash: `hash:rows:${index}`,
        summary: "Eligible primary study with complete review-table fields.",
        sourceTier: "primary",
        qualityScore: 0.8,
        retrievedByTaskId: "T_rows_1",
        retrievedAt: new Date(fixedNow()).toISOString(),
        metadata: {},
      };
      await ctx.stack.kg.upsertKnowledgeNode(source);
      await ctx.stack.kg.upsertEvidenceLink({
        linkId: `E_rows_${index}`,
        reportNodeId: "R_rows_1",
        knowledgeNodeId: source.nodeId,
        relation: "supports",
        claimText: `Complete table row ${index}.`,
        confidence: 0.8,
        createdByTaskId: "T_rows_1",
        createdAt: source.retrievedAt,
      });
      await ctx.stack.kg.upsertReportlet?.({
        reportletId: `RL_rows_${index}`,
        reportNodeId: "R_rows_1",
        taskId: "T_rows_1",
        title: `Complete row ${index}`,
        markdown: completeStudyRowMarkdown(index, `E_rows_${index}`),
        citedEvidenceLinkIds: [`E_rows_${index}`],
        citedKnowledgeNodeIds: [source.nodeId],
        createdAt: source.retrievedAt,
        updatedAt: source.retrievedAt,
      });
    }
    const complete = await consolidateCountedRowGaps(ctx);
    const finalGaps = await ctx.stack.kg.listOpenGaps?.() ?? [];
    expect(complete).toMatchObject({ sourceCount: 15, remaining: 0 });
    expect(finalGaps.find((gap) => gap.gapType === "counted_rows_remaining")?.status).toBe("closed");
    expect(finalGaps.find((gap) => gap.gapType === "incomplete_source")?.status).toBe("open");
  });

  it("turns atomically harvested rows into cited reportlets even when the outer agent immediately finishes", async () => {
    let outerCalls = 0;
    const llm: LlmChat = {
      name: "atomic-row-harvest-fixture",
      async chat(req) {
        if (req.system?.includes("extract complete study-table rows")) {
          return { content: JSON.stringify({ rows: [{
            candidateUrl: "https://journal.test/atomic-a",
            title: "Atomic study A",
            authors: ["Alice Author"],
            country: "Canada",
            sampleSize: "350 students",
            researchDesign: "Cross-sectional perceptual survey",
            outcomeVariable: "Academic performance",
            findingLabel: "Effective",
            findingExplanation: "Online learning improved academic performance.",
            publicationYear: 2022,
            eligiblePrimaryStudy: true,
          }, {
            candidateUrl: "https://journal.test/atomic-b",
            title: "Atomic study B",
            authors: ["Carlos Researcher"],
            country: "India",
            sampleSize: "120 students",
            researchDesign: "Comparative experiment",
            outcomeVariable: "Final examination achievement",
            findingLabel: "Ineffective",
            findingExplanation: "Online students had lower final examination achievement.",
            publicationYear: 2021,
            eligiblePrimaryStudy: true,
          }] }) };
        }
        outerCalls += 1;
        if (outerCalls === 1) {
          return { content: JSON.stringify({
            thoughtSummary: "Harvest the counted rows atomically.",
            action: "tool",
            toolName: "harvest_counted_rows",
            args: {},
          }) };
        }
        return { content: JSON.stringify({
          thoughtSummary: "Use the rows already saved by the atomic harvest.",
          action: "finish",
          finish: {
            relation: "supports",
            claimText: "Two complete study rows were harvested.",
            confidence: 0.82,
            nodeStatus: "partially_supported",
            reasoningSummary: "Atomic harvest completed two row slots.",
            completedReportlets: [],
            openGaps: [],
            structurePatchSuggestions: [],
          },
        }) };
      },
    };
    const search: SearchProvider = {
      name: "atomic-row-search",
      async search() {
        return [
          { url: "https://journal.test/atomic-a", title: "Atomic study A (2022)", snippet: "Alice Author surveyed 350 Canadian students and reported effectiveness outcomes." },
          { url: "https://journal.test/atomic-b", title: "Atomic study B (2021)", snippet: "Carlos Researcher compared 120 students in India and reported achievement results." },
        ];
      },
    };
    const fetch: FetchProvider = {
      name: "atomic-row-fetch",
      async fetchPage(url) {
        return url.endsWith("atomic-a")
          ? { url, title: "Atomic study A (2022)", content: "Alice Author conducted a 2022 cross-sectional survey in Canada with a sample of 350 university students. Results showed effective online learning for academic performance." }
          : { url, title: "Atomic study B (2021)", content: "Carlos Researcher conducted a 2021 comparative experiment in India with 120 university students. Results found online learning ineffective for final examination achievement." };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, llm, search, fetch });
    ctx.state.episodeId = "EP_atomic_rows";
    ctx.state.globalRubric = {
      rubricId: "RB_atomic_rows",
      episodeId: ctx.state.episodeId,
      rubricText: "Review empirical studies published from 2020 through 2023.",
      outputHints: { language: "en", citationRequired: true, format: "markdown" },
      requirements: [],
    };
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_atomic_rows",
      nodeKind: "hypothesis",
      label: "Atomic counted study rows",
    }));
    await ctx.stack.ledger.upsert(task({
      taskId: "T_atomic_rows",
      reportNodeId: "R_atomic_rows",
      objective: "Find two complete empirical study rows.",
      acceptanceCriteria: [
        "Aim to contribute about 2 distinct eligible primary studies from any geography.",
        "Verify every study falls within 2020 through 2023.",
        "For every study, fill Authors, Country, Sample Size, Research Design, Outcome Variable, and Finding on Effectiveness.",
      ],
    }));

    const [result] = await dispatchEvidencePhase(ctx, "C_001");
    const reportlets = await ctx.stack.kg.listReportlets?.() ?? [];

    expect(result).toMatchObject({
      knowledgeNodeIds: expect.arrayContaining([expect.stringMatching(/^K_/), expect.stringMatching(/^K_/)]),
      evidenceLinkIds: expect.arrayContaining([expect.stringMatching(/^E_/), expect.stringMatching(/^E_/)]),
      reportletIds: expect.arrayContaining([expect.stringMatching(/^RL_/), expect.stringMatching(/^RL_/)]),
    });
    expect(reportlets).toHaveLength(2);
    expect(reportlets.map((reportlet) => reportlet.plannedReportlet?.partId)).toEqual(["P_1", "P_2"]);
    expect(reportlets.every((reportlet) => isCompleteStudyRowReportlet(reportlet))).toBe(true);
    expect(reportlets.every((reportlet) => reportlet.markdown.includes("[E:"))).toBe(true);
  });
});
