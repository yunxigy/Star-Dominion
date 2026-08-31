import type { EvidenceLink, KnowledgeNode, ReportBundle, ReportNode } from "@deepresearch/contracts";
import { describe, expect, it } from "vitest";
import {
  acceptFinalizedReport,
  assembleLeafFirstReport,
  completeProvableLocalCitations,
  normalizeDuplicateLocalCitations,
  propagateLeadCitationsToQuantitativeListItems,
  detectMissingRenderedDeliverables,
  detectRenderedTopLevelSectionCountIssue,
  mergeSynthesisConclusionIntoFinalSection,
  relatedSupplementalEvidence,
  requestedTopLevelSectionCount,
  stripStandaloneLeafCoverageNotes,
} from "../phases/report.js";
import { auditEvidenceQuality, resolveEvidenceQualityPolicy } from "../evidence-quality.js";

describe("report supplemental evidence", () => {
  it("copies a cited list lead onto uncited quantitative bullets without inventing citations", () => {
    const markdown = [
      "Targets in the official regulation are [C2]:",
      "",
      "- 45% by 2023",
      "- 63% by 2027 [C3]",
      "- qualitative implementation note",
      "",
      "A new uncited paragraph.",
      "",
      "- 80% by 2031",
    ].join("\n");

    expect(propagateLeadCitationsToQuantitativeListItems(markdown)).toBe([
      "Targets in the official regulation are [C2]:",
      "",
      "- 45% by 2023 [C2]",
      "- 63% by 2027 [C3]",
      "- qualitative implementation note",
      "",
      "A new uncited paragraph.",
      "",
      "- 80% by 2031",
    ].join("\n"));
  });

  it("completes only quantitative citations fully supported by one mapped source", () => {
    const bundle = comparisonBundle();
    const source = knowledge(
      "K_regulation",
      "Regulation (EU) 2023/1542",
      "Official battery regulation source.",
    );
    const first = evidence(
      "E_collection",
      "R_table",
      source.nodeId,
      "Regulation (EU) 2023/1542 sets collection targets of 45% in 2023, 63% in 2027, and 73% in 2030.",
    );
    const second = evidence(
      "E_recovery",
      "R_table",
      source.nodeId,
      "Regulation (EU) 2023/1542 Annex XII Part C sets lithium recovery targets of 50% in 2027 and 80% in 2031.",
    );
    bundle.tree[1]!.evidence = [
      { link: first, knowledge: source },
      { link: second, knowledge: source },
    ];
    bundle.globalEvidenceIndex = [citation("C1", source)];
    const markdown = [
      "## 执行摘要",
      "",
      "Regulation (EU) 2023/1542 分阶段设定了两类目标。",
      "2023年的45%提升到2030年的73%。锂回收目标从2027年的50%提升到2031年的80%。",
      "2029年达到99%。",
    ].join("\n");

    const completed = completeProvableLocalCitations(markdown, bundle);

    expect(completed).toContain("2023/1542 分阶段设定了两类目标 [C1]。");
    expect(completed).toContain("2023年的45%提升到2030年的73% [C1]。");
    expect(completed).toContain("2027年的50%提升到2031年的80% [C1]。");
    expect(completed).toContain("2029年达到99%。");
    const supportedOnly = completed.replace("\n2029年达到99%。", "");
    const audit = auditEvidenceQuality(bundle, resolveEvidenceQualityPolicy({ mode: "strict" }), {
      markdown: supportedOnly,
      citationMap: { C1: source.nodeId },
      generatedAt: "2026-07-15T00:00:00.000Z",
    });
    expect(audit.reportGrounding?.citationCoverage).toBeGreaterThanOrEqual(0.8);
    expect(audit.reportGrounding?.uncitedQuantitativeClaimCount).toBe(0);
  });

  it("removes duplicate local citation markers without merging distinct citations", () => {
    const markdown = "- 2027年达到50% [C1]。 [C1]\n- 2031年达到80% [C1][C1]\nComparison [C1][C2].";

    expect(normalizeDuplicateLocalCitations(markdown)).toBe(
      "- 2027年达到50% [C1]。\n- 2031年达到80% [C1]\nComparison [C1][C2].",
    );
  });
  it("removes leaf-local coverage notes so stale boundaries cannot contradict later repaired sections", () => {
    const markdown = [
      "### 适应症比较",
      "",
      "FDA与EMA的适应症差异已经由官方材料建立 [C1][C2]。",
      "",
      "**覆盖说明**：批准时间的比较未在可用证据中建立，因此未包含。",
    ].join("\n");

    const stripped = stripStandaloneLeafCoverageNotes(markdown);

    expect(stripped).toContain("适应症差异已经由官方材料建立");
    expect(stripped).not.toContain("覆盖说明");
    expect(stripped).not.toContain("批准时间的比较未在可用证据中建立");
  });

  it("merges root synthesis into a user-requested final conclusion section", () => {
    const sections = [
      { title: "Topical Treatments", markdown: "## Topical Treatments\n\nEvidence-backed topical analysis [C1]." },
      { title: "Aesthetic Procedure Treatments (Non-Laser)", markdown: "## Aesthetic Procedure Treatments (Non-Laser)\n\nProcedure evidence [C2]." },
      { title: "Laser and Phototherapy", markdown: "## Laser and Phototherapy\n\nLaser evidence and recurrence risks [C3]." },
      { title: "Comprehensive Comparison and Conclusion", markdown: "## Comprehensive Comparison and Conclusion\n\nInitial cross-treatment comparison [C1][C3]." },
    ];
    const conclusion = "## Conclusion\n\nTopicals remain first-line, while devices require risk-aware selection and maintenance [C1][C3].";

    const merged = mergeSynthesisConclusionIntoFinalSection(sections, conclusion, "en");
    const reportBody = merged.sections.map((section) => section.markdown).join("\n\n");

    expect(merged.trailingConclusion).toBeUndefined();
    expect(merged.conclusionMerged).toBe(true);
    expect(merged.sections).toHaveLength(4);
    expect(merged.sections[3]?.markdown).toContain("## Comprehensive Comparison and Conclusion");
    expect(merged.sections[3]?.markdown).toContain("### Cross-Section Synthesis, Recommendations, and Conclusion");
    expect(merged.sections[3]?.markdown).toContain("Topicals remain first-line");
    expect(Array.from(reportBody.matchAll(/(^|\n)##\s+[^\n]*(?:conclusion|recommendation)[^\n]*/giu))).toHaveLength(1);

    const ordinary = mergeSynthesisConclusionIntoFinalSection(
      sections.slice(0, 3),
      conclusion,
      "en",
    );
    expect(ordinary.trailingConclusion).toBe(conclusion);
    expect(ordinary.conclusionMerged).toBe(false);

    const bundle = comparisonBundle();
    bundle.root.label = "Melasma Treatment Methods";
    const assembled = assembleLeafFirstReport(
      bundle,
      sections,
      "## Executive Summary\n\nEvidence-led overview [C1].\n\n## Conclusion\n\nCross-section recommendation [C1][C3].",
    );
    const levelTwoHeadings = Array.from(assembled.matchAll(/^##\s+(.+)$/gmu)).map((match) => match[1]);
    expect(levelTwoHeadings).toEqual([
      "Topical Treatments",
      "Aesthetic Procedure Treatments (Non-Laser)",
      "Laser and Phototherapy",
      "Comprehensive Comparison and Conclusion",
    ]);
    expect(assembled).toContain("**Executive Summary.**");
    expect(assembled).toContain("Cross-section recommendation");

    const threeSections = [
      { title: "Academic Research Directions in Anime", markdown: "## Academic Research Directions in Anime\n\nResearch directions [C1]." },
      { title: "Representational Text vs. Media Form", markdown: "## Representational Text vs. Media Form\n\nApproach comparison [C2]." },
      { title: "Comparative Analysis with Nordic Noir Dramas", markdown: "## Comparative Analysis with Nordic Noir Dramas\n\nTransnational comparison [C3]." },
    ];
    bundle.constraints.rubricText = "Please divide your answer into three sections, each corresponding to the three tasks above.";
    const strictThree = assembleLeafFirstReport(
      bundle,
      threeSections,
      "## Executive Summary\n\nAcademic survey overview [C1].\n\n## Conclusion\n\nThe comparison reveals a shared globalization logic [C2][C3].",
    );
    expect(strictThree.split("\n").filter((line) => line.startsWith("## ")).map((line) => line.slice(3))).toEqual([
      "Academic Research Directions in Anime",
      "Representational Text vs. Media Form",
      "Comparative Analysis with Nordic Noir Dramas",
    ]);
    expect(strictThree).toContain("### Cross-Section Synthesis, Recommendations, and Conclusion");
    expect(strictThree).toContain("**Executive Summary.**");

    bundle.constraints.rubricText = "Use at least three sections where helpful；报告至少分为三个部分。";
    const minimumOnly = assembleLeafFirstReport(
      bundle,
      threeSections,
      "## Executive Summary\n\nOverview.\n\n## Conclusion\n\nConclusion.",
    );
    expect(minimumOnly.split("\n").filter((line) => line.startsWith("## "))).toHaveLength(5);
  });

  it("preserves a top-level section count declared by a numbered deliverable list", () => {
    const bundle = comparisonBundle();
    bundle.root.label = "《剑桥中国文学史》的理论革新";
    bundle.constraints.language = "zh-CN";
    bundle.constraints.rubricText = [
      "具体来说，报告需要包含以下几个部分：",
      "",
      "1. **传统方法的批判**：总结传统文学史写作的问题。",
      "",
      "2. **新理论的提出**：阐述新的编纂原则。",
      "",
      "3. **新历史主义的影响**：分析新历史主义的理论影响。",
      "",
      "4. **‘中国性’的重塑**：解释中国文学和中国性的重新定义。",
    ].join("\n");
    const sections = [
      { title: "传统方法的批判", markdown: "## 传统方法的批判\n\n传统叙事分析 [C1]。" },
      { title: "新理论的提出", markdown: "## 新理论的提出\n\n编纂原则分析 [C1]。" },
      { title: "新历史主义的影响", markdown: "## 新历史主义的影响\n\n理论影响分析 [C1]。" },
      { title: "‘中国性’的重塑", markdown: "## ‘中国性’的重塑\n\n社群界定分析 [C1]。" },
    ];
    const assembled = assembleLeafFirstReport(
      bundle,
      sections,
      "## 执行摘要\n\n本报告梳理四项理论革新 [C1]。\n\n## 结论\n\n这些原则共同改写了文学史的边界 [C1]。",
    );

    expect(assembled.split("\n").filter((line) => line.startsWith("## ")).map((line) => line.slice(3))).toEqual(
      sections.map((section) => section.title),
    );
    expect(assembled).toContain("**执行摘要.**");
    expect(assembled).toContain("### 跨分节综合、建议与结论");

    const englishSections = sections.slice(0, 3).map((section, index) => ({
      title: `Requested Part ${index + 1}`,
      markdown: `## Requested Part ${index + 1}\n\nEvidence-backed discussion [C1].`,
    }));
    bundle.constraints.language = "en";
    bundle.constraints.rubricText = [
      "The report should include the following sections:",
      "",
      "(1) Traditional methods",
      "  2. Nested detail within the first part",
      "(2) New principles",
      "(3) New Historicism",
    ].join("\n");
    const englishEnumerated = assembleLeafFirstReport(
      bundle,
      englishSections,
      "## Executive Summary\n\nOverview [C1].\n\n## Conclusion\n\nSynthesis [C1].",
    );
    expect(englishEnumerated.split("\n").filter((line) => line.startsWith("## "))).toHaveLength(3);

    bundle.constraints.rubricText = [
      "The report should include at least the following sections:",
      "",
      "1. Traditional methods",
      "2. New principles",
      "3. New Historicism",
    ].join("\n");
    const minimumEnumerated = assembleLeafFirstReport(
      bundle,
      englishSections,
      "## Executive Summary\n\nOverview [C1].\n\n## Conclusion\n\nSynthesis [C1].",
    );
    expect(minimumEnumerated.split("\n").filter((line) => line.startsWith("## "))).toHaveLength(5);
  });

  it("prefers a complete top-level task sequence over a conflicting smaller section count", () => {
    const bundle = comparisonBundle();
    bundle.constraints.rubricText = [
      "Please divide the report into two main sections.",
      "",
      "First, provide a comprehensive overview of every pension system.",
      "",
      "Second, create the requested comparative tables.",
      "",
      "Finally, analyze the main drivers of retirement savings protection gaps.",
    ].join("\n");
    const threeRequiredOutputs = [
      "# Retirement savings protection gaps",
      "",
      "## Overview of Pension Systems",
      "Profiles by country.",
      "",
      "## Comparative Tables",
      "Two complete tables.",
      "",
      "## Analysis of Protection Gaps",
      "Synthesis of rule-driven gaps.",
    ].join("\n");

    expect(requestedTopLevelSectionCount(bundle)).toBe(3);
    expect(detectRenderedTopLevelSectionCountIssue(bundle, threeRequiredOutputs)).toBeUndefined();
    const assembled = assembleLeafFirstReport(bundle, [
      { title: "Overview of Pension Systems", markdown: "## Overview of Pension Systems\n\nProfiles by country [C1]." },
      { title: "Comparative Tables", markdown: "## Comparative Tables\n\nTwo complete tables [C1]." },
      { title: "Analysis of Protection Gaps", markdown: "## Analysis of Protection Gaps\n\nRule-driven synthesis [C1]." },
    ], "## Executive Summary\n\nOverview [C1].\n\n## Conclusion\n\nClosing synthesis [C1].");
    expect(assembled.split("\n").filter((line) => line.startsWith("## "))).toHaveLength(3);
    expect(assembled).toContain("### Cross-Section Synthesis, Recommendations, and Conclusion");

    bundle.constraints.rubricText = [
      "Please divide the report into two main sections.",
      "",
      "First, provide the pension-system overview.",
      "",
      "Second, provide the comparison and concluding analysis.",
    ].join("\n");
    expect(requestedTopLevelSectionCount(bundle)).toBe(2);

    bundle.constraints.rubricText = [
      "请将报告分为两个主要部分。",
      "首先，提供养老金制度概览。",
      "其次，创建比较表格。",
      "最后，分析退休储蓄保障缺口。",
    ].join("\n");
    expect(requestedTopLevelSectionCount(bundle)).toBe(3);
  });

  it("reuses related sibling evidence for a deliverable without importing unrelated claims", () => {
    const root = reportNode("R_root", "root", "Energy recovery report", null);
    const deliverable = reportNode("R_table", "hypothesis", "Comparison of micro-hydroturbines and PATs", "R_root", ["REQ_table"]);
    const comparison = reportNode("R_compare", "hypothesis", "Efficiency and cost comparison", "R_root");
    const unrelated = reportNode("R_unrelated", "hypothesis", "Unrelated urban history", "R_root");
    const relatedKnowledge = knowledge("K_related", "PAT equipment cost evidence", "PAT systems can reduce equipment and procurement cost.");
    const efficiencyKnowledge = knowledge("K_efficiency", "Turbine efficiency evidence", "Conventional turbines can reach higher peak efficiency than PAT systems.");
    const unrelatedKnowledge = knowledge("K_unrelated", "Urban history source", "A chronology of municipal boundaries and elections.");
    const relatedLink = evidence("E_related", comparison.nodeId, relatedKnowledge.nodeId, "PATs can have lower equipment cost than conventional turbines.");
    const efficiencyLink = evidence("E_efficiency", comparison.nodeId, efficiencyKnowledge.nodeId, "Conventional turbines can reach higher peak efficiency.");
    const unrelatedLink = evidence("E_unrelated", unrelated.nodeId, unrelatedKnowledge.nodeId, "The city boundary changed in 1980.");
    const bundle: ReportBundle = {
      episodeId: "EP_report_supplemental",
      root,
      tree: [
        { node: root, children: [deliverable.nodeId, comparison.nodeId, unrelated.nodeId], evidence: [], reportlets: [], openGaps: [] },
        { node: deliverable, children: [], evidence: [], reportlets: [], openGaps: [] },
        {
          node: comparison,
          children: [],
          evidence: [
            { link: relatedLink, knowledge: relatedKnowledge },
            { link: efficiencyLink, knowledge: efficiencyKnowledge },
          ],
          reportlets: [],
          openGaps: [],
        },
        { node: unrelated, children: [], evidence: [{ link: unrelatedLink, knowledge: unrelatedKnowledge }], reportlets: [], openGaps: [] },
      ],
      globalEvidenceIndex: [
        citation("C1", relatedKnowledge),
        citation("C2", unrelatedKnowledge),
        citation("C3", efficiencyKnowledge),
      ],
      constraints: {
        language: "en",
        citationRequired: true,
        rubricId: "RB_report_supplemental",
        rubricText: "Create the requested comparison table.",
        requirements: [{
          requirementId: "REQ_table",
          description: "Create a table comparing conventional micro-hydroturbines and PATs across efficiency and cost.",
          kind: "deliverable",
          priority: "must",
          evidenceRequired: true,
          evidenceNeeds: ["Efficiency and cost evidence for both technologies"],
          successCriteria: ["The comparison table contains efficiency and cost rows."],
        }],
      },
    };

    const selected = relatedSupplementalEvidence(bundle, bundle.tree[1]!, new Set(), 2);

    expect(selected.map((item) => item.knowledge.nodeId)).toContain("K_related");
    expect(selected.map((item) => item.knowledge.nodeId)).toContain("K_efficiency");
    expect(selected.map((item) => item.knowledge.nodeId)).not.toContain("K_unrelated");
  });

  it("requires the table inside the deliverable's own section", () => {
    const bundle = comparisonBundle();
    const wrongSection = [
      "# Energy recovery report",
      "",
      "## Technical characteristics",
      "",
      "| Metric | PAT |",
      "| --- | --- |",
      "| Efficiency | 80% [C1] |",
      "",
      "## Comparison of micro-hydroturbines and PATs",
      "",
      "The two options differ in cost and efficiency [C1].",
    ].join("\n");

    expect(detectMissingRenderedDeliverables(bundle, wrongSection)).toEqual([
      expect.objectContaining({ requirementId: "REQ_table", reason: "missing_table" }),
    ]);

    const rendered = wrongSection.replace(
      "The two options differ in cost and efficiency [C1].",
      [
        "| Metric | Conventional turbine | PAT |",
        "| --- | --- | --- |",
        "| Efficiency | Not established by cited evidence | Lower peak efficiency in the cited comparison [C1] |",
      ].join("\n"),
    );
    expect(detectMissingRenderedDeliverables(bundle, rendered)).toEqual([]);
  });

  it("requires the explicit number of independent tables without confusing table columns for tables", () => {
    const bundle = comparisonBundle();
    bundle.constraints.language = "zh-CN";
    bundle.constraints.requirements![0] = {
      ...bundle.constraints.requirements![0]!,
      description: "创建三个独立的表格，分别展示人口统计、社会经济以及地理和健康史。每个表格必须包含三列。",
      successCriteria: [
        "报告包含三个独立表格。",
        "每个表格均包含分类、正畸治疗使用者百分比和非正畸治疗使用者百分比三列。",
      ],
    };
    const report = (tables: number) => [
      "# 美国正畸治疗人群画像",
      "",
      "## Comparison of micro-hydroturbines and PATs",
      "",
      ...Array.from({ length: tables }, (_, index) => [
        `### 表格 ${index + 1}`,
        "",
        "| 分类 | 正畸治疗使用者百分比 | 非正畸治疗使用者百分比 |",
        "| --- | --- | --- |",
        `| 示例分类 ${index + 1} | 60% [C1] | 40% [C1] |`,
        "",
      ]).flat(),
    ].join("\n");

    expect(detectMissingRenderedDeliverables(bundle, report(1))).toEqual([
      expect.objectContaining({
        requirementId: "REQ_table",
        reason: "insufficient_tables",
        expectedTableCount: 3,
        observedTableCount: 1,
      }),
    ]);
    expect(detectMissingRenderedDeliverables(bundle, report(3))).toEqual([]);

    bundle.constraints.requirements![0] = {
      ...bundle.constraints.requirements![0]!,
      description: "Use the first table for demographics, the second table for socioeconomic factors, and the third table for geography and health history.",
      successCriteria: ["Keep the three table groups separate."],
    };
    expect(detectMissingRenderedDeliverables(bundle, report(2))).toEqual([
      expect.objectContaining({ reason: "insufficient_tables", expectedTableCount: 3, observedTableCount: 2 }),
    ]);

    bundle.constraints.requirements![0] = {
      ...bundle.constraints.requirements![0]!,
      description: "Create one comparison table with three columns: category, users, and non-users.",
      successCriteria: ["The table has three columns."],
    };
    expect(detectMissingRenderedDeliverables(bundle, report(1))).toEqual([]);

    bundle.constraints.requirements![0] = {
      ...bundle.constraints.requirements![0]!,
      description: "Use at most three tables and keep each table concise.",
      successCriteria: ["Do not exceed three tables."],
    };
    expect(detectMissingRenderedDeliverables(bundle, report(1))).toEqual([]);
  });

  it("conserves every named entity exactly once across labeled partition tables", () => {
    const bundle = comparisonBundle();
    const partitions = ["基于JavaScript的框架", "基于其他编程语言的框架"];
    const entities = ["Node.js", "React.js", "Vue.js", "Django", "Flask", "Laravel"];
    bundle.constraints.requirements = [{
      requirementId: "RQ_TABLE_PARTITION_CONTRACT",
      description: `Render exactly 2 labeled Markdown table partitions: ${partitions.map((partition) => `[${partition}]`).join(", ")}. Every scoped entity must appear in exactly one partition table.`,
      kind: "deliverable",
      priority: "must",
      evidenceRequired: false,
      evidenceNeeds: [],
      successCriteria: ["Every partition is labeled, no scoped entity is omitted, and no scoped entity appears in more than one partition."],
      entityScope: entities,
      entityScopeRole: "members",
    }];
    const table = (title: string, rows: string[]) => [
      `### ${title}`,
      "",
      "| Framework | Key Area | Security |",
      "| --- | --- | --- |",
      ...rows.map((entity) => `| ${entity} | Role [C1] | Support [C1] |`),
      "",
    ];
    const report = (first: string[], second: string[], secondTitle = partitions[1]!) => [
      "# Web framework comparison",
      "",
      "## Comparison Tables",
      "",
      ...table(partitions[0]!, first),
      ...table(secondTitle, second),
    ].join("\n");

    const duplicated = report(["Node.js", "React.js", "Vue.js"], ["Node.js", "Django", "Flask"]);
    expect(detectMissingRenderedDeliverables(bundle, duplicated)).toEqual([expect.objectContaining({
      reason: "incomplete_table",
      missingEntities: ["Laravel"],
      duplicateEntities: ["Node.js"],
    })]);
    expect(detectMissingRenderedDeliverables(bundle, report(
      ["Node.js", "React.js", "Vue.js"],
      ["Django", "Flask", "Laravel"],
      "后端框架",
    ))).toEqual([expect.objectContaining({
      reason: "incomplete_table",
      missingPartitions: ["基于其他编程语言的框架"],
    })]);
    expect(detectMissingRenderedDeliverables(bundle, report(
      ["Node.js", "React.js", "Vue.js"],
      ["Django", "Flask", "Laravel"],
    ))).toEqual([]);

    bundle.constraints.requirements = [{
      requirementId: "REQ_member_table",
      description: "Create one comparison table for Node.js, React.js, and Vue.js.",
      kind: "deliverable",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Framework evidence"],
      successCriteria: ["Every requested framework has one row."],
      entityScope: ["Node.js", "React.js", "Vue.js"],
      entityScopeRole: "members",
    }];
    const ordinary = [
      "# Frameworks",
      "",
      "## Comparison table for Node.js, React.js, and Vue.js",
      "",
      "| Framework | Role |",
      "| --- | --- |",
      "| Node.js | Runtime [C1] |",
      "| React.js | GUI [C1] |",
    ].join("\n");
    expect(detectMissingRenderedDeliverables(bundle, ordinary)).toEqual([expect.objectContaining({
      reason: "incomplete_table",
      missingEntities: ["Vue.js"],
    })]);
  });

  it("validates counted-study table columns and complete distinct cited rows", () => {
    const bundle = comparisonBundle();
    const columns = ["Authors", "Country", "Sample Size", "Research Design", "Outcome Variable", "Finding on Effectiveness"];
    bundle.root.label = "Online learning effectiveness review";
    bundle.constraints.rubricText = "The output must contain a summary table of at least 15 reviewed empirical studies.";
    bundle.constraints.requirements![0] = {
      ...bundle.constraints.requirements![0]!,
      description: "Create a summary table of at least 15 empirical studies with columns in this specific order: Authors, Country, Sample Size, Research Design, Outcome Variable, Finding on Effectiveness.",
      successCriteria: ["The table contains at least 15 distinct cited studies with every requested field."],
      metricScope: columns,
    };
    const table = (headers: string[], rowNumbers: number[]) => [
      `| ${headers.join(" | ")} |`,
      `| ${headers.map(() => "---").join(" | ")} |`,
      ...rowNumbers.map((number) => `| Author ${number} [C1] | Country ${number} | ${100 + number} | Cross-sectional survey | Learning outcome | Effective |`),
    ].join("\n");
    const report = (renderedTable: string) => [
      "# Online learning effectiveness review",
      "",
      "## Summary Table of Reviewed Studies",
      "",
      renderedTable,
    ].join("\n");

    const wrongOrder = [...columns];
    [wrongOrder[0], wrongOrder[1]] = [wrongOrder[1]!, wrongOrder[0]!];
    expect(detectMissingRenderedDeliverables(bundle, report(table(wrongOrder, Array.from({ length: 15 }, (_, index) => index + 1))))).toEqual([
      expect.objectContaining({ reason: "wrong_table_columns", expectedTableColumns: columns }),
    ]);
    expect(detectMissingRenderedDeliverables(bundle, report(table(columns, Array.from({ length: 14 }, (_, index) => index + 1))))).toEqual([
      expect.objectContaining({ reason: "incomplete_table", minimumTableRows: 15, observedTableRows: 14 }),
    ]);
    expect(detectMissingRenderedDeliverables(bundle, report(table(columns, [...Array.from({ length: 14 }, (_, index) => index + 1), 1])))).toEqual([
      expect.objectContaining({ reason: "incomplete_table", minimumTableRows: 15, observedTableRows: 14 }),
    ]);
    const completeTable = table(columns, Array.from({ length: 15 }, (_, index) => index + 1));
    expect(detectMissingRenderedDeliverables(bundle, report(completeTable.replace("Author 15 [C1]", "Author 15")))).toEqual([
      expect.objectContaining({ reason: "incomplete_table", minimumTableRows: 15, observedTableRows: 14 }),
    ]);
    expect(detectMissingRenderedDeliverables(bundle, report(completeTable.replace("Country 15", "Not reported")))).toEqual([
      expect.objectContaining({ reason: "incomplete_table", minimumTableRows: 15, observedTableRows: 14 }),
    ]);
    expect(detectMissingRenderedDeliverables(bundle, report(completeTable))).toEqual([]);
  });

  it("validates exact columns for ordinary taxonomy tables", () => {
    const bundle = comparisonBundle();
    const columns = ["Algorithm Category", "Specific Algorithm Name/Model", "Main Application Objective"];
    bundle.root.label = "HMLV scheduling review";
    bundle.tree[1]!.node.label = "Classification of Common Algorithms";
    bundle.constraints.requirements![0] = {
      ...bundle.constraints.requirements![0]!,
      description: "Classify HMLV scheduling algorithms in a table.",
      successCriteria: [
        "The Markdown table headers must appear exactly in this order: [Algorithm Category], [Specific Algorithm Name/Model], [Main Application Objective].",
      ],
      metricScope: columns,
    };
    const report = (headers: string[]) => [
      "# HMLV scheduling review",
      "",
      "## Classification of Common Algorithms",
      "",
      `| ${headers.join(" | ")} |`,
      `| ${headers.map(() => "---").join(" | ")} |`,
      "| Heuristic Algorithms | Two-phase searching algorithm [C1] | Job sequencing |",
    ].join("\n");

    expect(detectMissingRenderedDeliverables(bundle, report([
      "Specific Algorithm Name/Model",
      "Algorithm Category",
      "Main Application Objective",
    ]))).toEqual([
      expect.objectContaining({ reason: "wrong_table_columns", expectedTableColumns: columns }),
    ]);
    expect(detectMissingRenderedDeliverables(bundle, report(columns))).toEqual([]);
  });

  it("validates ordered named top-level sections and bullets inside every section", () => {
    const bundle = comparisonBundle();
    const sections = [
      "Between Parasitic Plants",
      "Between Fungi and Plants",
      "Between Bacteria and Plants",
      "Between Viruses and Plants",
    ];
    bundle.constraints.requirements![0] = {
      ...bundle.constraints.requirements![0]!,
      requirementId: "RQ_TOP_LEVEL_SECTION_CONTRACT",
      description: `The report must include exactly 4 top-level sections in this order: ${sections.map((section) => `[${section}]`).join(", ")}. Use a Markdown bullet list in every section.`,
      evidenceRequired: false,
      successCriteria: [
        "Render one section for each named topic.",
        "Every required top-level section contains a Markdown bullet list.",
      ],
      entityScope: sections,
    };
    bundle.constraints.requirements!.unshift({
      ...bundle.constraints.requirements![1]!,
      requirementId: "MODEL_COARSENED_SECTION_CONTRACT",
      description: "The report must include exactly 3 top-level sections in this order: [Wrong One], [Wrong Two], [Wrong Three].",
      kind: "constraint",
      evidenceRequired: false,
      successCriteria: ["Use the model's coarsened structure."],
      entityScope: [],
    });
    expect(requestedTopLevelSectionCount(bundle)).toBe(4);
    const report = (headings: string[], bulletIndexes: number[]) => [
      "# Plant HGT review",
      "",
      ...headings.flatMap((heading, index) => [
        `## ${heading}`,
        "",
        bulletIndexes.includes(index) ? `- Evidence for ${heading} [C1]` : `Evidence for ${heading} [C1].`,
        "",
      ]),
    ].join("\n");

    const wrongHeadings = [...sections];
    wrongHeadings[1] = "Fungal Transfer";
    expect(detectRenderedTopLevelSectionCountIssue(bundle, report(wrongHeadings, [0, 1, 2, 3]))).toMatchObject({
      expected: 4,
      observed: 4,
      expectedHeadings: sections,
    });
    expect(detectMissingRenderedDeliverables(bundle, report(sections, [0]))).toContainEqual(expect.objectContaining({
      reason: "missing_list",
      missingEntities: sections.slice(1),
    }));
    const numberedOnly = report(sections, []).replaceAll(/Evidence for ([^\n]+) \[C1\]\./gu, "1. Evidence for $1 [C1]");
    expect(detectMissingRenderedDeliverables(bundle, numberedOnly)).toContainEqual(expect.objectContaining({
      reason: "missing_list",
      missingEntities: sections,
    }));
    expect(detectRenderedTopLevelSectionCountIssue(bundle, report(sections, [0, 1, 2, 3]))).toBeUndefined();
    expect(detectMissingRenderedDeliverables(bundle, report(sections, [0, 1, 2, 3]))).toEqual([]);
  });

  it("rejects unsafe final organizer output and accepts a grounded completion", () => {
    const bundle = comparisonBundle();
    const original = [
      "# Energy recovery report",
      "",
      "## Comparison of micro-hydroturbines and PATs",
      "",
      "The cited comparison covers cost and efficiency [C1].",
      "",
      "## Findings",
      "",
      "Additional grounded detail keeps the report substantive [C1].",
    ].join("\n");
    const missing = detectMissingRenderedDeliverables(bundle, original);
    expect(missing).toHaveLength(1);
    expect(acceptFinalizedReport(original, "# Short\n\n| A | B |\n| --- | --- |\n| x | y |", bundle, missing)).toBe(false);
    expect(acceptFinalizedReport(
      original,
      original + "\n| Metric | Conventional | PAT |\n| --- | --- | --- |\n| Cost | [C99] | Unknown |\n",
      bundle,
      missing,
    )).toBe(false);

    const completed = original.replace(
      "The cited comparison covers cost and efficiency [C1].",
      [
        "The cited comparison covers cost and efficiency [C1].",
        "",
        "| Metric | Conventional turbine | PAT |",
        "| --- | --- | --- |",
        "| Efficiency | Not established by cited evidence | Supported comparison [C1] |",
        "| Cost | Not established by cited evidence | Supported comparison [C1] |",
      ].join("\n"),
    );
    expect(acceptFinalizedReport(original, completed, bundle, missing)).toBe(true);
  });

  it("does not let the final organizer exceed an exact main-section count", () => {
    const bundle = comparisonBundle();
    bundle.root.label = "新一代互连阻挡层材料";
    bundle.constraints.language = "zh-CN";
    bundle.constraints.rubricText = "请你将调研结果分成四部分来介绍，最后制作一个总结对比表。";
    bundle.constraints.requirements![0] = {
      ...bundle.constraints.requirements![0]!,
      description: "制作总结对比表，包含材料类别、代表性材料举例、核心优势和主要挑战。",
      successCriteria: ["总结表覆盖四类材料。"],
      metricScope: ["材料类别", "代表性材料举例", "核心优势", "主要挑战"],
    };
    const original = [
      "# 新一代互连阻挡层材料",
      "",
      "## 基于金属的阻挡层",
      "",
      "金属材料分析 [C1]。",
      "",
      "## 基于二维材料的阻挡层",
      "",
      "二维材料分析 [C1]。",
      "",
      "## 自组装分子层（SAMs）",
      "",
      "SAM 材料分析 [C1]。",
      "",
      "## 高熵合金（HEAs）",
      "",
      "HEA 材料分析 [C1]。",
    ].join("\n");
    const summaryTable = [
      "| 材料类别 | 代表性材料举例 | 核心优势 | 主要挑战 |",
      "| --- | --- | --- | --- |",
      "| 金属 | Ru [C1] | 低电阻 | CMP |",
      "| 二维材料 | 石墨烯 [C1] | 原子级厚度 | 生长温度 |",
      "| SAMs | P-SAM [C1] | 选择性 | 可靠性 |",
      "| HEAs | AlCrTaTiZrRu [C1] | 缓慢扩散 | 工艺成熟度 |",
    ].join("\n");
    const missing = detectMissingRenderedDeliverables(bundle, original);
    const extraPeerSection = `${original}\n\n## 总结对比表\n\n${summaryTable}`;
    const nestedTable = `${original}\n\n### 总结对比表\n\n${summaryTable}`;

    expect(missing).toEqual([expect.objectContaining({ reason: "missing_section" })]);
    expect(detectMissingRenderedDeliverables(bundle, extraPeerSection)).toEqual([]);
    expect(detectRenderedTopLevelSectionCountIssue(bundle, extraPeerSection)).toMatchObject({ expected: 4, observed: 5 });
    expect(detectRenderedTopLevelSectionCountIssue(bundle, `${nestedTable}\n\n## 参考文献\n\n- [C1] 来源`)).toBeUndefined();
    expect(acceptFinalizedReport(original, extraPeerSection, bundle, missing)).toBe(false);
    expect(acceptFinalizedReport(original, nestedTable, bundle, missing)).toBe(true);
    expect(acceptFinalizedReport(extraPeerSection, nestedTable, bundle, [])).toBe(true);
  });

  it("requires one non-empty rendered section for every named case entity", () => {
    const bundle = caseStudyBundle();
    const partial = [
      "# AI in software engineering",
      "",
      "## 麦肯锡",
      "Core function, scenario, and quantitative outcome [C1].",
      "",
      "## GitHub Copilot",
      "Core function, scenario, and quantitative outcome [C1].",
      "",
      "## IBM",
      "Core function, scenario, and quantitative outcome [C1].",
      "",
      "## Microsoft IntelliCode",
      "Core function, scenario, and quantitative outcome [C1].",
      "",
      "## Google DeepMind AlphaCode",
      "Core function, scenario, and quantitative outcome [C1].",
      "",
      "## 总结与分析",
      "Shared advantages, risks, and research gaps [C1].",
    ].join("\n");

    expect(detectMissingRenderedDeliverables(bundle, partial)).toEqual([expect.objectContaining({
      requirementId: "REQ_cases",
      reason: "missing_entity_sections",
      missingEntities: ["Snyk（Snyk Code）"],
    })]);

    const complete = partial.replace(
      "## 总结与分析",
      "## Snyk Code\nCore function, scenario, and quantitative outcome [C1].\n\n## 总结与分析",
    );
    expect(detectMissingRenderedDeliverables(bundle, complete)).toEqual([]);
    expect(acceptFinalizedReport(partial, complete, bundle, detectMissingRenderedDeliverables(bundle, partial))).toBe(true);

    const missingTwo = partial.replace("## IBM\nCore function, scenario, and quantitative outcome [C1].\n\n", "");
    const fixesOnlyOne = missingTwo.replace(
      "## 总结与分析",
      "## Snyk Code\nCore function, scenario, and quantitative outcome [C1].\n\n## 总结与分析",
    );
    expect(acceptFinalizedReport(missingTwo, fixesOnlyOne, bundle, detectMissingRenderedDeliverables(bundle, missingTwo))).toBe(false);
  });

  it("requires named detail sections and a summary table from one compound deliverable", () => {
    const bundle = caseStudyBundle();
    const requirement = bundle.constraints.requirements![0]!;
    requirement.description = "将六个案例分成六个部分分别说明核心功能、应用场景和量化成果，最后制作总结对比表。";
    requirement.successCriteria = ["每个案例独立介绍，且总结表完整覆盖六个案例。"];
    const sectionsOnly = [
      "# AI案例",
      ...requirement.entityScope!.flatMap((entity) => [`## ${entity}`, "完整案例正文 [C1]。", ""]),
    ].join("\n");
    const summaryTable = [
      "| 案例 | 核心功能 | 应用场景 | 量化成果 |",
      "|---|---|---|---|",
      ...requirement.entityScope!.map((entity) => `| ${entity} | 功能 | 场景 | 成果 |`),
    ].join("\n");
    const tableOnly = [
      "# AI案例",
      "## 总结对比表",
      summaryTable,
    ].join("\n");

    expect(detectMissingRenderedDeliverables(bundle, sectionsOnly)).toEqual([expect.objectContaining({
      requirementId: "REQ_cases",
      reason: "missing_table",
    })]);
    expect(detectMissingRenderedDeliverables(bundle, tableOnly)).toEqual([expect.objectContaining({
      requirementId: "REQ_cases",
      reason: "missing_entity_sections",
      missingEntities: requirement.entityScope,
    })]);

    const incompleteTable = `${sectionsOnly}\n## 总结对比表\n| 案例 | 核心功能 | 应用场景 | 量化成果 |\n|---|---|---|---|\n| 麦肯锡 | 功能 | 场景 | 成果 |`;
    expect(detectMissingRenderedDeliverables(bundle, incompleteTable)).toEqual([expect.objectContaining({
      reason: "missing_table",
      missingEntities: requirement.entityScope!.slice(1),
    })]);

    const complete = `${sectionsOnly}\n### 总结对比表\n${summaryTable}`;
    expect(requestedTopLevelSectionCount(bundle)).toBe(6);
    expect(detectMissingRenderedDeliverables(bundle, complete)).toEqual([]);
    expect(acceptFinalizedReport(sectionsOnly, complete, bundle, detectMissingRenderedDeliverables(bundle, sectionsOnly))).toBe(true);
  });

  it("requires a non-empty H3 subsection for every recovered outline item", () => {
    const bundle = caseStudyBundle();
    const requirement = bundle.constraints.requirements![0]!;
    requirement.description = "Analyze the named clinical PET applications.";
    requirement.successCriteria = ["Render one substantive subsection for every explicitly named outline item."];
    requirement.entityScope = [
      "Image Segmentation",
      "Lesion Detection and Classification",
      "Quantitative Analysis",
      "Radiotherapy Planning",
      "Dosimetry",
      "Radiomics and Radiogenomics",
    ];
    requirement.metricScope = ["objective", "main AI techniques used", "specific effects or advantages achieved"];
    const render = (entities: string[]) => [
      "# AI in clinical PET applications",
      "",
      "## Clinical PET Applications",
      "",
      ...entities.flatMap((entity) => [`### ${entity}`, "Objective, techniques, and specific advantages [C1].", ""]),
    ].join("\n");
    const partial = render(requirement.entityScope.slice(0, -1));

    expect(detectMissingRenderedDeliverables(bundle, partial)).toEqual([expect.objectContaining({
      requirementId: "REQ_cases",
      reason: "missing_entity_sections",
      missingEntities: ["Radiomics and Radiogenomics"],
    })]);
    expect(detectMissingRenderedDeliverables(bundle, render(requirement.entityScope))).toEqual([]);
  });

  it("requires named subsections to remain nested under their declared parent section", () => {
    const bundle = comparisonBundle();
    const parent = "补充性方法（Complementary Methods）";
    const children = ["游戏设计书籍", "标记语言和工具（Notations and Tools）", "分析框架（Frameworks）"];
    bundle.constraints.requirements = [{
      requirementId: "RQ_NESTED_SECTION_CONTRACT_1",
      description: `Under top-level section [${parent}], render these 3 named subsections: ${children.map((child) => `[${child}]`).join(", ")}.`,
      kind: "deliverable",
      priority: "must",
      evidenceRequired: false,
      evidenceNeeds: [],
      successCriteria: [`Every named subsection is non-empty and nested under [${parent}].`],
      entityScope: children,
      entityScopeRole: "members",
    }];
    const render = (misplaceFramework: boolean) => [
      "# 游戏设计方法论",
      "",
      "## 方法论的困境",
      "困境分析 [C1]。",
      "",
      `## ${parent}`,
      "补充方法概览 [C1]。",
      "",
      "### 游戏设计书籍",
      "书籍内容及局限 [C1]。",
      "",
      "### 标记语言和工具",
      "工具关注点及局限 [C1]。",
      "",
      ...(!misplaceFramework ? ["### 分析框架", "框架的描述性局限 [C1]。", ""] : []),
      "## 核心方法",
      "设计模式分析 [C1]。",
      "",
      ...(misplaceFramework ? ["### 分析框架", "这个标题位于错误父章节 [C1]。", ""] : []),
      "## 总结",
      "综合结论 [C1]。",
    ].join("\n");

    expect(detectMissingRenderedDeliverables(bundle, render(true))).toEqual([expect.objectContaining({
      requirementId: "RQ_NESTED_SECTION_CONTRACT_1",
      reason: "missing_entity_sections",
      missingEntities: ["分析框架（Frameworks）"],
    })]);
    expect(detectMissingRenderedDeliverables(bundle, render(false))).toEqual([]);
  });
});

function caseStudyBundle(): ReportBundle {
  const root = reportNode("R_cases", "root", "AI case studies", null, ["REQ_cases"]);
  const source = knowledge("K_cases", "AI case evidence", "Evidence for the named case studies.");
  return {
    episodeId: "EP_case_sections",
    root,
    tree: [{ node: root, children: [], evidence: [], reportlets: [], openGaps: [] }],
    globalEvidenceIndex: [citation("C1", source)],
    constraints: {
      language: "zh-CN",
      citationRequired: true,
      rubricId: "RB_cases",
      rubricText: "Create one independent section per named case.",
      requirements: [{
        requirementId: "REQ_cases",
        description: "为每个公司或产品设立一个独立章节，并分别覆盖核心功能、应用场景和量化成果。",
        kind: "deliverable",
        priority: "must",
        evidenceRequired: true,
        evidenceNeeds: ["Case-specific evidence"],
        successCriteria: ["六个案例分别独立成章。"],
        entityScope: [
          "麦肯锡（McKinsey & Company）",
          "GitHub Copilot",
          "IBM",
          "微软（Microsoft IntelliCode）",
          "Snyk（Snyk Code）",
          "谷歌（Google DeepMind AlphaCode）",
        ],
        metricScope: ["核心功能", "应用场景", "量化成果"],
      }],
    },
  };
}

function comparisonBundle(): ReportBundle {
  const root = reportNode("R_root", "root", "Energy recovery report", null);
  const deliverable = reportNode("R_table", "hypothesis", "Comparison of micro-hydroturbines and PATs", "R_root", ["REQ_table"]);
  const source = knowledge("K_related", "PAT cost and efficiency evidence", "PAT systems reduce equipment cost while conventional turbines can reach higher efficiency.");
  return {
    episodeId: "EP_report_deliverable",
    root,
    tree: [
      { node: root, children: [deliverable.nodeId], evidence: [], reportlets: [], openGaps: [] },
      { node: deliverable, children: [], evidence: [], reportlets: [], openGaps: [] },
    ],
    globalEvidenceIndex: [citation("C1", source)],
    constraints: {
      language: "en",
      citationRequired: true,
      rubricId: "RB_report_deliverable",
      rubricText: "Create the requested comparison table.",
      requirements: [{
        requirementId: "REQ_table",
        description: "Create a table comparing conventional micro-hydroturbines and PATs across efficiency and cost.",
        kind: "deliverable",
        priority: "must",
        evidenceRequired: true,
        evidenceNeeds: ["Efficiency and cost evidence for both technologies"],
        successCriteria: ["The comparison table contains efficiency and cost rows."],
      }, {
        requirementId: "REQ_language",
        description: "The final report must be written in English.",
        kind: "deliverable",
        priority: "must",
        evidenceRequired: false,
        evidenceNeeds: [],
        successCriteria: ["The rendered report is in English."],
      }],
    },
  };
}

function reportNode(nodeId: string, nodeKind: ReportNode["nodeKind"], label: string, parentNodeId: string | null, requirementIds: string[] = []): ReportNode {
  return {
    nodeId,
    nodeKind,
    label,
    parentNodeId,
    scopeNote: label,
    status: "supported",
    requirementIds,
    coverage: { supportingCount: 1, contradictingCount: 0, openGapCount: 0 },
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
  };
}

function knowledge(nodeId: string, title: string, summary: string): KnowledgeNode {
  return {
    nodeId,
    nodeType: "WebPage",
    title,
    url: `https://example.test/${nodeId}`,
    contentHash: `sha256:${nodeId}`,
    summary,
    sourceTier: "secondary",
    qualityScore: 0.8,
    retrievedByTaskId: "T_test",
    retrievedAt: "2026-07-14T00:00:00.000Z",
    metadata: {},
  };
}

function evidence(linkId: string, reportNodeId: string, knowledgeNodeId: string, claimText: string): EvidenceLink {
  return {
    linkId,
    reportNodeId,
    knowledgeNodeId,
    relation: "supports",
    claimText,
    confidence: 0.8,
    createdByTaskId: "T_test",
    createdAt: "2026-07-14T00:00:00.000Z",
  };
}

function citation(citationId: string, item: KnowledgeNode): ReportBundle["globalEvidenceIndex"][number] {
  return {
    citationId,
    knowledgeNodeId: item.nodeId,
    title: item.title,
    url: item.url,
    canonicalUrl: item.url,
    sourceTier: item.sourceTier,
    qualityScore: item.qualityScore,
    summary: item.summary,
    retrievedAt: item.retrievedAt,
  };
}
