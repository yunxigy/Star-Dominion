import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ArchitectTreePlan } from "../types.js";
import type { EvidenceLink, KnowledgeNode, ReportBundle, ReportNode, ResearchRequirement } from "@deepresearch/contracts";
import { assignRequirements, sanitizeUnverifiedPlanFacts } from "../phases/architect-tree.js";
import { normalizeRequirements } from "../phases/rubric.js";
import { auditEvidenceQuality, DEFAULT_EVIDENCE_QUALITY_POLICY } from "../evidence-quality.js";
import { loadDefaultRuntimeProfile } from "../infra/config.js";
import { EchoJsonLlm } from "../infra/mock-llm.js";
import { createPhaseContext } from "../phase-runner.js";
import { completionGatePhase } from "../phases/completion-gate.js";
import { authorityFirstScoutQueries } from "../source-discovery.js";

describe("structured research requirements", () => {
  it("removes architect-invented factual values while preserving a user-provided legal identifier", () => {
    const sanitized = sanitizeUnverifiedPlanFacts({ aspects: [{
      label: "Regulation (EU) 2023/1542 targets",
      scopeNote: "Verify the regulation.",
      hypotheses: [{
        statement: "Collection targets are 45% in 2023 and 65% in 2025.",
        researchBrief: "Extract the values from Article 60.",
        evidenceGuidance: "Confirm the target years and percentages.",
      }],
      tasks: [{
        title: "Verify targets",
        objective: "Confirm Article 60 and the 2025 target.",
        acceptanceCriteria: ["Confirm 45% and 65% as official targets."],
      }],
    }] }, "Use Regulation (EU) 2023/1542 to identify the official targets.");
    const text = JSON.stringify(sanitized);
    expect(text).toContain("2023/1542");
    expect(text).not.toMatch(/45%|65%|2025|Article 60/u);
    expect(text).toContain("exact percentage to verify");
    expect(text).toContain("the applicable article");
  });

  it("marks architect-supplied authors and years as hypotheses when the user did not provide the year", () => {
    const sanitized = sanitizeUnverifiedPlanFacts({ aspects: [{
      label: "Classic theories",
      scopeNote: "Research originators and proposal years.",
      hypotheses: [{
        statement: "Classic theories require verification.",
        researchBrief: "MPT was proposed by Markowitz in 1952.",
        evidenceGuidance: "Use the 1952 paper.",
      }],
      tasks: [{
        title: "Verify MPT",
        objective: "Confirm Markowitz and 1952.",
        acceptanceCriteria: ["MPT includes Markowitz (1952) and the efficient frontier."],
      }],
    }] }, "Identify the originator, year of proposal, and core ideas for MPT.");

    const text = JSON.stringify(sanitized);
    expect(text).not.toContain("1952");
    expect(sanitized.aspects[0]?.hypotheses[0]?.researchBrief).toMatch(/^To verify:/u);
    expect(sanitized.aspects[0]?.tasks[0]?.acceptanceCriteria[0]).toMatch(/^To verify:/u);
    expect(text).toContain("the applicable year");
  });

  it("normalizes malformed model output into stable, testable requirements", () => {
    const requirements = normalizeRequirements([
      {
        id: "core policy",
        question: "Compare the two policy mechanisms.",
        priority: "should",
        kind: "comparison",
        evidenceNeeds: "Official policy text",
        entityScope: ["Product A", "Product B"],
        metricScope: ["Cost", "Coverage", "Security and Privacy"],
        successCriteria: ["Names the main trade-off"],
        temporalScope: { mode: "current", maxAgeDays: 90 },
      },
      {
        id: "core policy",
        description: "Assess implementation risk.",
        priority: "exploratory",
      },
    ], [], "Research the policy.");

    expect(requirements).toHaveLength(2);
    expect(requirements[0]).toMatchObject({
      requirementId: "CORE_POLICY",
      priority: "must",
      kind: "comparison",
      evidenceNeeds: ["Official policy text"],
      entityScope: ["Product A", "Product B"],
      metricScope: ["Cost", "Coverage", "Security and Privacy"],
      successCriteria: ["Names the main trade-off"],
      failurePolicy: "degrade",
      visibility: "reader",
      temporalScope: { mode: "timeless" },
    });
    expect(requirements[1]?.requirementId).toBe("CORE_POLICY_2");
  });

  it("recovers a named-primary-sufficient policy only for requirements tied to one identified official text", () => {
    const requirements = normalizeRequirements([
      {
        requirementId: "R1",
        description: "Extract collection targets from Regulation (EU) 2023/1542.",
        kind: "question",
        priority: "must",
        evidenceRequired: true,
        evidenceNeeds: ["EUR-Lex Regulation (EU) 2023/1542"],
        successCriteria: ["List each collection target"],
      },
      {
        requirementId: "R2",
        description: "Explain an unrelated implementation comparison.",
        kind: "comparison",
        priority: "must",
        evidenceRequired: true,
        evidenceNeeds: ["Independent implementation evidence"],
        successCriteria: ["Compare implementation"],
      },
    ], [], "依据 EUR-Lex 上 Regulation (EU) 2023/1542 的正式文本，提取收集目标；另比较各国实施情况。");

    expect(requirements[0]?.sourcePolicy).toEqual({
      mode: "named_primary_sufficient",
      sources: [{
        title: "EUR-Lex 上 Regulation (EU) 2023/1542",
        identifiers: ["2023/1542"],
      }],
    });
    expect(requirements[0]?.renderedExclusions).toBeUndefined();
    expect(requirements[1]?.sourcePolicy).toBeUndefined();

    const [generic] = normalizeRequirements([{
      requirementId: "R_GENERIC",
      description: "Assess battery policy.",
      evidenceRequired: true,
      evidenceNeeds: ["Official sources"],
      successCriteria: ["Cited assessment"],
    }], [], "评估电池政策，优先使用官方来源。");
    expect(generic?.sourcePolicy).toBeUndefined();
  });

  it("binds an explicit excluded quantitative scope to the matching substantive requirement", () => {
    const requirements = normalizeRequirements([
      {
        requirementId: "R_COLLECTION",
        description: "Extract portable-battery collection targets.",
        evidenceRequired: true,
        evidenceNeeds: ["Article 59"],
        successCriteria: ["List collection rates"],
      },
      {
        requirementId: "R_LITHIUM",
        description: "Extract lithium recovery targets from Annex XII Part C.",
        evidenceRequired: true,
        evidenceNeeds: ["Annex XII Part C recovery of materials"],
        successCriteria: ["Use Part C rather than Part B recycling efficiency"],
      },
    ], [], "提取收集目标和锂材料回收目标；锂目标只采用 Annex XII Part C，不要混入 Part B 的整电池 recycling efficiency。");

    expect(requirements.find((requirement) => requirement.requirementId === "R_COLLECTION")?.renderedExclusions).toBeUndefined();
    expect(requirements.find((requirement) => requirement.requirementId === "R_LITHIUM")?.renderedExclusions).toEqual([{
      scope: "Part B 的整电池 recycling efficiency",
      aliases: ["Part B", "recycling efficiency"],
      mode: "quantitative_claims",
    }]);
  });

  it("recovers English quantitative and all-mentions exclusions with distinct modes", () => {
    const quantitative = normalizeRequirements([{
      requirementId: "R_PART_C",
      description: "Extract Part C lithium recovery targets.",
      evidenceRequired: true,
      evidenceNeeds: ["Annex XII Part C"],
      successCriteria: ["Do not mix in Part B efficiency values"],
    }], [], "Use Annex XII Part C lithium targets; do not mix in Part B recycling efficiency values.");
    const allMentions = normalizeRequirements([{
      requirementId: "R_ALLOWED",
      description: "Use the allowed appendix.",
      evidenceRequired: true,
      evidenceNeeds: ["Allowed appendix"],
      successCriteria: ["Never cite Appendix Z"],
    }], [], "Use the allowed appendix and never cite Appendix Z.");

    expect(quantitative[0]?.renderedExclusions).toEqual([expect.objectContaining({
      scope: "Part B recycling efficiency values",
      mode: "quantitative_claims",
    })]);
    expect(allMentions[0]?.renderedExclusions).toEqual([expect.objectContaining({
      scope: "Appendix Z",
      mode: "all_mentions",
    })]);
  });

  it("keeps current freshness only when the user explicitly requests it", () => {
    const [requirement] = normalizeRequirements([{
      requirementId: "RQ_CURRENT",
      description: "Compare the current policy mechanisms.",
      priority: "must",
      temporalScope: { mode: "current", basis: "source_publication", maxAgeDays: 90 },
    }], [], "Compare the latest policy mechanisms currently in force.");
    expect(requirement?.temporalScope).toMatchObject({ mode: "current", basis: "source_publication", maxAgeDays: 90 });
  });

  it("removes model-invented list and table formatting while preserving substantive obligations", () => {
    const [requirement] = normalizeRequirements([{
      requirementId: "REQ_INDICATIONS",
      description: "比较FDA与EMA的适应症表格。",
      kind: "comparison",
      priority: "must",
      successCriteria: ["报告包含FDA批准的适应症列表", "报告包含EMA批准的适应症清单"],
    }], [], "比较 FDA 与 EMA 关于 Casgevy 的正式适应症材料，明确表述差异。");

    expect(requirement).toMatchObject({
      description: "比较FDA与EMA的适应症内容。",
      kind: "comparison",
      successCriteria: ["报告包含FDA批准的适应症内容", "报告包含EMA批准的适应症内容"],
    });
  });

  it("preserves list and table contracts explicitly requested by the user", () => {
    const [list] = normalizeRequirements([{
      requirementId: "REQ_LIST",
      description: "Provide a list of approved indications.",
      kind: "deliverable",
      priority: "must",
      successCriteria: ["The report contains a list of FDA indications."],
    }], [], "Provide a bullet list of FDA-approved indications.");
    const [table] = normalizeRequirements([{
      requirementId: "REQ_TABLE",
      description: "用表格比较FDA与EMA。",
      kind: "deliverable",
      priority: "must",
      successCriteria: ["报告包含FDA与EMA对比表"],
    }], [], "请用表格比较FDA与EMA的适应症。");

    expect([list?.description, ...(list?.successCriteria ?? [])].join(" ")).toMatch(/list/iu);
    expect([table?.description, ...(table?.successCriteria ?? [])].join(" ")).toMatch(/表格|对比表/u);
  });

  it("recovers regulator comparison subjects instead of product aliases", () => {
    const requirements = normalizeRequirements([1, 2, 3].map((index) => ({
      requirementId: `REQ_${index}`,
      description: index === 1
        ? "比较FDA与EMA关于Casgevy的适应症。"
        : index === 2
          ? "比较FDA与EMA关于Casgevy的批准时间。"
          : "比较FDA与EMA关于Casgevy的作用方式描述。",
      kind: "comparison",
      priority: "must",
      entityScope: ["Casgevy", "exagamglogene autotemcel"],
      metricScope: [index === 1 ? "适应症" : index === 2 ? "批准时间" : "作用方式"],
    })), [], "比较 FDA 与 EMA 关于 Casgevy（exagamglogene autotemcel）的正式监管材料：适应症、关键批准时间和作用方式。");

    expect(requirements.map((requirement) => requirement.entityScope)).toEqual([
      ["FDA", "EMA"],
      ["FDA", "EMA"],
      ["FDA", "EMA"],
    ]);
  });

  it("does not promote generic fallback hints into fake user requirements", () => {
    const requirements = normalizeRequirements(undefined, ["Background", "Evidence", "Risks"], "Compare policy A and B.");
    expect(requirements).toHaveLength(1);
    expect(requirements[0]).toMatchObject({
      requirementId: "RQ_01",
      description: "Compare policy A and B.",
      priority: "must",
      evidenceRequired: true,
    });
  });

  it("removes model-invented numeric thresholds unless the user explicitly requested one", () => {
    const [unbounded] = normalizeRequirements([{
      requirementId: "RQ_COMPARE",
      description: "Compare the two sources.",
      kind: "comparison",
      priority: "must",
      successCriteria: ["Give at least two reasons.", "说明具体互补点（至少两个）"],
    }], [], "Compare source A and source B.");
    expect(unbounded?.successCriteria).toEqual(["Give reasons.", "说明具体互补点"]);

    const [bounded] = normalizeRequirements([{
      requirementId: "RQ_COMPARE",
      description: "Compare the sources.",
      kind: "comparison",
      priority: "must",
      successCriteria: ["Give at least three reasons."],
    }], [], "Give at least three reasons comparing source A and source B.");
    expect(bounded?.successCriteria).toEqual(["Give at least three reasons."]);
  });

  it("normalizes non-waivable source policy independently from reader visibility", () => {
    const [policy] = normalizeRequirements([{
      requirementId: "SOURCE_GUARD",
      description: "Do not search, open, use, or cite the forbidden reference.",
      kind: "risk",
      priority: "must",
      evidenceRequired: false,
      failurePolicy: "degrade",
      visibility: "reader",
      evidenceNeeds: [],
      successCriteria: ["The forbidden source is never used."],
    }], [], "Research the topic without the forbidden reference.");

    expect(policy).toMatchObject({
      failurePolicy: "block",
      visibility: "internal",
    });
  });

  it("turns a literature cutoff into a source-publication boundary", () => {
    const [requirement] = normalizeRequirements([{
      id: "academic_cutoff",
      description: "Limit the survey to academic perspectives from 2018 and earlier.",
      kind: "constraint",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Eligible academic literature"],
      successCriteria: ["Every cited academic perspective is within the cutoff."],
      temporalScope: { mode: "historical" },
    }], [], "Survey the academic literature.");

    expect(requirement?.temporalScope).toEqual({
      mode: "as_of",
      basis: "source_publication",
      asOf: "2018-12-31",
      start: undefined,
      end: undefined,
      maxAgeDays: undefined,
    });
  });

  it("normalizes exclusive month cutoffs and propagates a global report boundary", () => {
    const requirements = normalizeRequirements([{
      id: "global_availability_cutoff",
      description: "The report content should be limited to technologies publicly available before March 2025.",
      kind: "constraint",
      priority: "must",
      evidenceRequired: false,
      successCriteria: ["Exclude technologies first made public in March 2025 or later."],
      temporalScope: { mode: "as_of", basis: "covered_period", asOf: "2025-03-01" },
    }, {
      id: "attack_table",
      description: "Create the attack technology overview table.",
      kind: "deliverable",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Publicly available attack technologies"],
      successCriteria: ["The attack table is complete."],
    }, {
      id: "defense_table",
      description: "Create the defense technology overview table.",
      kind: "deliverable",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Publicly available defense technologies"],
      successCriteria: ["The defense table is complete."],
    }], [], "Survey secure Wi-Fi sensing.");

    expect(requirements.map((requirement) => requirement.temporalScope)).toEqual([
      expect.objectContaining({ mode: "as_of", basis: "covered_period", asOf: "2025-02-28" }),
      expect.objectContaining({ mode: "as_of", basis: "covered_period", asOf: "2025-02-28" }),
      expect.objectContaining({ mode: "as_of", basis: "covered_period", asOf: "2025-02-28" }),
    ]);
  });

  it("normalizes qualified early-year publication cutoffs and propagates them globally", () => {
    const requirements = normalizeRequirements([{
      id: "global_early_2024_cutoff",
      description: "The report content must be based on publicly available research results up to early 2024.",
      kind: "constraint",
      priority: "must",
      evidenceRequired: false,
      evidenceNeeds: [],
      successCriteria: ["Do not use research made public after early 2024."],
      temporalScope: { mode: "as_of", basis: "covered_period", asOf: "2024-12-31" },
    }, {
      id: "candidate_overview",
      description: "Survey the main alternative interconnect materials.",
      kind: "question",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Publicly available materials research"],
      successCriteria: ["Cover major candidate classes."],
    }, {
      id: "comparison_table",
      description: "Compare the core candidate metals in a table.",
      kind: "deliverable",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Primary and authoritative materials evidence"],
      successCriteria: ["Complete every requested row."],
    }], [], "Prepare the bounded technical survey.");

    expect(requirements.map((requirement) => requirement.temporalScope)).toEqual([
      expect.objectContaining({ mode: "as_of", basis: "source_publication", asOf: "2024-03-31" }),
      expect.objectContaining({ mode: "as_of", basis: "source_publication", asOf: "2024-03-31" }),
      expect.objectContaining({ mode: "as_of", basis: "source_publication", asOf: "2024-03-31" }),
    ]);

    const recovered = normalizeRequirements([{
      id: "candidate_overview_only",
      description: "Survey the main alternative interconnect materials.",
      kind: "question",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Public materials research"],
      successCriteria: ["Cover major candidate classes."],
    }, {
      id: "comparison_table_only",
      description: "Compare the core candidate metals in a table.",
      kind: "deliverable",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Primary and authoritative materials evidence"],
      successCriteria: ["Complete every requested row."],
    }], [], "The report content must be based on publicly available research results up to early 2024.");
    expect(recovered).toHaveLength(3);
    expect(recovered.find((requirement) => requirement.requirementId === "RQ_GLOBAL_TEMPORAL_CUTOFF")).toMatchObject({
      kind: "constraint",
      priority: "must",
      evidenceRequired: false,
      temporalScope: { mode: "as_of", basis: "source_publication", asOf: "2024-03-31" },
    });
    expect(recovered.filter((requirement) => requirement.evidenceRequired).every((requirement) => (
      requirement.temporalScope?.basis === "source_publication" && requirement.temporalScope.asOf === "2024-03-31"
    ))).toBe(true);

    const localRangeBeforeGlobalCutoff = normalizeRequirements([{
      id: "overview_without_dates",
      description: "Survey the main candidate materials.",
      priority: "must",
      evidenceNeeds: ["Materials research"],
      successCriteria: ["Cover the candidates."],
    }], [], "For one historical subsection, summarize studies published from 2020-2022. The report content must be based on publicly available research results up to early 2024.");
    expect(localRangeBeforeGlobalCutoff.find((requirement) => requirement.requirementId === "RQ_GLOBAL_TEMPORAL_CUTOFF")?.temporalScope)
      .toMatchObject({ mode: "as_of", basis: "source_publication", asOf: "2024-03-31" });
    expect(localRangeBeforeGlobalCutoff[0]?.temporalScope)
      .toMatchObject({ mode: "as_of", basis: "source_publication", asOf: "2024-03-31" });

    const [quarter] = normalizeRequirements([{
      id: "q1_cutoff",
      description: "Use studies published through Q1 2023.",
      priority: "must",
      evidenceNeeds: ["Eligible studies"],
      successCriteria: ["Respect the Q1 cutoff."],
    }], [], "Review the literature.");
    expect(quarter?.temporalScope).toMatchObject({ mode: "as_of", basis: "source_publication", asOf: "2023-03-31" });

    const [chinese] = normalizeRequirements([{
      id: "chinese_half_year_cutoff",
      description: "本报告仅使用截至2024年上半年公开发表的研究。",
      priority: "must",
      evidenceNeeds: ["合格研究"],
      successCriteria: ["不超过上半年截止日。"],
    }], [], "完成文献综述。");
    expect(chinese?.temporalScope).toMatchObject({ mode: "as_of", basis: "source_publication", asOf: "2024-06-30" });

    const [negatedMidpoint] = normalizeRequirements([{
      id: "not_a_maximum_cutoff",
      description: "Do not use sources published before mid 2021.",
      priority: "must",
      evidenceNeeds: ["Recent sources"],
      successCriteria: ["Exclude older sources."],
    }], [], "Review recent literature.");
    expect(negatedMidpoint?.temporalScope).toBeUndefined();

    const auditRequirement = requirementFixtures()[0]!;
    auditRequirement.description = "Use publicly available research results up to early 2024.";
    auditRequirement.temporalScope = requirements[1]!.temporalScope;
    const q1Evidence = auditEvidenceQuality(
      requirementBundle([auditRequirement], true, "2024-03-31T23:59:59.000Z"),
      DEFAULT_EVIDENCE_QUALITY_POLICY,
    );
    const q2Evidence = auditEvidenceQuality(
      requirementBundle([auditRequirement], true, "2024-04-01T00:00:00.000Z"),
      DEFAULT_EVIDENCE_QUALITY_POLICY,
    );
    expect(q1Evidence.requirementCoverage.entries[0]).toMatchObject({ status: "covered", freshnessStatus: "current" });
    expect(q2Evidence.requirementCoverage.entries[0]).toMatchObject({ status: "stale", freshnessStatus: "stale" });
    expect(q2Evidence.issues).toContainEqual(expect.objectContaining({ code: "out_of_scope_source_publication" }));
  });

  it("propagates a report-wide month cutoff stated as models and methods up to that month", () => {
    const requirements = normalizeRequirements([{
      id: "technical_review",
      description: "Review the important theoretical models and technical methods.",
      kind: "question",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Direct technical evidence"],
      successCriteria: ["Cover the important models and methods."],
      temporalScope: { mode: "as_of", basis: "source_publication", asOf: "2024-04-30" },
    }], [], "This report needs to summarize all important theoretical models and technical methods up to April 2024.");

    expect(requirements.find((requirement) => requirement.requirementId === "RQ_GLOBAL_TEMPORAL_CUTOFF")).toMatchObject({
      kind: "constraint",
      evidenceRequired: false,
      temporalScope: { mode: "as_of", basis: "covered_period", asOf: "2024-04-30" },
    });
    expect(requirements.find((requirement) => requirement.requirementId === "TECHNICAL_REVIEW")?.temporalScope).toMatchObject({
      mode: "as_of",
      basis: "covered_period",
      asOf: "2024-04-30",
    });
  });

  it("handles inclusive months, leap-day exclusivity, and Chinese month boundaries", () => {
    const requirements = normalizeRequirements([{
      id: "inclusive_month",
      description: "Include technologies available through March 2025.",
      priority: "must",
      evidenceNeeds: ["Dated technology evidence"],
    }, {
      id: "exclusive_day",
      description: "Include material released before March 1, 2024.",
      priority: "must",
      evidenceNeeds: ["Dated release evidence"],
    }, {
      id: "chinese_month",
      description: "仅纳入2024年3月前公开的技术。",
      priority: "must",
      evidenceNeeds: ["技术公开日期"],
    }, {
      id: "negated_lower_bound",
      description: "The technology was not released before March 2025.",
      priority: "should",
      evidenceNeeds: ["Release chronology"],
    }, {
      id: "abbreviated_month",
      description: "Limit the inventory to technologies public prior to Mar. 2025.",
      priority: "should",
      evidenceNeeds: ["Public availability dates"],
    }], [], "Apply exact time boundaries.");

    expect(requirements[0]?.temporalScope).toMatchObject({ mode: "as_of", asOf: "2025-03-31" });
    expect(requirements[1]?.temporalScope).toMatchObject({ mode: "as_of", asOf: "2024-02-29" });
    expect(requirements[2]?.temporalScope).toMatchObject({ mode: "as_of", asOf: "2024-02-29" });
    expect(requirements[3]?.temporalScope).toBeUndefined();
    expect(requirements[4]?.temporalScope).toMatchObject({ mode: "as_of", asOf: "2025-02-28" });
  });

  it("preserves a narrow named-source exception without weakening the cutoff", () => {
    const [requirement] = normalizeRequirements([{
      id: "dated_comparison",
      description: "研究范围截至2022年底，但必须对比指定的2023年全球报告。",
      kind: "comparison",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["区域研究和指定全球报告"],
      successCriteria: ["仅指定报告可以晚于截止时间。"],
      temporalScope: {
        mode: "as_of",
        basis: "covered_period",
        asOf: "2022-12-31",
        exemptSources: [{
          title: "指定的2023年全球就业报告",
          aliases: ["Global Future of Jobs Report 2023"],
          identifiers: ["global-jobs-2023"],
        }],
      },
    }], [], "完成有时间边界的对比。");

    expect(requirement?.temporalScope).toEqual({
      mode: "as_of",
      basis: "covered_period",
      asOf: "2022-12-31",
      start: undefined,
      end: undefined,
      maxAgeDays: undefined,
      exemptSources: [{
        title: "指定的2023年全球就业报告",
        aliases: ["Global Future of Jobs Report 2023"],
        identifiers: ["global-jobs-2023"],
      }],
    });
  });

  it("infers a bounded publication range without confusing an event cutoff", () => {
    const requirements = normalizeRequirements([{
      id: "corpus_range",
      description: "Summarize studies published from 2009-2024.",
      priority: "must",
      evidenceNeeds: ["Eligible studies"],
      successCriteria: ["Cover the eligible corpus."],
    }, {
      id: "event_history",
      description: "Research how the policy changed through 2018.",
      priority: "should",
      temporalScope: { mode: "historical" },
      evidenceNeeds: ["Historical policy evidence"],
      successCriteria: ["Explain the event sequence."],
    }], [], "Review the literature and policy history.");

    expect(requirements[0]?.temporalScope).toMatchObject({
      mode: "range",
      basis: "source_publication",
      start: "2009-01-01",
      end: "2024-12-31",
    });
    expect(requirements[1]?.temporalScope).toMatchObject({
      mode: "historical",
      basis: "covered_period",
    });
  });

  it("preserves month-level publication and covered-period ranges", () => {
    const requirements = normalizeRequirements([{
      id: "monthly_corpus_range",
      description: "Review empirical studies published from January 2020 to August 2023.",
      priority: "must",
      evidenceNeeds: ["Eligible empirical studies"],
      successCriteria: ["Include only studies published in the requested period."],
    }, {
      id: "monthly_event_range",
      description: "Analyze policy events from January 2020 to August 2023.",
      priority: "must",
      temporalScope: { mode: "range", basis: "covered_period" },
      evidenceNeeds: ["Evidence covering the requested event period"],
      successCriteria: ["Cover the full requested event period."],
    }], [], "Review the bounded literature and policy period.");

    expect(requirements[0]?.temporalScope).toMatchObject({
      mode: "range",
      basis: "source_publication",
      start: "2020-01-01",
      end: "2023-08-31",
    });
    expect(requirements[1]?.temporalScope).toMatchObject({
      mode: "range",
      basis: "covered_period",
      start: "2020-01-01",
      end: "2023-08-31",
    });
  });

  it("propagates an explicit global publication cutoff to every evidence question", () => {
    const requirements = normalizeRequirements([{
      id: "global_cutoff",
      description: "Please limit your research to academic perspectives from 2018 and earlier.",
      kind: "constraint",
      priority: "must",
      evidenceRequired: false,
      successCriteria: ["The cutoff is respected."],
    }, {
      id: "directions",
      description: "Summarize the main academic research directions.",
      kind: "question",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Academic literature"],
      successCriteria: ["Identify the main approaches."],
    }, {
      id: "comparison",
      description: "Compare two transnational media forms.",
      kind: "comparison",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Academic comparative evidence"],
      successCriteria: ["Explain similarities and differences."],
    }], [], "Complete an academic survey.");

    expect(requirements.map((requirement) => requirement.temporalScope)).toEqual([
      expect.objectContaining({ mode: "as_of", basis: "source_publication", asOf: "2018-12-31" }),
      expect.objectContaining({ mode: "as_of", basis: "source_publication", asOf: "2018-12-31" }),
      expect.objectContaining({ mode: "as_of", basis: "source_publication", asOf: "2018-12-31" }),
    ]);
  });

  it("recovers an omitted numbered research task from the original user input", () => {
    const userInput = [
      "请完成以下五项研究任务：",
      "",
      "1. 分别定义集体记忆和社会记忆，并解释二者的核心区别。",
      "2. 追溯涂尔干和哈布瓦赫的早期理论与学术源头。",
      "3. 说明心理学如何将集体记忆操作化为共享记忆和协作记忆。",
      "4. 解释系统论如何定义社会记忆及其历史阶段。",
      "5. 分析个体记忆与社会系统记忆的连接，至少解释两种具体连接机制。",
      "",
      "请确保回答结构清晰。",
    ].join("\n");
    const requirements = normalizeRequirements([{
      id: "definitions",
      description: "定义集体记忆和社会记忆，并区分二者。",
      kind: "question",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["跨学科定义"],
      successCriteria: ["定义和区别清晰。"],
    }, {
      id: "foundations",
      description: "追溯涂尔干和哈布瓦赫的早期理论。",
      kind: "question",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["理论史文献"],
      successCriteria: ["交代学术源头。"],
    }, {
      id: "psychology",
      description: "说明心理学中的共享记忆和协作记忆。",
      kind: "question",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["心理学研究"],
      successCriteria: ["解释两种操作化概念。"],
    }, {
      id: "systems",
      description: "解释系统论中的社会记忆及其历史阶段。",
      kind: "question",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["社会系统理论"],
      successCriteria: ["说明独立运作和历史演进。"],
    }], [], userInput);

    expect(requirements.filter((requirement) => requirement.evidenceRequired)).toHaveLength(5);
    expect(requirements.filter((requirement) => requirement.requirementId.startsWith("RQ_ENUM_"))).toEqual([
      expect.objectContaining({
        requirementId: "RQ_ENUM_05",
        kind: "question",
        priority: "must",
        evidenceRequired: true,
        description: expect.stringContaining("连接机制"),
      }),
    ]);
    const mapped = assignRequirements({
      aspects: [{
        label: "集体记忆与社会记忆",
        scopeNote: "覆盖五项研究任务。",
        hypotheses: [
          { statement: "两类记忆存在概念区别。", researchBrief: "定义并比较集体记忆和社会记忆。", evidenceGuidance: "使用概念文献。" },
          { statement: "相关理论有可追溯的学术源头。", researchBrief: "研究涂尔干和哈布瓦赫的早期理论。", evidenceGuidance: "使用理论史文献。" },
          { statement: "心理学提供了操作化路径。", researchBrief: "研究共享记忆和协作记忆。", evidenceGuidance: "使用心理学研究。" },
          { statement: "系统论区分了历史阶段。", researchBrief: "研究社会记忆的系统论定义和历史阶段。", evidenceGuidance: "使用系统论文献。" },
          { statement: "个体记忆通过多种机制连接社会系统记忆。", researchBrief: "识别并解释至少两种连接机制。", evidenceGuidance: "使用跨层次机制证据。" },
        ],
        tasks: [],
      }],
    }, requirements);
    expect(mapped.aspects[0]?.hypotheses[4]?.requirementIds).toContain("RQ_ENUM_05");
    expect(mapped.aspects[0]?.requirementIds).toContain("RQ_ENUM_05");

    const presentationOnly = normalizeRequirements([{
      id: "research_question",
      description: "Analyze the evidence-backed research question.",
      kind: "question",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Research evidence"],
      successCriteria: ["Answer the question."],
    }], [], "Output requirements are as follows:\n1. Write in English.\n2. Use Markdown headings.\n3. Include citations.");
    expect(presentationOnly.filter((requirement) => requirement.requirementId.startsWith("RQ_ENUM_"))).toEqual([]);
  });

  it("propagates a global report cutoff while preserving a requirement-level source exception", () => {
    const exception = {
      title: "指定的2023年就业报告",
      aliases: ["The Future of Jobs Report 2023"],
    };
    const requirements = normalizeRequirements([{
      id: "global_cutoff",
      description: "报告的研究时间范围应截止到2022年底。",
      kind: "constraint",
      priority: "must",
      evidenceRequired: false,
      successCriteria: ["普通证据不得超出截止时间。"],
      temporalScope: { mode: "as_of", basis: "covered_period", asOf: "2022-12-31" },
    }, {
      id: "regional_drivers",
      description: "总结区域驱动因素。",
      kind: "question",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["区域研究"],
      successCriteria: ["解释驱动因素。"],
    }, {
      id: "named_report_comparison",
      description: "与指定的2023年就业报告比较。",
      kind: "comparison",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["指定报告"],
      successCriteria: ["完成比较。"],
      temporalScope: {
        mode: "as_of",
        basis: "covered_period",
        asOf: "2022-12-31",
        exemptSources: [exception],
      },
    }], [], "完成有全局截止时间的报告。");

    expect(requirements[1]?.temporalScope).toMatchObject({
      mode: "as_of",
      basis: "covered_period",
      asOf: "2022-12-31",
    });
    expect(requirements[2]?.temporalScope?.exemptSources).toEqual([exception]);
  });

  it("recovers a required named source beyond the global cutoff without exempting a blocked source", () => {
    const userInput = [
      "报告的研究时间范围应截止到2022年底。",
      "请将南亚技能与世界经济论坛发布的《2023年未来就业报告》进行对比。",
      "同时不要使用《2024年不相关劳动力报告》。",
      "",
      "**important** During research, do not view 《2024年禁止使用的系统综述》 or quote it.",
    ].join("\n");
    const requirements = normalizeRequirements([{
      id: "global_cutoff",
      description: "报告研究范围截止到2022年底。",
      kind: "constraint",
      priority: "must",
      evidenceRequired: false,
      successCriteria: ["普通证据遵守截止时间。"],
    }, {
      id: "wef_comparison",
      description: "将南亚技能与WEF《2023年未来就业报告》比较。",
      kind: "comparison",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["WEF报告中的技能排名"],
      successCriteria: ["完成逐项比较。"],
    }], [], userInput);

    const comparison = requirements.find((requirement) => requirement.requirementId === "WEF_COMPARISON");
    expect(comparison?.temporalScope).toMatchObject({
      mode: "as_of",
      asOf: "2022-12-31",
      exemptSources: [{ title: "2023年未来就业报告" }],
    });
    expect(requirements.flatMap((requirement) => requirement.temporalScope?.exemptSources ?? [])).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: expect.stringMatching(/(?:禁止|不相关)/u) }),
      ]),
    );

    const queries = authorityFirstScoutQueries([comparison!], [], "fallback", 3);
    expect(queries[0]).toContain('"2023年未来就业报告"');
    expect(queries[0]).not.toContain("before:2023-01-01");
    expect(queries.slice(1).every((query) => query.includes("covering evidence through 2022-12-31"))).toBe(true);
    expect(queries.every((query) => !query.includes("before:"))).toBe(true);
  });

  it("preserves wide named entity and field scopes beyond the generic list limit", () => {
    const entities = Array.from({ length: 12 }, (_, index) => `Framework ${index + 1}`);
    const fields = Array.from({ length: 14 }, (_, index) => `Field ${index + 1}`);
    const [requirement] = normalizeRequirements([{
      requirementId: "wide_matrix",
      description: "Create a complete named framework comparison table.",
      kind: "deliverable",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Official documentation"],
      successCriteria: ["Every entity includes every field."],
      entityScope: entities,
      metricScope: fields,
    }], [], "Compare the frameworks.");

    expect(requirement?.entityScope).toEqual(entities);
    expect(requirement?.metricScope).toEqual(fields);
  });

  it("distinguishes open taxonomy groups from already-known final rows", () => {
    const groups = ["High-Intensity Sweeteners", "Sugar Alcohols", "Natural Sweeteners"];
    const [explicit] = normalizeRequirements([{
      requirementId: "sweetener_taxonomy",
      description: "Create a detailed comparison table of common sweeteners under the requested categories.",
      kind: "deliverable",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Authoritative sweetener inventories and specifications"],
      successCriteria: ["Discover multiple members in every group and complete every member row."],
      entityScope: groups,
      entityScopeRole: "groups",
      metricScope: ["Sweetener Name", "Brand Name", "Primary Uses", "Relative Sweetness"],
    }], [], "Compare common sweeteners.");
    const [inferred] = normalizeRequirements([{
      requirementId: "inferred_taxonomy",
      description: "Create a comprehensive comparison table with clear categorization and make it as complete as possible.",
      kind: "deliverable",
      priority: "must",
      evidenceRequired: true,
      entityScope: groups,
      metricScope: ["Name", "Use"],
    }], [], "Compare common sweeteners.");

    expect(explicit).toMatchObject({ entityScope: groups, entityScopeRole: "groups" });
    expect(inferred).toMatchObject({ entityScope: groups, entityScopeRole: "groups" });
  });

  it("marks presentation constraints as not requiring external evidence", () => {
    const [requirement] = normalizeRequirements([{
      id: "output_language",
      description: "Write the report in Chinese.",
      kind: "constraint",
      priority: "must",
      successCriteria: ["The rendered report is in Chinese."],
    }], [], "Research a topic.");

    expect(requirement).toMatchObject({
      requirementId: "OUTPUT_LANGUAGE",
      evidenceRequired: false,
      evidenceNeeds: [],
    });
  });

  it("does not let the model mark a substantive definition or distinction as evidence-free", () => {
    const [requirement] = normalizeRequirements([{
      id: "rate_distinction",
      description: "明确区分收集率与材料回收率，并分别说明其定义或法规上下文。",
      kind: "constraint",
      priority: "must",
      evidenceRequired: false,
      evidenceNeeds: [],
      successCriteria: ["分别解释两个法规指标"],
    }], [], "依据法规说明收集目标与锂回收效率目标，并区分两个指标。");

    expect(requirement).toMatchObject({ evidenceRequired: true });
  });

  it("normalizes repeated named sections as a rendered deliverable", () => {
    const [requirement] = normalizeRequirements([{
      id: "case_sections",
      description: "为每个公司或产品设立一个独立章节。",
      kind: "constraint",
      priority: "must",
      evidenceRequired: false,
      entityScope: ["Company A", "Product B"],
      metricScope: ["Core function", "Use case", "Outcome"],
      successCriteria: ["两个案例分别成章。"],
    }], [], "Write the case report.");

    expect(requirement).toMatchObject({
      kind: "deliverable",
      evidenceRequired: false,
      entityScope: ["Company A", "Product B"],
    });
  });

  it("normalizes named parts plus a summary table as one compound deliverable", () => {
    const [requirement] = normalizeRequirements([{
      id: "compound_material_output",
      description: "将四类材料分成四部分分别说明优势、实例、指标和挑战，最后制作总结对比表。",
      kind: "constraint",
      priority: "must",
      entityScope: ["金属阻挡层", "二维材料", "自组装分子层", "高熵合金"],
      metricScope: ["核心优势", "代表性材料", "关键性能指标", "主要挑战"],
      successCriteria: ["四个详细部分和总结表均完整。"],
    }], [], "调研四类候选材料。");

    expect(requirement).toMatchObject({
      kind: "deliverable",
      evidenceRequired: true,
      entityScope: ["金属阻挡层", "二维材料", "自组装分子层", "高熵合金"],
      metricScope: ["核心优势", "代表性材料", "关键性能指标", "主要挑战"],
    });
  });

  it("normalizes per-category detailed explanations as a rendered deliverable", () => {
    const [requirement] = normalizeRequirements([{
      id: "grouped_profiles",
      description: "对于 Writers、Erasers 和 Readers 每一类中的主要蛋白，请详细说明具体功能和相互作用蛋白。",
      kind: "question",
      priority: "must",
      entityScope: ["Writers", "Erasers", "Readers"],
      metricScope: ["主要蛋白", "具体功能", "相互作用蛋白"],
      successCriteria: ["三类分别完整介绍。"],
    }], [], "整理调控蛋白分类。");

    expect(requirement).toMatchObject({
      kind: "deliverable",
      evidenceRequired: true,
      entityScope: ["Writers", "Erasers", "Readers"],
      entityScopeRole: "groups",
    });
  });

  it("normalizes rendered tables as deliverables while keeping language as a constraint", () => {
    const requirements = normalizeRequirements([
      {
        id: "comparison",
        description: "Create a comparison table for AI Transparency and XAI.",
        kind: "comparison",
        priority: "must",
        successCriteria: ["The table contains focus and audience columns."],
      },
      {
        id: "language",
        description: "The final report must be written in English.",
        kind: "deliverable",
        priority: "must",
        evidenceRequired: false,
        successCriteria: ["The rendered report is in English."],
      },
    ], [], "Compare AI concepts in English.");

    expect(requirements[0]).toMatchObject({
      kind: "deliverable",
      evidenceRequired: true,
    });
    expect(requirements[1]).toMatchObject({
      kind: "constraint",
      evidenceRequired: false,
    });
  });

  it("recovers an omitted explicit table count from the original task", () => {
    const requirements = normalizeRequirements([{
      id: "profile_tables",
      description: "Present the demographic profile in tables with the requested columns.",
      kind: "constraint",
      priority: "must",
      evidenceRequired: true,
      successCriteria: ["Show users and non-users side by side."],
    }], [], [
      "请创建三个独立的表格来展示人口统计、社会经济以及地理和健康史。",
      "每个表格设置三列：分类、使用者百分比、非使用者百分比。",
    ].join("\n"));

    expect(requirements).toHaveLength(1);
    expect(requirements[0]?.kind).toBe("deliverable");
    expect(requirements[0]?.successCriteria).toContain("The final report renders 3 separate Markdown tables.");

    const columnCountOnly = normalizeRequirements([{
      id: "one_table",
      description: "Create one comparison table.",
      kind: "deliverable",
      priority: "must",
      successCriteria: ["The table has three columns."],
    }], [], "Create one table with three columns.");
    expect(columnCountOnly[0]?.successCriteria).not.toContain("The final report renders 3 separate Markdown tables.");
  });

  it("recovers wide comparison dimensions and a lossless two-table partition contract", () => {
    const frameworks = [
      "Node.js", "React.js", "jQuery", "Angular", "Vue.js",
      "ASP.NET", "Django", "Flask", "Laravel", "Ruby on Rails",
    ];
    const dimensions = [
      "发布年份",
      "关键领域 (Key Area)",
      "软件分层 (Software Layer)",
      "主要架构模式 (Primary Architectural Pattern)",
      "主要数据存储 (Primary Data Storage)",
      "国际化支持 (Internationalization)",
      "XSS", "Clickjacking", "CSRF", "DDoS", "远程代码执行",
    ];
    const requirements = normalizeRequirements([{
      id: "framework_comparison",
      description: "制作主流Web开发框架的详细对比表格。",
      kind: "deliverable",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["框架官方文档和安全资料"],
      successCriteria: ["覆盖全部框架和对比字段。"],
      metricScope: ["关键领域", "Security"],
    }], [], [
      `请以2022年的情况为准，调研并整理以下10个框架：${frameworks.join(", ")}。`,
      "报告需要包含以下对比维度：",
      "0. **发布年份**。",
      "1. **关键领域 (Key Area)**：说明框架定位。",
      "2. **软件分层 (Software Layer)**：前端或后端。",
      "3. **主要架构模式 (Primary Architectural Pattern)**：例如MVC或事件驱动。",
      "4. **主要数据存储 (Primary Data Storage)**：说明存储方案。",
      "5. **国际化支持 (Internationalization)**：内置或额外库。",
      "6. **安全支持 (Security)**：针对以下常见攻击说明支持情况：XSS、Clickjacking、CSRF、DDoS、远程代码执行。",
      "请将最终结果整理成两个表格：一个用于对比基于JavaScript的框架，另一个用于对比基于其他编程语言的框架。",
    ].join("\n"));

    const comparison = requirements.find((requirement) => requirement.requirementId === "FRAMEWORK_COMPARISON");
    expect(comparison).toMatchObject({
      entityScope: frameworks,
      entityScopeRole: "members",
      metricScope: dimensions,
    });
    expect(comparison?.successCriteria).toContain(
      "Assign every scoped entity to exactly one table partition: [基于JavaScript的框架], [基于其他编程语言的框架].",
    );
    const contract = requirements.find((requirement) => requirement.requirementId === "RQ_TABLE_PARTITION_CONTRACT");
    expect(contract).toMatchObject({
      kind: "deliverable",
      priority: "must",
      evidenceRequired: false,
      entityScope: frameworks,
      entityScopeRole: "members",
    });
    expect(contract?.description).toContain("[基于JavaScript的框架], [基于其他编程语言的框架]");

    const noScope = normalizeRequirements([{
      id: "generic_tables",
      description: "Create comparison tables without a named entity list.",
      kind: "deliverable",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Comparison evidence"],
      successCriteria: ["Organize the findings."],
    }], [], "Create two tables: one for frontend tools, another for backend tools.");
    expect(noScope.some((requirement) => requirement.requirementId === "RQ_TABLE_PARTITION_CONTRACT")).toBe(false);

    const ambiguousTables = normalizeRequirements([{
      id: "products",
      description: "Create a product comparison table.",
      kind: "deliverable",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Product evidence"],
      successCriteria: ["Compare products."],
      metricScope: ["Price"],
    }, {
      id: "vendors",
      description: "Create an unrelated vendor comparison table.",
      kind: "deliverable",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Vendor evidence"],
      successCriteria: ["Compare vendors."],
      metricScope: ["Location"],
    }], [], [
      "Use the following comparison dimensions:",
      "1. **Performance**: Compare speed.",
      "2. **Security**: Compare protection.",
    ].join("\n"));
    expect(ambiguousTables.map((requirement) => requirement.metricScope)).toEqual([["Price"], ["Location"]]);
  });

  it("recovers an exact table schema and required taxonomy groups from the original task", () => {
    const [requirement] = normalizeRequirements([{
      id: "algorithm_classification",
      description: "Classify the scheduling algorithms in a table.",
      kind: "deliverable",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Academic papers on scheduling algorithms"],
      successCriteria: ["Cover the requested algorithm families."],
    }], [], [
      "Classify algorithms used for HMLV scheduling found in the literature and present them in a table.",
      "The table should include three columns: [Algorithm Category], [Specific Algorithm Name/Model], and [Main Application Objective].",
      "Algorithm categories should cover at least: Heuristic Algorithms, Genetic Algorithms, Linear Programming, Reinforcement Learning.",
    ].join(" "));

    expect(requirement?.metricScope).toEqual([
      "Algorithm Category",
      "Specific Algorithm Name/Model",
      "Main Application Objective",
    ]);
    expect(requirement?.entityScope).toEqual([
      "Heuristic Algorithms",
      "Genetic Algorithms",
      "Linear Programming",
      "Reinforcement Learning",
    ]);
    expect(requirement?.entityScopeRole).toBe("groups");
    expect(requirement?.successCriteria).toContain(
      "The Markdown table headers must appear exactly in this order: [Algorithm Category], [Specific Algorithm Name/Model], [Main Application Objective].",
    );
    const queries = authorityFirstScoutQueries([requirement!], [], "HMLV scheduling algorithms", 4);
    expect(queries).toHaveLength(4);
    for (const group of requirement?.entityScope ?? []) {
      expect(queries.some((query) => query.startsWith(group))).toBe(true);
    }
  });

  it("recovers ordered named top-level sections and a per-section bullet contract", () => {
    const userInput = [
      "The report should include the following four sections:",
      "1. **Between Parasitic Plants**: Explain host-parasite gene exchange, such as studies involving 'Cuscuta' or 'Striga'.",
      "2. **Between Fungi and Plants**: Explain bidirectional transfer.",
      "3. **Between Bacteria and Plants**: Explain Agrobacterium T-DNA, elaborating on the case of sweet potato.",
      "4. **Between Viruses and Plants**: Explain viral genes and vectors.",
      "Please ensure each section is supported by species and gene names, with clear language and bulleted discussions.",
    ].join("\n");
    const requirements = normalizeRequirements([
      { id: "parasites", description: "Explain HGT between parasitic plants.", priority: "must" },
      { id: "fungi", description: "Explain HGT between fungi and plants.", priority: "must", exampleScope: ["Between Bacteria", "Plants"] },
      { id: "bacteria", description: "Explain HGT between bacteria and plants.", priority: "must" },
      { id: "viruses", description: "Explain HGT between viruses and plants.", priority: "must" },
    ], [], userInput);

    const contract = requirements.find((requirement) => requirement.requirementId === "RQ_TOP_LEVEL_SECTION_CONTRACT");
    expect(contract).toMatchObject({
      kind: "deliverable",
      priority: "must",
      evidenceRequired: false,
      entityScope: [
        "Between Parasitic Plants",
        "Between Fungi and Plants",
        "Between Bacteria and Plants",
        "Between Viruses and Plants",
      ],
    });
    expect(contract?.description).toContain("The report must include exactly 4 top-level sections in this order");
    expect(contract?.successCriteria).toContain("Every required top-level section contains a Markdown bullet list.");
    expect(requirements.find((requirement) => requirement.description.includes("between fungi and plants"))?.exampleScope).toEqual([]);
    expect(requirements.find((requirement) => requirement.description.includes("between parasitic plants"))?.exampleScope).toEqual(["Cuscuta", "Striga"]);
    expect(requirements.find((requirement) => requirement.description.includes("between bacteria and plants"))?.exampleScope).toEqual(["sweet potato"]);
  });

  it("treats later retrospective sources as covered-period evidence rather than post-cutoff publications", () => {
    const requirements = normalizeRequirements([{
      id: "hgt_parasites",
      description: "Explain discoveries involving parasitic plants.",
      priority: "must",
      evidenceRequired: true,
      temporalScope: { mode: "historical", basis: "source_publication", end: "2020-12-31" },
    }, {
      id: "hgt_cutoff",
      description: "Focus primarily on discoveries before 2021. Sources published in 2021 or later are acceptable only if they cover findings from before 2021.",
      priority: "must",
      evidenceRequired: true,
      temporalScope: { mode: "as_of", basis: "source_publication", asOf: "2020-12-31" },
    }], [], "Focus primarily on discoveries before 2021. Sources published in 2021 or later are acceptable only if they cover findings from before 2021.");

    expect(requirements.find((requirement) => requirement.description.startsWith("Explain discoveries"))?.temporalScope).toMatchObject({
      mode: "as_of",
      basis: "covered_period",
      asOf: "2020-12-31",
    });
  });

  it("does not treat top-level section headings as research entities and keeps quality prose evidence-free", () => {
    const userInput = [
      "The report should include the following four sections:",
      "1. **Classic Theoretical Frameworks**: explain the theories.",
      "2. **Review of AI/ML Applications**: explain applications.",
      "3. **Multi-Criteria Decision Making (MCDM)**: explain portfolio selection methods.",
      "4. **Portfolio Optimization and Rebalancing**: explain optimization.",
      "All information must be accurate and specific, avoiding vague statements.",
    ].join("\n");
    const requirements = normalizeRequirements([{
      id: "mcdm",
      description: "Explain MCDM methods in portfolio selection.",
      kind: "deliverable",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Academic sources on MCDM portfolio methods"],
      successCriteria: ["Explain application scenarios."],
    }, {
      id: "quality",
      description: "All information must be accurate and specific, avoiding vague statements.",
      kind: "constraint",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Verifiable sources for all claims"],
      successCriteria: ["All report claims are specific."],
    }], [], userInput);

    expect(requirements.find((item) => item.description.startsWith("Explain MCDM"))?.entityScope ?? []).toEqual([]);
    expect(requirements.find((item) => item.description.startsWith("All information"))?.evidenceRequired).toBe(false);
    expect(requirements.find((item) => item.requirementId === "RQ_TOP_LEVEL_SECTION_CONTRACT")?.entityScope).toEqual([
      "Classic Theoretical Frameworks",
      "Review of AI/ML Applications",
      "Multi-Criteria Decision Making (MCDM)",
      "Portfolio Optimization and Rebalancing",
    ]);
  });

  it("recognizes report-level core areas and does not attach them to one substantive requirement", () => {
    const userInput = [
      "Please ensure the report covers the following core areas and presents them in a clear structure:",
      "1. **Foundational Frameworks**: explain the foundational theories.",
      "2. **Review of Intelligent-System Applications**: explain applications.",
      "3. **Multi-Criteria Decision Methods**: explain multi-criteria selection methods.",
      "4. **Optimization and Rebalancing**: explain optimization and rebalancing.",
      "Please divide the report into four main sections: 'Foundational Frameworks', 'Review of Intelligent-System Applications', 'Multi-Criteria Decision', and 'Optimization and Rebalancing'.",
    ].join("\n");
    const requirements = normalizeRequirements([{
      id: "multi_criteria",
      description: "Explain multi-criteria methods and their application scenarios.",
      kind: "deliverable",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Academic sources on multi-criteria selection methods"],
      successCriteria: [
        "Explain application scenarios.",
        "Cover every explicitly named outline item: Foundational Frameworks, Review of Intelligent-System Applications, Multi-Criteria Decision Methods, Optimization and Rebalancing.",
        "Render one substantive subsection for every explicitly named outline item.",
        "Research nested subsection [Forecasting] under [Review of Intelligent-System Applications] with direct cited evidence.",
      ],
      entityScope: [
        "Foundational Frameworks",
        "Review of Intelligent-System Applications",
        "Multi-Criteria Decision Methods",
        "Optimization and Rebalancing",
      ],
    }], [], userInput);

    const substantive = requirements.find((item) => item.description.startsWith("Explain multi-criteria"));
    expect(substantive?.entityScope).toEqual([]);
    expect(substantive?.successCriteria).toEqual(["Explain application scenarios."]);
    expect(requirements.find((item) => item.requirementId === "RQ_TOP_LEVEL_SECTION_CONTRACT")?.entityScope).toEqual([
      "Foundational Frameworks",
      "Review of Intelligent-System Applications",
      "Multi-Criteria Decision",
      "Optimization and Rebalancing",
    ]);
  });

  it("recovers evidence ownership and parent-bound headings for explicit nested subsections", () => {
    const parent = "补充性方法（Complementary Methods）";
    const children = [
      "游戏设计书籍",
      "标记语言和工具（Notations and Tools）",
      "分析框架（Frameworks）",
    ];
    const requirements = normalizeRequirements([{
      id: "dilemma",
      description: "说明游戏设计方法论的困境。",
      kind: "question",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["游戏设计和开发方法论研究"],
      successCriteria: ["区分游戏设计与游戏开发。"],
    }, {
      id: "complementary",
      description: "总结游戏设计书籍、标记语言和工具以及分析框架等补充性方法。",
      kind: "question",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["补充性游戏设计方法资料"],
      successCriteria: ["说明补充方法的作用和局限。"],
    }, {
      id: "core",
      description: "研究核心游戏设计方法。",
      kind: "question",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["核心设计方法研究"],
      successCriteria: ["解释游戏设计模式。"],
    }, {
      id: "summary",
      description: "总结核心方法难以普及的原因。",
      kind: "question",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["方法采用情况研究"],
      successCriteria: ["综合主要障碍。"],
    }], [], [
      "我想系统调研游戏设计方法论，请以2021年中期之前的信息为准。",
      "具体来说，我希望你帮我整理出以下几块内容：",
      "1. **方法论的困境**：说明游戏设计和开发的区别。",
      `2. **${parent}**：这部分请分为三个小类来介绍：`,
      "    * **游戏设计书籍**：列举经典著作并说明内容和局限。",
      "    * **标记语言和工具（Notations and Tools）**：介绍Machinations和skill atoms及其局限。",
      "    * **分析框架（Frameworks）**：介绍MDA并解释描述性与规定性的区别。",
      "3. **核心方法（Core Methods）**：研究游戏设计模式。",
      "4. **总结**：总结核心方法难以普及的原因。",
    ].join("\n"));

    const contract = requirements.find((requirement) => requirement.requirementId.startsWith("RQ_NESTED_SECTION_CONTRACT_"));
    expect(contract).toMatchObject({
      kind: "deliverable",
      priority: "must",
      evidenceRequired: false,
      entityScope: children,
      entityScopeRole: "members",
    });
    expect(contract?.description).toContain(`Under top-level section [${parent}]`);
    expect(requirements.find((requirement) => requirement.requirementId === "RQ_TOP_LEVEL_SECTION_CONTRACT")?.entityScope).toEqual([
      "方法论的困境",
      parent,
      "核心方法（Core Methods）",
      "总结",
    ]);
    const ownership = requirements.filter((requirement) => requirement.evidenceRequired !== false).flatMap((requirement) => (
      requirement.successCriteria.filter((criterion) => criterion.startsWith("Research nested subsection ["))
    ));
    expect(ownership).toHaveLength(3);
    for (const child of children) expect(ownership.some((criterion) => criterion.includes(`[${child}]`))).toBe(true);
    expect(requirements.filter((requirement) => requirement.requirementId.startsWith("RQ_NESTED_")
      && !requirement.requirementId.startsWith("RQ_NESTED_SECTION_CONTRACT_"))).toHaveLength(3);
    expect(requirements.find((requirement) => requirement.requirementId === "RQ_GLOBAL_TEMPORAL_CUTOFF")?.temporalScope).toMatchObject({
      mode: "as_of",
      basis: "covered_period",
      asOf: "2021-05-31",
    });
    expect(requirements.filter((requirement) => requirement.evidenceRequired !== false)
      .every((requirement) => requirement.temporalScope?.asOf === "2021-05-31")).toBe(true);
  });

  it("rejects nested subsection recovery without hierarchy signals, bold headings, or a matching count", () => {
    const requirement = [{
      id: "methods",
      description: "Analyze several design methods.",
      kind: "question" as const,
      priority: "must" as const,
      evidenceRequired: true,
      evidenceNeeds: ["Method evidence"],
      successCriteria: ["Compare the methods."],
    }];
    const prompts = [[
      "1. **Methods**: Some examples follow:",
      "    * **Books**: Introduce books.",
      "    * **Tools**: Introduce tools.",
      "    * **Frameworks**: Introduce frameworks.",
    ], [
      "1. **Methods**: Divide this section into three categories:",
      "    * Books: Introduce books.",
      "    * Tools: Introduce tools.",
      "    * Frameworks: Introduce frameworks.",
    ], [
      "1. **Methods**: Divide this section into four categories:",
      "    * **Books**: Introduce books.",
      "    * **Tools**: Introduce tools.",
      "    * **Frameworks**: Introduce frameworks.",
    ]];

    for (const prompt of prompts) {
      const normalized = normalizeRequirements(requirement, [], prompt.join("\n"));
      expect(normalized.some((item) => item.requirementId.startsWith("RQ_NESTED_"))).toBe(false);
    }
  });

  it("recovers a counted named-country scope onto the relevant matrix requirement", () => {
    const countries = [
      "Albania", "Bosnia and Herzegovina", "Croatia", "Cyprus", "France", "Greece", "Italy",
      "Malta", "Monaco", "Montenegro", "Slovenia", "Spain", "Turkey",
    ];
    const requirements = normalizeRequirements([{
      id: "basic_data",
      description: "Create the Basic Data Table with land area and annual international tourist arrivals for each country.",
      kind: "deliverable",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Official national area and tourism statistics"],
      successCriteria: ["Every requested country has complete yearly data."],
      metricScope: ["Land Area", "International Tourist Arrivals"],
    }, {
      id: "inequality_indices",
      description: "Create the annual regional inequality index table.",
      kind: "deliverable",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Calculated regional indices"],
      successCriteria: ["Report Atkinson, Hoover, and Theil indices by year."],
      metricScope: ["Atkinson Index", "Hoover Index", "Theil Index"],
    }, {
      id: "trend",
      description: "Analyze the regional inequality trend and significant years.",
      priority: "must",
      evidenceNeeds: ["Global-event chronology"],
    }], [], [
      `For the following 13 countries: ${countries.join(", ")}, organize two tables.`,
      "Table 1: Basic Data Table. Include land area and annual international tourist arrivals for each country.",
      "Table 2: Inequality Index Table. Calculate three regional indices for each year.",
    ].join("\n"));

    const basic = requirements.find((requirement) => requirement.requirementId === "BASIC_DATA");
    const indices = requirements.find((requirement) => requirement.requirementId === "INEQUALITY_INDICES");
    expect(basic).toMatchObject({ entityScope: countries, entityScopeRole: "members" });
    expect(indices?.entityScope).toEqual([]);
    const queries = authorityFirstScoutQueries([basic!], [], "Mediterranean tourism statistics", 13);
    expect(queries).toHaveLength(13);
    for (const country of countries) expect(queries.some((query) => query.startsWith(country))).toBe(true);
  });

  it("recovers postpositive and parenthetical counted entity lists onto separate requirements", () => {
    const cities = ["北京", "上海", "广州", "深圳", "成都"];
    const systemModes = [
      "地铁", "轻轨", "单轨", "市域快轨", "有轨电车", "磁浮", "自动旅客捷运系统", "智轨", "胶轮捷运", "悬挂式单轨",
    ];
    const requirements = normalizeRequirements([{
      id: "scale",
      description: "列出2015年至2023年全国城轨整体发展规模。",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["全国年度统计"],
      successCriteria: ["每年数据完整。"],
    }, {
      id: "city_mileage",
      description: "制作五个主要城市的年度运营里程表。",
      kind: "deliverable",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["各城市年度运营里程"],
      successCriteria: ["每个城市每年均有公里数。"],
      metricScope: ["运营里程"],
    }, {
      id: "system_modes",
      description: "总结所有请求的城轨系统制式及其总运营里程。",
      kind: "deliverable",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["各系统制式运营里程"],
      successCriteria: ["全部制式均有数据。"],
      metricScope: ["总运营里程"],
    }, {
      id: "service_efficiency",
      description: "对比五个主要城市2019年和2022年的客运量与客运强度。",
      kind: "comparison",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["城市客运量和客运强度"],
      successCriteria: ["两个年份的城市指标完整。"],
      metricScope: ["日均客运量", "日均客运强度"],
    }], [], [
      "1. 整体发展规模：列出2015年至2023年的全国年度数据。",
      `2. 主要城市运营里程：制作一个表格，展示${cities.join("、")}这五个城市从2015年到2023年每年的运营里程。`,
      `3. 城轨系统制式构成：总结截至2023年底的10种不同系统制式（${systemModes.join("、")}）各自的总运营里程。`,
      `4. 服务效率分析：对比分析${cities.slice(0, -1).join("、")}和${cities.at(-1)}这五个城市在2019年和2022年的日均客运量和日均客运强度。`,
    ].join("\n"));

    expect(requirements.find((requirement) => requirement.requirementId === "CITY_MILEAGE")).toMatchObject({
      entityScope: cities,
      entityScopeRole: "members",
    });
    const systemRequirement = requirements.find((requirement) => requirement.requirementId === "SYSTEM_MODES");
    expect(systemRequirement).toMatchObject({
      entityScope: systemModes,
      entityScopeRole: "members",
    });
    expect(requirements.find((requirement) => requirement.requirementId === "SERVICE_EFFICIENCY")).toMatchObject({
      entityScope: cities,
      entityScopeRole: "members",
    });
    expect(requirements.find((requirement) => requirement.requirementId === "SCALE")?.entityScope).toEqual([]);
    const systemQueries = authorityFirstScoutQueries([systemRequirement!], [], "中国城轨系统制式运营里程", 10);
    expect(systemQueries).toHaveLength(10);
    for (const mode of systemModes) expect(systemQueries.some((query) => query.startsWith(mode))).toBe(true);

    const countMismatch = normalizeRequirements([{
      id: "modes",
      description: "总结所有城轨系统制式。",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["系统制式资料"],
      successCriteria: ["不得遗漏制式。"],
    }], [], "总结五种系统制式（地铁、轻轨、单轨）各自的特点。");
    expect(countMismatch[0]?.entityScope).toEqual([]);

    const englishParenthetical = normalizeRequirements([{
      id: "transport_modes",
      description: "Compare the requested transport modes by route length.",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Operating route length by transport mode"],
      successCriteria: ["Every requested mode has a cited value."],
      metricScope: ["Route Length"],
    }], [], "Compare five transport modes (Metro, Light Rail, Monorail, Tram, Maglev) by operating route length.");
    expect(englishParenthetical[0]).toMatchObject({
      entityScope: ["Metro", "Light Rail", "Monorail", "Tram", "Maglev"],
      entityScopeRole: "members",
    });
  });

  it("recovers restarted numbered outline groups with shared per-item dimensions", () => {
    const workflowStages = [
      "Image Acquisition Enhancement",
      "Image Reconstruction",
      "Image Post-processing and Restoration",
      "Motion Artifact Correction",
    ];
    const clinicalTasks = [
      "Image Segmentation",
      "Lesion Detection and Classification",
      "Quantitative Analysis",
      "Radiotherapy Planning",
      "Dosimetry",
      "Radiomics and Radiogenomics",
    ];
    const dimensions = ["objective", "main AI techniques used", "specific effects or advantages achieved"];
    const requirements = normalizeRequirements([{
      id: "workflow",
      description: "Analyze the technical optimization role of AI across the PET imaging workflow.",
      kind: "question",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Primary studies for PET workflow optimization"],
      successCriteria: ["Explain the workflow applications."],
    }, {
      id: "clinical",
      description: "Analyze the specific tasks of AI in clinical PET applications.",
      kind: "question",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Primary clinical PET AI studies"],
      successCriteria: ["Explain the clinical applications."],
    }], [], [
      "The report needs to be divided into two main sections:",
      "Part One: Technical Optimization Role of AI in the Entire PET Imaging Workflow. Please outline the applications in the following stages:",
      "1. **Image Acquisition Enhancement**: Explain signal-quality applications.",
      "2. **Image Reconstruction**: Compare reconstruction paradigms.",
      "3. **Image Post-processing and Restoration**: Explain restoration methods.",
      "4. **Motion Artifact Correction**: Explain motion compensation.",
      "Part Two: Specific Tasks of AI in Clinical PET Applications. Please summarize the role of AI in the following clinical scenarios:",
      "1. **Image Segmentation**: Explain automated delineation.",
      "2. **Lesion Detection and Classification**: Explain detection and diagnosis.",
      "3. **Quantitative Analysis**: Explain automatic clinical metrics.",
      "4. **Radiotherapy Planning**: Explain treatment planning.",
      "5. **Dosimetry**: Explain personalized dose calculation.",
      "6. **Radiomics and Radiogenomics**: Explain imaging-genomic analysis.",
      "For each application point above, clearly explain its **objective**, **main AI techniques used**, and **specific effects or advantages achieved**.",
    ].join("\n"));

    const workflow = requirements.find((requirement) => requirement.requirementId === "WORKFLOW");
    const clinical = requirements.find((requirement) => requirement.requirementId === "CLINICAL");
    expect(workflow).toMatchObject({
      kind: "deliverable",
      entityScope: workflowStages,
      entityScopeRole: "members",
      metricScope: dimensions,
    });
    expect(clinical).toMatchObject({
      kind: "deliverable",
      entityScope: clinicalTasks,
      entityScopeRole: "members",
      metricScope: dimensions,
    });
    expect(workflow?.successCriteria).toContain(
      `For every outline item, cover each required dimension: ${dimensions.join(", ")}.`,
    );
    expect(clinical?.successCriteria).toContain("Render one substantive subsection for every explicitly named outline item.");
    const queries = authorityFirstScoutQueries([workflow!, clinical!], [], "PET AI applications", 6);
    expect(queries.slice(0, 4).some((query) => query.startsWith("Image Acquisition Enhancement"))).toBe(true);
    expect(queries.some((query) => query.startsWith("Image Segmentation"))).toBe(true);
  });

  it("does not promote ordinary numbered prose or unheaded instructions into nested outlines", () => {
    const base = [{
      id: "analysis",
      description: "Analyze the requested PET applications.",
      kind: "question" as const,
      priority: "must" as const,
      evidenceRequired: true,
      evidenceNeeds: ["PET application evidence"],
      successCriteria: ["Provide a supported analysis."],
    }];
    const ordinary = normalizeRequirements(base, [], [
      "Background notes:",
      "1. **Acquisition**: Earlier scanners had lower sensitivity.",
      "2. **Reconstruction**: Iterative methods remain common.",
      "3. **Segmentation**: Clinical adoption varies.",
    ].join("\n"));
    const unheaded = normalizeRequirements(base, [], [
      "Please cover the following stages:",
      "1. Explain acquisition enhancement.",
      "2. Explain reconstruction.",
      "3. Explain segmentation.",
    ].join("\n"));

    expect(ordinary[0]).toMatchObject({ kind: "question", entityScope: [] });
    expect(unheaded[0]).toMatchObject({ kind: "question", entityScope: [] });
  });

  it("recovers both sides of an explicit dual-perspective analysis", () => {
    const requirements = normalizeRequirements([{
      id: "league_duality",
      description: "Analyze the dual role of the League of Nations in decolonization.",
      kind: "question",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["League of Nations and Mandates System scholarship"],
      successCriteria: ["Explain the historical complexity."],
    }, {
      id: "un_period",
      description: "Analyze the United Nations period after World War II.",
      priority: "must",
    }], [], [
      "Please focus on the dual role of the League of Nations in decolonization.",
      "On the one hand, please explain how the League maintained imperial interests through the Mandates System; on the other hand, also explain how it inadvertently provided a stage for international oversight of colonial affairs.",
      "Then explain the postwar United Nations period.",
    ].join(" "));

    const league = requirements.find((requirement) => requirement.requirementId === "LEAGUE_DUALITY");
    expect(league?.successCriteria).toContain(
      "Research this explicit perspective separately: the League maintained imperial interests through the Mandates System.",
    );
    expect(league?.successCriteria).toContain(
      "Research this explicit perspective separately: it inadvertently provided a stage for international oversight of colonial affairs.",
    );
    expect(league?.successCriteria).toContain("Compare and synthesize both explicit perspectives without collapsing either side.");
    expect(requirements.find((requirement) => requirement.requirementId === "UN_PERIOD")?.successCriteria.join(" ")).not.toContain(
      "explicit perspective separately",
    );
  });

  it("recovers explicitly required narrative examples without turning them into table entities", () => {
    const requirements = normalizeRequirements([{
      id: "conception",
      description: "Explain conception and infertility narratives.",
      kind: "question",
      priority: "must",
      evidenceNeeds: ["Biblical conception narratives"],
      successCriteria: ["Explain divine and human agency."],
    }, {
      id: "nurturing",
      description: "Analyze breastfeeding, nurturing, and salvation narratives.",
      kind: "question",
      priority: "must",
      evidenceNeeds: ["Biblical nurturing narratives"],
      successCriteria: ["Explain the role of caregivers."],
    }], [], [
      "How do the authors depict conception? Please illustrate with the experiences of figures such as Sarah, Rebecca, and Rachel.",
      "How is breastfeeding presented? Please focus on analyzing the stories of the salvation of Moses, Mephibosheth, and Joash, and explain the crucial role played by wet nurses therein.",
    ].join("\n"));

    const conception = requirements.find((requirement) => requirement.requirementId === "CONCEPTION");
    const nurturing = requirements.find((requirement) => requirement.requirementId === "NURTURING");
    expect(conception).toMatchObject({ exampleScope: ["Sarah", "Rebecca", "Rachel"] });
    expect(nurturing).toMatchObject({ exampleScope: ["Moses", "Mephibosheth", "Joash"] });
    expect(conception?.entityScope).toEqual([]);
    expect(nurturing?.entityScope).toEqual([]);
    expect(nurturing?.successCriteria).toContain(
      "Cover every explicitly requested narrative example with cited substantive analysis: Moses, Mephibosheth, Joash.",
    );
  });

  it("maps every requirement to the most relevant leaf and rolls ids up to its aspect", () => {
    const requirements = requirementFixtures();
    const plan: ArchitectTreePlan = {
      aspects: [{
        label: "Policy design",
        scopeNote: "Mechanisms and implementation risks.",
        hypotheses: [
          { statement: "The financing mechanism changes incentives.", researchBrief: "Compare financing policy mechanisms.", evidenceGuidance: "Use official policy documents." },
          { statement: "Implementation creates operational risk.", researchBrief: "Assess implementation risk and failure modes.", evidenceGuidance: "Use audits and cases." },
        ],
        tasks: [
          { title: "Mechanism", objective: "Compare mechanisms.", acceptanceCriteria: ["Find policy evidence."] },
          { title: "Risk", objective: "Assess risk.", acceptanceCriteria: ["Find audit evidence."] },
        ],
      }],
    };

    const mapped = assignRequirements(plan, requirements);

    expect(mapped.aspects[0]?.hypotheses[0]?.requirementIds).toContain("RQ_MECHANISM");
    expect(mapped.aspects[0]?.hypotheses[1]?.requirementIds).toContain("RQ_RISK");
    expect(mapped.aspects[0]?.requirementIds).toEqual(expect.arrayContaining(["RQ_MECHANISM", "RQ_RISK"]));
  });

  it("maps a global source-publication rule onto every research leaf", () => {
    const [globalCutoff] = normalizeRequirements([{
      id: "global_cutoff",
      description: "Limit the research to academic perspectives from 2018 and earlier.",
      kind: "constraint",
      priority: "must",
      evidenceRequired: false,
      successCriteria: ["All cited perspectives satisfy the cutoff."],
    }], [], "Complete the survey.");
    const plan: ArchitectTreePlan = {
      aspects: [{
        label: "Survey",
        scopeNote: "Two substantive branches.",
        hypotheses: [
          { statement: "Direction one", researchBrief: "Research one", evidenceGuidance: "Use academic sources" },
          { statement: "Direction two", researchBrief: "Research two", evidenceGuidance: "Use academic sources" },
        ],
        tasks: [
          { title: "One", objective: "Research one", acceptanceCriteria: ["Find evidence"] },
          { title: "Two", objective: "Research two", acceptanceCriteria: ["Find evidence"] },
        ],
      }],
    };

    const mapped = assignRequirements(plan, [globalCutoff!]);

    expect(mapped.aspects[0]?.hypotheses.every((leaf) => leaf.requirementIds?.includes("GLOBAL_CUTOFF"))).toBe(true);
  });

  it("makes an ungrounded must requirement a deterministic balanced-mode error", () => {
    const requirements = requirementFixtures();
    const bundle = requirementBundle(requirements, false);

    const audit = auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY, { generatedAt: "2026-07-14T00:00:00.000Z" });

    expect(audit.requirementCoverage).toMatchObject({
      totalCount: 2,
      mustCount: 2,
      coveredCount: 1,
      coveredMustCount: 1,
      coverage: 0.5,
    });
    expect(audit.issues).toContainEqual(expect.objectContaining({
      code: "ungrounded_research_requirement",
      severity: "error",
      reportNodeId: "R_risk",
    }));
  });

  it("audits and omits an unmapped degradable requirement after bounded repair", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dr-requirement-gate-"));
    try {
      const runtimeProfile = loadDefaultRuntimeProfile();
      runtimeProfile.artifactDir = dir;
      runtimeProfile.hilMode = "auto_accept";
      const ctx = createPhaseContext({ sessionId: "S_requirement", userInput: "Cover the policy mechanism." }, {
        runtimeProfile,
        artifactDir: dir,
        llm: new EchoJsonLlm(),
        now: () => Date.UTC(2026, 6, 14),
      });
      ctx.state.episodeId = "EP_requirement_gate";
      ctx.state.globalRubric = {
        rubricId: "RB_requirement_gate",
        episodeId: ctx.state.episodeId,
        rubricText: "Cover the policy mechanism.",
        outputHints: { language: "en", citationRequired: true, format: "markdown" },
        requirements: [requirementFixtures()[0]!],
      };
      const root = node("R_root", "root", null, ["RQ_MECHANISM"]);
      const leaf = node("R_leaf", "hypothesis", root.nodeId, []);
      ctx.state.rootNode = root;
      await ctx.stack.kg.upsertReportNode(root);
      await ctx.stack.kg.upsertReportNode(leaf);
      const source = knowledge();
      await ctx.stack.kg.upsertKnowledgeNode(source);
      await ctx.stack.kg.upsertEvidenceLink(link("E_leaf", leaf.nodeId, source.nodeId));

      const decision = await completionGatePhase(ctx, { final: true, allowRepairTasks: false });

      expect(decision.decision).toBe("ready_for_report");
      expect(ctx.state.issueWaivers).toContainEqual(expect.objectContaining({
        decidedBy: "framework",
        action: "omit",
        issueCode: "unmapped_research_requirement",
        requirementIds: ["RQ_MECHANISM"],
      }));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps a structured non-waivable requirement blocking", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dr-requirement-block-"));
    try {
      const runtimeProfile = loadDefaultRuntimeProfile();
      runtimeProfile.artifactDir = dir;
      const ctx = createPhaseContext({ sessionId: "S_requirement", userInput: "Never use the forbidden source." }, {
        runtimeProfile,
        artifactDir: dir,
        llm: new EchoJsonLlm(),
        now: () => Date.UTC(2026, 6, 14),
      });
      ctx.state.episodeId = "EP_requirement_block";
      ctx.state.globalRubric = {
        rubricId: "RB_requirement_block",
        episodeId: ctx.state.episodeId,
        rubricText: "Never use the forbidden source.",
        outputHints: { language: "en", citationRequired: true, format: "markdown" },
        requirements: [{
          ...requirementFixtures()[0]!,
          description: "Do not use or cite the forbidden source.",
          failurePolicy: "block",
        }],
      };
      const root = node("R_root", "root", null, []);
      const leaf = node("R_leaf", "hypothesis", root.nodeId, []);
      ctx.state.rootNode = root;
      await ctx.stack.kg.upsertReportNode(root);
      await ctx.stack.kg.upsertReportNode(leaf);

      const decision = await completionGatePhase(ctx, { final: true, allowRepairTasks: false });

      expect(decision.decision).toBe("need_more_work");
      if (decision.decision !== "need_more_work") throw new Error("expected non-waivable failure");
      expect(decision.result?.status).toBe("needs_human_review");
      expect(ctx.state.issueWaivers).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("distinguishes stale and current evidence for time-sensitive requirements", () => {
    const requirements = requirementFixtures();
    requirements[1]!.temporalScope = { mode: "current", maxAgeDays: 30 };

    const stale = auditEvidenceQuality(
      requirementBundle(requirements, true, "2025-01-01T00:00:00.000Z"),
      DEFAULT_EVIDENCE_QUALITY_POLICY,
      { generatedAt: "2026-07-14T00:00:00.000Z" },
    );
    const current = auditEvidenceQuality(
      requirementBundle(requirements, true, "2026-07-10T00:00:00.000Z"),
      DEFAULT_EVIDENCE_QUALITY_POLICY,
      { generatedAt: "2026-07-14T00:00:00.000Z" },
    );

    expect(stale.requirementCoverage.entries.find((entry) => entry.requirementId === "RQ_RISK")).toMatchObject({
      status: "stale",
      freshnessStatus: "stale",
    });
    expect(stale.issues).toContainEqual(expect.objectContaining({ code: "stale_research_requirement", severity: "error" }));
    expect(current.requirementCoverage.entries.find((entry) => entry.requirementId === "RQ_RISK")).toMatchObject({
      status: "covered",
      freshnessStatus: "current",
    });
  });

  it("rejects evidence published after an as-of cutoff even when older evidence is also present", () => {
    const requirement = requirementFixtures()[0]!;
    requirement.temporalScope = { mode: "as_of", asOf: "2024-12-31" };
    const bundle = requirementBundle([requirement], true, "2024-06-01T00:00:00.000Z");
    const leaf = bundle.tree.find((entry) => entry.node.nodeId === "R_mechanism")!;
    const future = { ...knowledge("2026-03-02T00:00:00.000Z"), nodeId: "K_future", url: "https://policy.gov.example/future" };
    leaf.evidence.push({ link: link("E_future", leaf.node.nodeId, future.nodeId), knowledge: future });

    const audit = auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY, { generatedAt: "2026-07-14T00:00:00.000Z" });

    expect(audit.requirementCoverage.entries[0]).toMatchObject({ status: "stale", freshnessStatus: "stale", latestPublishedAt: "2026-03-02T00:00:00.000Z" });
    expect(audit.issues).toContainEqual(expect.objectContaining({ code: "stale_research_requirement", severity: "error" }));
  });

  it("allows only the explicitly named later source outside an as-of boundary", () => {
    const requirement = requirementFixtures()[0]!;
    requirement.temporalScope = {
      mode: "as_of",
      basis: "covered_period",
      asOf: "2022-12-31",
      exemptSources: [{
        title: "指定的2023年全球就业报告",
        aliases: ["Global Future of Jobs Report 2023"],
      }],
    };
    const bundle = requirementBundle([requirement], true, "2022-06-01T00:00:00.000Z");
    const leaf = bundle.tree.find((entry) => entry.node.nodeId === "R_mechanism")!;
    leaf.evidence[0]!.knowledge.title = "2022 Annual Statistical Report";
    const exempt = {
      ...knowledge("2023-05-01T00:00:00.000Z"),
      nodeId: "K_exempt",
      title: "Global Future of Jobs Report 2023",
      url: "https://global.example/future-jobs-2023",
    };
    leaf.evidence.push({ link: link("E_exempt", leaf.node.nodeId, exempt.nodeId), knowledge: exempt });

    const allowed = auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY, { generatedAt: "2026-07-15T00:00:00.000Z" });
    expect(allowed.requirementCoverage.entries[0]).toMatchObject({
      status: "covered",
      freshnessStatus: "current",
      latestPublishedAt: "2023-05-01T00:00:00.000Z",
      freshKnowledgeNodeIds: expect.arrayContaining(["K_policy", "K_exempt"]),
    });

    const unrelated = {
      ...knowledge("2024-04-01T00:00:00.000Z"),
      nodeId: "K_unrelated_future",
      title: "Unrelated labor market report",
      url: "https://other.example/labor-2024",
    };
    leaf.evidence.push({ link: link("E_unrelated_future", leaf.node.nodeId, unrelated.nodeId), knowledge: unrelated });
    const rejected = auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY, { generatedAt: "2026-07-15T00:00:00.000Z" });

    expect(rejected.requirementCoverage.entries[0]).toMatchObject({ status: "stale", freshnessStatus: "stale" });
    expect(rejected.issues).toContainEqual(expect.objectContaining({ code: "stale_research_requirement", severity: "error" }));
  });

  it("audits open taxonomy groups without treating group labels as entity-field rows", () => {
    const requirement = requirementFixtures()[0]!;
    requirement.description = "Create a categorized table of common sweeteners and discover concrete members within every group.";
    requirement.entityScope = ["High-Intensity Sweeteners", "Sugar Alcohols", "Natural Sweeteners"];
    requirement.entityScopeRole = "groups";
    requirement.metricScope = ["Sweetener Name", "Brand Name", "Primary Uses", "Relative Sweetness"];
    const bundle = requirementBundle([requirement], true);
    const leaf = bundle.tree.find((entry) => entry.node.nodeId === "R_mechanism")!;
    leaf.evidence[0]!.link.claimText = "High-Intensity Sweeteners include several verified named members with brand, usage, and sweetness data.";
    for (const [index, claimText] of [
      "Sugar Alcohols include several verified named members with usage and relative-sweetness evidence.",
      "Natural Sweeteners include several verified named members with source, usage, and sweetness evidence.",
    ].entries()) {
      const source = { ...knowledge(), nodeId: `K_group_${index}`, title: `Official group source ${index}` };
      leaf.evidence.push({
        link: { ...link(`E_group_${index}`, leaf.node.nodeId, source.nodeId), claimText },
        knowledge: source,
      });
    }

    const covered = auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY);
    expect(covered.requirementCoverage.entries[0]).toMatchObject({
      status: "covered",
      requiredEntities: ["High-Intensity Sweeteners", "Sugar Alcohols", "Natural Sweeteners"],
      missingEntities: [],
      requiredMetricCells: [],
    });

    leaf.evidence[2]!.link.claimText = "This source discusses unrelated nutrition topics.";
    const incomplete = auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY);
    expect(incomplete.requirementCoverage.entries[0]).toMatchObject({
      status: "incomplete",
      missingEntities: ["Natural Sweeteners"],
      requiredMetricCells: [],
    });
  });

  it("rejects a later retrospective source when the cutoff applies to publication date", () => {
    const requirement = requirementFixtures()[0]!;
    requirement.description = "Review academic studies published no later than 2018.";
    requirement.kind = "constraint";
    requirement.evidenceRequired = false;
    requirement.temporalScope = { mode: "as_of", basis: "source_publication", asOf: "2018-12-31" };
    const eligible = auditEvidenceQuality(
      requirementBundle([requirement], true, "2018-12-31T18:00:00.000Z"),
      DEFAULT_EVIDENCE_QUALITY_POLICY,
    );
    const retrospective = auditEvidenceQuality(
      requirementBundle([requirement], true, "2020-03-02T00:00:00.000Z"),
      DEFAULT_EVIDENCE_QUALITY_POLICY,
    );

    expect(eligible.requirementCoverage.entries[0]).toMatchObject({ status: "covered", freshnessStatus: "current" });
    expect(retrospective.requirementCoverage.entries[0]).toMatchObject({ status: "stale", freshnessStatus: "stale" });
    expect(retrospective.issues).toContainEqual(expect.objectContaining({
      code: "out_of_scope_source_publication",
      severity: "error",
    }));
  });

  it("does not treat an undated source as publication-window compliant", () => {
    const requirement = requirementFixtures()[0]!;
    requirement.description = "Review academic studies published from 2010 through 2018.";
    requirement.temporalScope = {
      mode: "range",
      basis: "source_publication",
      start: "2010-01-01",
      end: "2018-12-31",
    };
    const audit = auditEvidenceQuality(requirementBundle([requirement], true), DEFAULT_EVIDENCE_QUALITY_POLICY);

    expect(audit.requirementCoverage.entries[0]).toMatchObject({
      status: "freshness_unknown",
      freshnessStatus: "unknown",
    });
    expect(audit.issues).toContainEqual(expect.objectContaining({ code: "unknown_source_publication_date" }));
  });

  it("uses an explicitly covered annual period for as-of evidence even when publication follows the cutoff", () => {
    const requirement = requirementFixtures()[0]!;
    requirement.temporalScope = { mode: "as_of", asOf: "2023-12-31" };
    const bundle = requirementBundle([requirement], true, "2024-03-28T00:00:00.000Z");
    const leaf = bundle.tree.find((entry) => entry.node.nodeId === "R_mechanism")!;
    leaf.evidence[0]!.knowledge.title = "城市轨道交通2023年度统计和分析报告";

    const audit = auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY, { generatedAt: "2026-07-15T00:00:00.000Z" });

    expect(audit.requirementCoverage.entries[0]).toMatchObject({
      status: "covered",
      freshnessStatus: "current",
      latestPublishedAt: "2024-03-28T00:00:00.000Z",
      latestCoverageEnd: "2023-12-31",
      freshKnowledgeNodeIds: ["K_policy"],
    });
    expect(audit.issues).not.toContainEqual(expect.objectContaining({ code: "unknown_source_freshness" }));
    expect(audit.issues).not.toContainEqual(expect.objectContaining({ code: "stale_research_requirement" }));
  });

  it("rejects an annual report whose covered period is after the as-of cutoff", () => {
    const requirement = requirementFixtures()[0]!;
    requirement.temporalScope = { mode: "as_of", asOf: "2023-12-31" };
    const bundle = requirementBundle([requirement], true, "2024-03-28T00:00:00.000Z");
    const leaf = bundle.tree.find((entry) => entry.node.nodeId === "R_mechanism")!;
    leaf.evidence[0]!.knowledge.title = "2025 Annual Statistical Report";

    const audit = auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY, { generatedAt: "2026-07-15T00:00:00.000Z" });

    expect(audit.requirementCoverage.entries[0]).toMatchObject({
      status: "stale",
      freshnessStatus: "stale",
      latestCoverageEnd: "2025-12-31",
    });
    expect(audit.issues).toContainEqual(expect.objectContaining({ code: "stale_research_requirement", severity: "error" }));
  });

  it("detects missing concrete years for an every-year range requirement", () => {
    const requirement = requirementFixtures()[0]!;
    requirement.description = "Provide a value for every year from 2020 through 2023.";
    requirement.successCriteria = ["Each year has a cited value."];
    requirement.temporalScope = { mode: "range", start: "2020-01-01", end: "2023-12-31" };
    const bundle = requirementBundle([requirement], true);
    const leaf = bundle.tree.find((entry) => entry.node.nodeId === "R_mechanism")!;
    leaf.evidence[0]!.link.claimText = "2020: 10 units\n2021: 11 units\n2022: value not available\n2023: 13 units";

    const audit = auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY);

    expect(audit.requirementCoverage.entries[0]).toMatchObject({
      status: "incomplete",
      requiredYears: [2020, 2021, 2022, 2023],
      coveredYears: [2020, 2021, 2023],
      missingYears: [2022],
    });
    expect(audit.issues).toContainEqual(expect.objectContaining({
      code: "incomplete_temporal_coverage",
      severity: "error",
      message: expect.stringContaining("2022"),
    }));
  });

  it("detects a missing explicitly required narrative example", () => {
    const requirement = requirementFixtures()[0]!;
    requirement.exampleScope = ["Moses", "Mephibosheth", "Joash"];
    requirement.successCriteria = ["Analyze every named rescue narrative with cited evidence."];
    const bundle = requirementBundle([requirement], true);
    const leaf = bundle.tree.find((entry) => entry.node.nodeId === "R_mechanism")!;
    leaf.evidence[0]!.link.claimText = "Moses was preserved through coordinated maternal and caregiving action. Evidence for Mephibosheth is unavailable. Joash was hidden with his nurse so the royal line survived.";

    const audit = auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY);

    expect(audit.requirementCoverage.entries[0]).toMatchObject({
      status: "incomplete",
      requiredExamples: ["Moses", "Mephibosheth", "Joash"],
      coveredExamples: ["Moses", "Joash"],
      missingExamples: ["Mephibosheth"],
    });
    expect(audit.issues).toContainEqual(expect.objectContaining({
      code: "incomplete_example_coverage",
      severity: "error",
      missingExamples: ["Mephibosheth"],
    }));
  });

  it("checks only explicitly requested endpoint years when the range is not annual", () => {
    const requirement = requirementFixtures()[0]!;
    requirement.description = "Compare passenger intensity in 2019 and 2022.";
    requirement.successCriteria = ["The comparison includes both requested years."];
    requirement.temporalScope = { mode: "range", start: "2019-01-01", end: "2022-12-31" };
    const bundle = requirementBundle([requirement], true);
    const leaf = bundle.tree.find((entry) => entry.node.nodeId === "R_mechanism")!;
    leaf.evidence[0]!.link.claimText = "2019: 0.78 passengers per km-day\n2022 data has not been extracted";

    const audit = auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY);

    expect(audit.requirementCoverage.entries[0]).toMatchObject({
      status: "incomplete",
      requiredYears: [2019, 2022],
      coveredYears: [2019],
      missingYears: [2022],
    });
  });

  it("does not invent annual obligations for a broad range analysis", () => {
    const requirement = requirementFixtures()[0]!;
    requirement.description = "Analyze the main causes of decline after 2019.";
    requirement.successCriteria = ["Explain the mechanism using evidence."];
    requirement.temporalScope = { mode: "range", start: "2019-01-01", end: "2022-12-31" };
    const bundle = requirementBundle([requirement], true);
    const leaf = bundle.tree.find((entry) => entry.node.nodeId === "R_mechanism")!;
    leaf.evidence[0]!.link.claimText = "In 2021, intensity declined by 32 percent because network length grew faster than demand.";

    const audit = auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY);

    expect(audit.requirementCoverage.entries[0]).toMatchObject({ status: "covered" });
    expect(audit.requirementCoverage.entries[0]?.requiredYears).toBeUndefined();
    expect(audit.issues).not.toContainEqual(expect.objectContaining({ code: "incomplete_temporal_coverage" }));
  });

  it("does not treat a research-publication window as endpoint value obligations", () => {
    const requirement = requirementFixtures()[0]!;
    requirement.description = "总结2009年至2024年间发表的K-12智能导师系统实证研究的地理分布、作者背景和学科重点。";
    requirement.evidenceNeeds = ["2009-2024年间发表的实证研究"];
    requirement.successCriteria = ["指出研究主要集中在美国和亚洲，并概括教育学与计算机科学背景。"];
    requirement.temporalScope = { mode: "range", start: "2009-01-01", end: "2024-12-31" };
    requirement.geographicScope = ["美国", "亚洲"];
    const bundle = requirementBundle([requirement], true);
    const leaf = bundle.tree.find((entry) => entry.node.nodeId === "R_mechanism")!;
    leaf.evidence[0]!.link.claimText = "综述纳入2009年至2024年的实证研究，研究地域主要集中在美国和亚洲，作者以教育学和计算机科学背景为主。";

    const audit = auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY);

    expect(audit.requirementCoverage.entries[0]).toMatchObject({ status: "covered" });
    expect(audit.requirementCoverage.entries[0]?.requiredYears).toBeUndefined();
    expect(audit.requirementCoverage.entries[0]?.requiredEntities).toBeUndefined();
    expect(audit.issues).not.toContainEqual(expect.objectContaining({ code: "incomplete_temporal_coverage" }));
    expect(audit.issues).not.toContainEqual(expect.objectContaining({ code: "incomplete_entity_coverage" }));
  });

  it("does not turn a dated study table corpus into annual endpoint cells", () => {
    const requirement = requirementFixtures()[0]!;
    requirement.description = "Provide a summary table of at least 15 empirical studies from 2020-2023 with columns for authors, country, sample size, research design, outcome, and finding.";
    requirement.evidenceNeeds = ["Empirical studies published from 2020-2023"];
    requirement.successCriteria = ["The table contains at least 15 distinct eligible studies with complete row fields."];
    requirement.temporalScope = { mode: "range", start: "2020-01-01", end: "2023-12-31" };
    const bundle = requirementBundle([requirement], true);
    const leaf = bundle.tree.find((entry) => entry.node.nodeId === "R_mechanism")!;
    leaf.evidence[0]!.link.claimText = "The review includes 15 distinct empirical studies published from 2020 through 2023 with complete study-level fields.";

    const audit = auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY);

    expect(audit.requirementCoverage.entries[0]).toMatchObject({ status: "covered" });
    expect(audit.requirementCoverage.entries[0]?.requiredYears).toBeUndefined();
    expect(audit.issues).not.toContainEqual(expect.objectContaining({ code: "incomplete_temporal_coverage" }));
  });

  it("does not infer categorical table values as entities", () => {
    const requirement = requirementFixtures()[0]!;
    requirement.description = "Provide a summary table of at least 15 empirical studies from 2020-2023 with columns: Authors, Country, Sample Size, Research Design, Outcome Variable, Finding on Effectiveness (effective/ineffective/neutral).";
    requirement.evidenceNeeds = ["At least 15 distinct empirical studies published between 2020-2023"];
    requirement.successCriteria = ["Each row includes every requested field."];
    requirement.temporalScope = { mode: "range", start: "2020-01-01", end: "2023-12-31" };
    requirement.geographicScope = ["global"];
    const bundle = requirementBundle([requirement], true);
    const leaf = bundle.tree.find((entry) => entry.node.nodeId === "R_mechanism")!;
    leaf.evidence[0]!.link.claimText = "The cited review contains 15 eligible study rows and labels each effectiveness finding as effective, ineffective, or neutral.";

    const audit = auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY);

    expect(audit.requirementCoverage.entries[0]).toMatchObject({ status: "covered" });
    expect(audit.requirementCoverage.entries[0]?.requiredYears).toBeUndefined();
    expect(audit.requirementCoverage.entries[0]?.requiredEntities).toBeUndefined();
    expect(audit.issues).not.toContainEqual(expect.objectContaining({ code: "incomplete_entity_coverage" }));
  });

  it("does not require numeric endpoint cells for a chronological policy window", () => {
    const requirement = requirementFixtures()[0]!;
    requirement.description = "Organize a chronological overview of key policies, official statements, significant events, and relevant data from 2005 to the end of 2015.";
    requirement.evidenceNeeds = ["Dated official policy milestones through the end of 2015"];
    requirement.successCriteria = ["The timeline explains the major regulatory and official-statement changes in chronological order."];
    requirement.temporalScope = { mode: "range", start: "2005-01-01", end: "2015-12-31" };
    const bundle = requirementBundle([requirement], true);
    const leaf = bundle.tree.find((entry) => entry.node.nodeId === "R_mechanism")!;
    leaf.evidence[0]!.link.claimText = "The cited policy record documents the chronological regulatory changes and official statements through the end of 2015.";

    const audit = auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY);

    expect(audit.requirementCoverage.entries[0]).toMatchObject({ status: "covered" });
    expect(audit.requirementCoverage.entries[0]?.requiredYears).toBeUndefined();
    expect(audit.issues).not.toContainEqual(expect.objectContaining({ code: "incomplete_temporal_coverage" }));
  });

  it("creates a targeted completion repair task for stale must evidence", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dr-freshness-repair-"));
    try {
      const runtimeProfile = loadDefaultRuntimeProfile();
      runtimeProfile.artifactDir = dir;
      const requirement = requirementFixtures()[0]!;
      requirement.temporalScope = { mode: "current", maxAgeDays: 30 };
      const ctx = createPhaseContext({ sessionId: "S_freshness", userInput: requirement.description }, {
        runtimeProfile,
        artifactDir: dir,
        llm: new EchoJsonLlm(),
        now: () => Date.UTC(2026, 6, 14),
      });
      ctx.state.episodeId = "EP_freshness_repair";
      ctx.state.globalRubric = {
        rubricId: "RB_freshness",
        episodeId: ctx.state.episodeId,
        rubricText: requirement.description,
        outputHints: { language: "en", citationRequired: true, format: "markdown" },
        requirements: [requirement],
      };
      const root = node("R_root", "root", null, [requirement.requirementId]);
      const leaf = node("R_leaf", "hypothesis", root.nodeId, [requirement.requirementId]);
      ctx.state.rootNode = root;
      await ctx.stack.kg.upsertReportNode(root);
      await ctx.stack.kg.upsertReportNode(leaf);
      const staleSource = knowledge("2025-01-01T00:00:00.000Z");
      await ctx.stack.kg.upsertKnowledgeNode(staleSource);
      await ctx.stack.kg.upsertEvidenceLink(link("E_stale", leaf.nodeId, staleSource.nodeId));

      const decision = await completionGatePhase(ctx, { final: false, allowRepairTasks: true });

      expect(decision.decision).toBe("need_more_work");
      const queued = await ctx.stack.ledger.listByStatus("queued");
      expect(queued).toContainEqual(expect.objectContaining({
        reportNodeId: leaf.nodeId,
        objective: expect.stringContaining("[quality:stale_research_requirement]"),
      }));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("creates a targeted repair task that names every missing year", async () => {
    const { ctx, dir, leaf, requirement } = await temporalCompletionContext(
      "Provide a value for every year from 2020 through 2023.",
      "Each year has a cited value.",
      "2020: 10 units\n2021: 11 units\n2022: value not available\n2023: 13 units",
      { mode: "range", start: "2020-01-01", end: "2023-12-31" },
    );
    try {
      const decision = await completionGatePhase(ctx, { final: false, allowRepairTasks: true });
      expect(decision.decision).toBe("need_more_work");
      const repair = (await ctx.stack.ledger.listByStatus("queued"))
        .find((task) => task.objective.includes("[quality:incomplete_temporal_coverage]"));
      expect(repair).toMatchObject({
        reportNodeId: leaf.nodeId,
        title: expect.stringContaining("2022"),
        objective: expect.stringContaining("Missing years requiring concrete cited values: 2022."),
        acceptanceCriteria: expect.arrayContaining([
          "Provide a concrete value with a citation for every missing year: 2022.",
          "Prefer an existing complete annual report; refresh an existing shallow cache before any new search.",
        ]),
      });
      expect(repair?.objective).toContain("new source only after");
      expect(requirement.temporalScope?.mode).toBe("range");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("creates and closes a targeted repair for a missing narrative example", async () => {
    const { ctx, dir, leaf, source } = await exampleCompletionContext(
      "Moses was saved through coordinated caregiving. Joash was hidden with his nurse to preserve the royal line.",
    );
    try {
      const before = await completionGatePhase(ctx, { final: false, allowRepairTasks: true });
      expect(before.decision).toBe("need_more_work");
      const repair = (await ctx.stack.ledger.listByStatus("queued"))
        .find((task) => task.objective.includes("[quality:incomplete_example_coverage]"));
      expect(repair).toMatchObject({
        reportNodeId: leaf.nodeId,
        title: expect.stringContaining("Mephibosheth"),
        objective: expect.stringContaining("Missing narrative examples requiring cited analysis: Mephibosheth."),
        acceptanceCriteria: expect.arrayContaining([
          "Provide cited substantive analysis for every missing narrative example: Mephibosheth.",
          "Do not turn narrative examples into artificial table rows or substitute a sibling example.",
        ]),
      });

      await ctx.stack.kg.upsertEvidenceLink({
        ...link("E_examples_complete", leaf.nodeId, source.nodeId),
        claimText: "Moses was saved through coordinated caregiving. Mephibosheth survived his flight with a nurse, though the escape left him injured. Joash was hidden with his nurse to preserve the royal line.",
      });
      for (const task of await ctx.stack.ledger.listByStatus("queued")) {
        await ctx.stack.ledger.updateStatus(task.taskId, "running", "Narrative example repair started.");
        await ctx.stack.ledger.updateStatus(task.taskId, "completed", "Missing narrative example received cited analysis.");
      }
      const after = await completionGatePhase(ctx, { final: false, allowRepairTasks: false });
      expect(after.decision).toBe("ready_for_report");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("repairs only the missing endpoint for a two-year comparison", async () => {
    const { ctx, dir, leaf } = await temporalCompletionContext(
      "Compare passenger intensity in 2019 and 2022.",
      "The comparison includes both requested years.",
      "2019: 0.78 passengers per km-day\n2022 data has not been extracted",
      { mode: "range", start: "2019-01-01", end: "2022-12-31" },
    );
    try {
      await completionGatePhase(ctx, { final: false, allowRepairTasks: true });
      const repair = (await ctx.stack.ledger.listByStatus("queued"))
        .find((task) => task.objective.includes("[quality:incomplete_temporal_coverage]"));
      expect(repair?.title).toContain("2022");
      expect(repair?.title).not.toContain("2020");
      expect(repair?.objective).toContain("Missing years requiring concrete cited values: 2022.");
      expect(repair?.reportNodeId).toBe(leaf.nodeId);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not create temporal repair work for a broad trend or cause analysis", async () => {
    const { ctx, dir } = await temporalCompletionContext(
      "Analyze the main causes of decline after 2019.",
      "Explain the mechanism using evidence.",
      "In 2021, intensity declined by 32 percent because network length grew faster than demand.",
      { mode: "range", start: "2019-01-01", end: "2022-12-31" },
    );
    try {
      const decision = await completionGatePhase(ctx, { final: false, allowRepairTasks: true });
      expect(decision.decision).toBe("ready_for_report");
      expect((await ctx.stack.ledger.listByStatus("queued"))).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not treat missing or unavailable year text as concrete coverage", () => {
    const requirement = requirementFixtures()[0]!;
    requirement.description = "Provide a value for every year from 2020 through 2022.";
    requirement.successCriteria = ["Each year has a cited value."];
    requirement.temporalScope = { mode: "range", start: "2020-01-01", end: "2022-12-31" };
    const bundle = requirementBundle([requirement], true);
    const leaf = bundle.tree.find((entry) => entry.node.nodeId === "R_mechanism")!;
    leaf.evidence[0]!.link.claimText = "2020: unavailable; 2021: not provided; 2022: 17 units";

    const audit = auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY);

    expect(audit.requirementCoverage.entries[0]).toMatchObject({
      status: "incomplete",
      requiredYears: [2020, 2021, 2022],
      coveredYears: [2022],
      missingYears: [2020, 2021],
    });
  });

  it("closes the temporal gap after a repair adds concrete cited values", async () => {
    const { ctx, dir, leaf, source } = await temporalCompletionContext(
      "Provide a value for every year from 2020 through 2022.",
      "Each year has a cited value.",
      "2020: unavailable\n2021: 11 units\n2022: 13 units",
      { mode: "range", start: "2020-01-01", end: "2022-12-31" },
    );
    try {
      const before = await completionGatePhase(ctx, { final: false, allowRepairTasks: true });
      expect(before.decision).toBe("need_more_work");
      await ctx.stack.kg.upsertEvidenceLink({
        ...link("E_temporal", leaf.nodeId, source.nodeId),
        claimText: "2020: 10 units; 2021: 11 units; 2022: 13 units",
        evidenceQuote: "2020: 10 units; 2021: 11 units; 2022: 13 units",
      });
      for (const task of await ctx.stack.ledger.listByStatus("queued")) {
        await ctx.stack.ledger.updateStatus(task.taskId, "running", "Temporal repair started.");
        await ctx.stack.ledger.updateStatus(task.taskId, "completed", "Temporal repair supplied concrete cited values.");
      }
      const after = await completionGatePhase(ctx, { final: false, allowRepairTasks: false });
      expect(after.decision).toBe("ready_for_report");
      const bundle = await ctx.stack.kg.buildReportBundle(ctx.state.episodeId, ctx.state.rootNode!.nodeId, {
        language: "en",
        citationRequired: true,
        rubricId: ctx.state.globalRubric!.rubricId,
        rubricText: ctx.state.globalRubric!.rubricText,
        requirements: ctx.state.globalRubric!.requirements,
      });
      expect(auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY).requirementCoverage.entries[0]).toMatchObject({
        status: "covered",
        coveredYears: [2020, 2021, 2022],
        missingYears: [],
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("audits entity-year cells instead of treating one city row as a complete table", () => {
    const requirement = requirementFixtures()[0]!;
    requirement.description = "制作表格比较北京、上海、广州2019年和2022年的运营里程。";
    requirement.successCriteria = ["表格包含三个城市和两个年份的具体公里数。"];
    requirement.temporalScope = { mode: "range", start: "2019-01-01", end: "2022-12-31" };
    requirement.geographicScope = ["北京", "上海", "广州"];
    const bundle = requirementBundle([requirement], true);
    const leaf = bundle.tree.find((entry) => entry.node.nodeId === "R_mechanism")!;
    leaf.evidence[0]!.link.claimText = "北京 2019: 100公里; 2022: 120公里; 上海 2019: 80公里; 2022: 95公里; 广州 2019: 70公里";

    const audit = auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY);

    expect(audit.requirementCoverage.entries[0]).toMatchObject({
      status: "incomplete",
      requiredEntities: ["北京", "上海", "广州"],
      coveredEntities: ["北京", "上海", "广州"],
      missingEntities: [],
      missingCells: ["广州|2022"],
    });
    expect(audit.issues).toContainEqual(expect.objectContaining({
      code: "incomplete_entity_coverage",
      message: expect.stringContaining("广州|2022"),
    }));
  });

  it("creates an entity-focused repair task and closes it after the missing row is cited", async () => {
    const { ctx, dir, leaf, source, requirement } = await entityCompletionContext(
      "制作表格比较北京、上海、广州2019年和2022年的运营里程。",
      "北京和上海均有两个年份的公里数，广州缺少2022年。",
      "北京 2019: 100公里; 2022: 120公里; 上海 2019: 80公里; 2022: 95公里; 广州 2019: 70公里",
    );
    try {
      const before = await completionGatePhase(ctx, { final: false, allowRepairTasks: true });
      expect(before.decision).toBe("need_more_work");
      const repair = (await ctx.stack.ledger.listByStatus("queued"))
        .find((task) => task.objective.includes("[quality:incomplete_entity_coverage]"));
      expect(repair).toMatchObject({
        reportNodeId: leaf.nodeId,
        title: expect.stringContaining("广州"),
        objective: expect.stringContaining("广州|2022"),
        acceptanceCriteria: expect.arrayContaining([
          "Cover every missing entity-year cell: 广州|2022.",
          "Refresh an existing shallow cache in place before issuing a new search.",
        ]),
      });

      await ctx.stack.kg.upsertEvidenceLink({
        ...link("E_entity", leaf.nodeId, source.nodeId),
        claimText: "北京 2019: 100公里; 2022: 120公里; 上海 2019: 80公里; 2022: 95公里; 广州 2019: 70公里; 2022: 90公里",
        evidenceQuote: "广州 2022: 90公里",
      });
      for (const task of await ctx.stack.ledger.listByStatus("queued")) {
        await ctx.stack.ledger.updateStatus(task.taskId, "running", "Entity-year repair started.");
        await ctx.stack.ledger.updateStatus(task.taskId, "completed", "Missing city-year row was cited.");
      }
      const after = await completionGatePhase(ctx, { final: false, allowRepairTasks: false });
      expect(after.decision).toBe("ready_for_report");
      const bundle = await ctx.stack.kg.buildReportBundle(ctx.state.episodeId, ctx.state.rootNode!.nodeId, {
        language: "en",
        citationRequired: true,
        rubricId: ctx.state.globalRubric!.rubricId,
        rubricText: ctx.state.globalRubric!.rubricText,
        requirements: ctx.state.globalRubric!.requirements,
      });
      expect(auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY).requirementCoverage.entries[0]).toMatchObject({
        status: "covered",
        missingCells: [],
      });
      expect(requirement.geographicScope).toEqual(["北京", "上海", "广州"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("splits large incomplete entity repairs into bounded parallel batches", async () => {
    const entities = ["北京", "上海", "广州", "深圳", "成都", "重庆", "武汉", "西安", "杭州", "南京", "苏州"];
    const { ctx, dir, requirement } = await entityCompletionContext(
      `制作表格比较${entities.join("、")}在2019年和2022年的运营里程。`,
      "表格包含每个城市和两个年份的具体公里数。",
      "北京 2019: 100公里; 2022: 120公里",
    );
    requirement.geographicScope = entities;
    try {
      const decision = await completionGatePhase(ctx, { final: false, allowRepairTasks: true });
      expect(decision.decision).toBe("need_more_work");
      const repairs = (await ctx.stack.ledger.listByStatus("queued"))
        .filter((task) => task.objective.includes("[quality:incomplete_entity_coverage:batch_"));

      expect(repairs).toHaveLength(2);
      expect(repairs.map((task) => task.objective)).toEqual(expect.arrayContaining([
        expect.stringContaining("上海, 广州, 深圳, 成都, 重庆"),
        expect.stringContaining("武汉, 西安, 杭州, 南京, 苏州"),
      ]));
      expect(repairs.every((task) => task.acceptanceCriteria.some((criterion) => criterion.includes("every missing entity")))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("detects and repairs a missing entity-year-metric value without accepting another metric in the same row", async () => {
    const { ctx, dir, leaf, source } = await metricCompletionContext(
      "北京 2019 日均客运量 100万人次，日均客运强度 0.50万人次/公里日; "
      + "北京 2022 日均客运量 90万人次，日均客运强度 0.42万人次/公里日; "
      + "上海 2019 日均客运量 120万人次，日均客运强度 0.55万人次/公里日; "
      + "上海 2022 日均客运量 80万人次，日均客运强度 unavailable",
    );
    try {
      const beforeBundle = await ctx.stack.kg.buildReportBundle(ctx.state.episodeId, ctx.state.rootNode!.nodeId, {
        language: "zh-CN",
        citationRequired: true,
        rubricId: ctx.state.globalRubric!.rubricId,
        rubricText: ctx.state.globalRubric!.rubricText,
        requirements: ctx.state.globalRubric!.requirements,
      });
      const beforeAudit = auditEvidenceQuality(beforeBundle, DEFAULT_EVIDENCE_QUALITY_POLICY);
      expect(beforeAudit.requirementCoverage.entries[0]).toMatchObject({
        status: "incomplete",
        requiredMetrics: ["日均客运量", "日均客运强度"],
        coveredMetrics: ["日均客运量", "日均客运强度"],
        missingMetrics: [],
        missingMetricCells: ["上海|2022|日均客运强度"],
      });

      const decision = await completionGatePhase(ctx, { final: false, allowRepairTasks: true });
      expect(decision.decision).toBe("need_more_work");
      const queuedRepairs = await ctx.stack.ledger.listByStatus("queued");
      const repair = queuedRepairs
        .find((task) => task.objective.includes("[quality:incomplete_entity_coverage]"));
      expect(queuedRepairs.filter((task) => task.objective.includes("[quality:incomplete_")).length).toBe(1);
      expect(repair).toMatchObject({
        title: expect.stringContaining("上海|2022|日均客运强度"),
        objective: expect.stringContaining("Missing entity-year-field cells requiring concrete cited values: 上海|2022|日均客运强度."),
        acceptanceCriteria: expect.arrayContaining([
          "Cover every missing entity-year-field cell: 上海|2022|日均客运强度.",
        ]),
      });

      await ctx.stack.kg.upsertEvidenceLink({
        ...link("E_metric", leaf.nodeId, source.nodeId),
        claimText: "北京 2019 日均客运量 100万人次，日均客运强度 0.50万人次/公里日; "
          + "北京 2022 日均客运量 90万人次，日均客运强度 0.42万人次/公里日; "
          + "上海 2019 日均客运量 120万人次，日均客运强度 0.55万人次/公里日; "
          + "上海 2022 日均客运量 80万人次，日均客运强度 0.36万人次/公里日",
        evidenceQuote: "上海 2022 日均客运量 80万人次，日均客运强度 0.36万人次/公里日",
      });
      for (const task of await ctx.stack.ledger.listByStatus("queued")) {
        await ctx.stack.ledger.updateStatus(task.taskId, "running", "Metric repair started.");
        await ctx.stack.ledger.updateStatus(task.taskId, "completed", "Missing metric was cited.");
      }
      const after = await completionGatePhase(ctx, { final: false, allowRepairTasks: false });
      expect(after.decision).toBe("ready_for_report");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("audits categorical entity-field cells in a markdown comparison table", () => {
    const requirement = requirementFixtures()[0]!;
    requirement.description = "Create a comparison table for Node.js and React.js with Release Year, Key Area, and XSS support.";
    requirement.kind = "deliverable";
    requirement.evidenceRequired = true;
    requirement.entityScope = ["Node.js", "React.js"];
    requirement.metricScope = ["Release Year", "Key Area", "XSS"];
    requirement.successCriteria = ["Every framework row contains every requested field with a citation."];
    const bundle = requirementBundle([requirement], true);
    const leaf = bundle.tree.find((entry) => entry.node.nodeId === "R_mechanism")!;
    leaf.evidence[0]!.link.claimText = [
      "| Framework | Release Year | Key Area | XSS |",
      "|---|---:|---|---|",
      "| Node.js | 2009 | Runtime Environment | Add. library |",
      "| React.js | 2013 | GUI | unavailable |",
    ].join("\n");

    const audit = auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY);

    expect(audit.requirementCoverage.entries[0]).toMatchObject({
      status: "incomplete",
      requiredEntities: ["Node.js", "React.js"],
      coveredEntities: ["Node.js", "React.js"],
      missingEntities: [],
      requiredMetrics: ["Release Year", "Key Area", "XSS"],
      missingMetrics: [],
      requiredMetricCells: [
        "Node.js|Release Year",
        "Node.js|Key Area",
        "Node.js|XSS",
        "React.js|Release Year",
        "React.js|Key Area",
        "React.js|XSS",
      ],
      missingMetricCells: ["React.js|XSS"],
    });
    expect(audit.issues).toContainEqual(expect.objectContaining({
      code: "incomplete_entity_coverage",
      message: expect.stringContaining("React.js|XSS"),
    }));
  });
});

async function temporalCompletionContext(
  description: string,
  successCriterion: string,
  claimText: string,
  temporalScope: ResearchRequirement["temporalScope"],
): Promise<{ ctx: ReturnType<typeof createPhaseContext>; dir: string; leaf: ReportNode; source: KnowledgeNode; requirement: ResearchRequirement }> {
  const dir = await mkdtemp(join(tmpdir(), "dr-temporal-repair-"));
  const runtimeProfile = loadDefaultRuntimeProfile();
  runtimeProfile.artifactDir = dir;
  const requirement: ResearchRequirement = {
    requirementId: "RQ_TEMPORAL",
    description,
    kind: "question",
    priority: "must",
    evidenceRequired: true,
    evidenceNeeds: ["Requested values"],
    successCriteria: [successCriterion],
    temporalScope,
  };
  const ctx = createPhaseContext({ sessionId: "S_temporal", userInput: description }, {
    runtimeProfile,
    artifactDir: dir,
    llm: new EchoJsonLlm(),
    now: () => Date.UTC(2026, 6, 14),
  });
  ctx.state.episodeId = "EP_temporal_repair";
  ctx.state.globalRubric = {
    rubricId: "RB_temporal",
    episodeId: ctx.state.episodeId,
    rubricText: description,
    outputHints: { language: "en", citationRequired: true, format: "markdown" },
    requirements: [requirement],
  };
  const root = node("R_root", "root", null, [requirement.requirementId]);
  const leaf = node("R_temporal", "hypothesis", root.nodeId, [requirement.requirementId]);
  ctx.state.rootNode = root;
  await ctx.stack.kg.upsertReportNode(root);
  await ctx.stack.kg.upsertReportNode(leaf);
  const source = knowledge();
  await ctx.stack.kg.upsertKnowledgeNode(source);
  await ctx.stack.kg.upsertEvidenceLink({ ...link("E_temporal", leaf.nodeId, source.nodeId), claimText });
  return { ctx, dir, leaf, source, requirement };
}

async function exampleCompletionContext(
  claimText: string,
): Promise<{ ctx: ReturnType<typeof createPhaseContext>; dir: string; leaf: ReportNode; source: KnowledgeNode; requirement: ResearchRequirement }> {
  const dir = await mkdtemp(join(tmpdir(), "dr-example-repair-"));
  const runtimeProfile = loadDefaultRuntimeProfile();
  runtimeProfile.artifactDir = dir;
  const description = "Analyze the rescue narratives of Moses, Mephibosheth, and Joash.";
  const requirement: ResearchRequirement = {
    requirementId: "RQ_NARRATIVE_EXAMPLES",
    description,
    kind: "question",
    priority: "must",
    evidenceRequired: true,
    evidenceNeeds: ["Primary text and scholarship for each named rescue narrative"],
    successCriteria: ["Analyze every named narrative with direct citations."],
    exampleScope: ["Moses", "Mephibosheth", "Joash"],
  };
  const ctx = createPhaseContext({ sessionId: "S_examples", userInput: description }, {
    runtimeProfile,
    artifactDir: dir,
    llm: new EchoJsonLlm(),
    now: () => Date.UTC(2026, 6, 14),
  });
  ctx.state.episodeId = "EP_example_repair";
  ctx.state.globalRubric = {
    rubricId: "RB_examples",
    episodeId: ctx.state.episodeId,
    rubricText: description,
    outputHints: { language: "en", citationRequired: true, format: "markdown" },
    requirements: [requirement],
  };
  const root = node("R_root", "root", null, [requirement.requirementId]);
  const leaf = node("R_examples", "hypothesis", root.nodeId, [requirement.requirementId]);
  ctx.state.rootNode = root;
  await ctx.stack.kg.upsertReportNode(root);
  await ctx.stack.kg.upsertReportNode(leaf);
  const source = knowledge();
  await ctx.stack.kg.upsertKnowledgeNode(source);
  await ctx.stack.kg.upsertEvidenceLink({ ...link("E_examples", leaf.nodeId, source.nodeId), claimText });
  return { ctx, dir, leaf, source, requirement };
}

async function entityCompletionContext(
  description: string,
  successCriterion: string,
  claimText: string,
): Promise<{ ctx: ReturnType<typeof createPhaseContext>; dir: string; leaf: ReportNode; source: KnowledgeNode; requirement: ResearchRequirement }> {
  const dir = await mkdtemp(join(tmpdir(), "dr-entity-repair-"));
  const runtimeProfile = loadDefaultRuntimeProfile();
  runtimeProfile.artifactDir = dir;
  const requirement: ResearchRequirement = {
    requirementId: "RQ_ENTITY_YEAR",
    description,
    kind: "deliverable",
    priority: "must",
    evidenceRequired: true,
    evidenceNeeds: ["Entity-year mileage rows"],
    successCriteria: [successCriterion],
    temporalScope: { mode: "range", start: "2019-01-01", end: "2022-12-31" },
    geographicScope: ["北京", "上海", "广州"],
  };
  const ctx = createPhaseContext({ sessionId: "S_entity_year", userInput: description }, {
    runtimeProfile,
    artifactDir: dir,
    llm: new EchoJsonLlm(),
    now: () => Date.UTC(2026, 6, 14),
  });
  ctx.state.episodeId = "EP_entity_year";
  ctx.state.globalRubric = {
    rubricId: "RB_entity_year",
    episodeId: ctx.state.episodeId,
    rubricText: description,
    outputHints: { language: "en", citationRequired: true, format: "markdown" },
    requirements: [requirement],
  };
  const root = node("R_root", "root", null, [requirement.requirementId]);
  const leaf = node("R_entity_year", "hypothesis", root.nodeId, [requirement.requirementId]);
  ctx.state.rootNode = root;
  await ctx.stack.kg.upsertReportNode(root);
  await ctx.stack.kg.upsertReportNode(leaf);
  const source = knowledge();
  await ctx.stack.kg.upsertKnowledgeNode(source);
  await ctx.stack.kg.upsertEvidenceLink({ ...link("E_entity", leaf.nodeId, source.nodeId), claimText });
  return { ctx, dir, leaf, source, requirement };
}

async function metricCompletionContext(
  claimText: string,
): Promise<{ ctx: ReturnType<typeof createPhaseContext>; dir: string; leaf: ReportNode; source: KnowledgeNode }> {
  const dir = await mkdtemp(join(tmpdir(), "dr-metric-repair-"));
  const runtimeProfile = loadDefaultRuntimeProfile();
  runtimeProfile.artifactDir = dir;
  const description = "制作表格对比北京、上海在2019年和2022年的日均客运量（万人次）和日均客运强度（万人次/公里日）。";
  const requirement: ResearchRequirement = {
    requirementId: "RQ_METRIC_MATRIX",
    description,
    kind: "deliverable",
    priority: "must",
    evidenceRequired: true,
    evidenceNeeds: [
      "北京和上海2019年和2022年日均客运量",
      "北京和上海2019年和2022年日均客运强度",
    ],
    successCriteria: ["每个城市年份均有两个带引用指标。"],
    temporalScope: { mode: "range", start: "2019-01-01", end: "2022-12-31" },
    geographicScope: ["北京", "上海"],
  };
  const ctx = createPhaseContext({ sessionId: "S_metric_matrix", userInput: description }, {
    runtimeProfile,
    artifactDir: dir,
    llm: new EchoJsonLlm(),
    now: () => Date.UTC(2026, 6, 14),
  });
  ctx.state.episodeId = "EP_metric_matrix";
  ctx.state.globalRubric = {
    rubricId: "RB_metric_matrix",
    episodeId: ctx.state.episodeId,
    rubricText: description,
    outputHints: { language: "zh-CN", citationRequired: true, format: "markdown" },
    requirements: [requirement],
  };
  const root = node("R_root", "root", null, [requirement.requirementId]);
  const leaf = node("R_metric_matrix", "hypothesis", root.nodeId, [requirement.requirementId]);
  ctx.state.rootNode = root;
  await ctx.stack.kg.upsertReportNode(root);
  await ctx.stack.kg.upsertReportNode(leaf);
  const source = knowledge();
  await ctx.stack.kg.upsertKnowledgeNode(source);
  await ctx.stack.kg.upsertEvidenceLink({ ...link("E_metric", leaf.nodeId, source.nodeId), claimText });
  return { ctx, dir, leaf, source };
}

function requirementFixtures(): ResearchRequirement[] {
  return [
    {
      requirementId: "RQ_MECHANISM",
      description: "Compare the financing policy mechanisms.",
      kind: "comparison",
      priority: "must",
      evidenceNeeds: ["Official policy documents"],
      successCriteria: ["Explains the incentive mechanism"],
    },
    {
      requirementId: "RQ_RISK",
      description: "Assess implementation risk and failure modes.",
      kind: "risk",
      priority: "must",
      evidenceNeeds: ["Audits and implementation cases"],
      successCriteria: ["Names material failure modes"],
    },
  ];
}

function requirementBundle(requirements: ResearchRequirement[], groundRisk: boolean, publishedAt?: string): ReportBundle {
  const root = node("R_root", "root", null, requirements.map((item) => item.requirementId));
  const aspect = node("R_aspect", "aspect", root.nodeId, requirements.map((item) => item.requirementId));
  const mechanism = node("R_mechanism", "hypothesis", aspect.nodeId, ["RQ_MECHANISM"]);
  const risk = node("R_risk", "hypothesis", aspect.nodeId, ["RQ_RISK"]);
  const source = knowledge(publishedAt);
  const mechanismLink = link("E_mechanism", mechanism.nodeId, source.nodeId);
  const riskLink = link("E_risk", risk.nodeId, source.nodeId);
  return {
    episodeId: "EP_requirements",
    root,
    tree: [
      { node: root, children: [aspect.nodeId], evidence: [], reportlets: [], openGaps: [] },
      { node: aspect, children: [mechanism.nodeId, risk.nodeId], evidence: [], reportlets: [], openGaps: [] },
      { node: mechanism, children: [], evidence: [{ link: mechanismLink, knowledge: source }], reportlets: [], openGaps: [] },
      { node: risk, children: [], evidence: groundRisk ? [{ link: riskLink, knowledge: source }] : [], reportlets: [], openGaps: [] },
    ],
    globalEvidenceIndex: [{
      citationId: "C1",
      knowledgeNodeId: source.nodeId,
      title: source.title,
      url: source.url,
      canonicalUrl: source.url,
      sourceTier: source.sourceTier,
      summary: source.summary,
      retrievedAt: source.retrievedAt,
    }],
    constraints: {
      language: "en",
      citationRequired: true,
      rubricId: "RB_requirements",
      rubricText: "Cover all requirements.",
      requirements,
    },
  };
}

function node(nodeId: string, nodeKind: ReportNode["nodeKind"], parentNodeId: string | null, requirementIds: string[]): ReportNode {
  return {
    nodeId,
    nodeKind,
    parentNodeId,
    requirementIds,
    label: nodeId,
    scopeNote: nodeId,
    status: nodeKind === "hypothesis" ? "supported" : "verified",
    hypothesis: nodeKind === "hypothesis" ? { statement: nodeId, researchBrief: nodeId, evidenceGuidance: nodeId } : undefined,
    coverage: { supportingCount: 1, contradictingCount: 0, openGapCount: 0 },
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
  };
}

function knowledge(publishedAt?: string): KnowledgeNode {
  return {
    nodeId: "K_policy",
    nodeType: "Report",
    title: "Official policy report",
    url: "https://policy.gov.example/report",
    contentHash: "hash:policy",
    summary: "Policy evidence.",
    sourceTier: "official",
    qualityScore: 0.9,
    retrievedByTaskId: "T_policy",
    retrievedAt: "2026-07-14T00:00:00.000Z",
    metadata: { fetched: true, contentPreview: "x".repeat(300), publishedAt },
  };
}

function link(linkId: string, reportNodeId: string, knowledgeNodeId: string): EvidenceLink {
  return {
    linkId,
    reportNodeId,
    knowledgeNodeId,
    relation: "supports",
    claimText: "The evidence directly addresses the requirement.",
    confidence: 0.8,
    createdByTaskId: "T_policy",
    createdAt: "2026-07-14T00:00:00.000Z",
  };
}
