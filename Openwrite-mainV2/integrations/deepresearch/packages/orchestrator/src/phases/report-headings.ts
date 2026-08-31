import type { ReportBundle, ResearchRequirement } from "@deepresearch/contracts";
import { countedStudyTableMinimum } from "../counted-rows.js";
import { explicitTableColumns, explicitTableCount, explicitTablePartitionLabels, explicitTopLevelSectionNames } from "../rendered-contracts.js";
import { citationIdsFromMarkdown, requirementDisposition } from "./report-bundle.js";

export interface MissingRenderedDeliverable {
  requirementId: string;
  description: string;
  headingHint?: string;
  reason: "missing_section" | "missing_table" | "insufficient_tables" | "wrong_table_columns" | "incomplete_table" | "missing_list" | "empty_section" | "missing_entity_sections";
  missingEntities?: string[];
  expectedTableCount?: number;
  observedTableCount?: number;
  expectedTableColumns?: string[];
  minimumTableRows?: number;
  observedTableRows?: number;
  duplicateEntities?: string[];
  missingPartitions?: string[];
}

export interface RenderedTopLevelSectionCountIssue {
  expected: number;
  observed: number;
  headings: string[];
  expectedHeadings?: string[];
}

/** Detect must-have deliverables in rendered Markdown without judging claim quality. */
export function detectMissingRenderedDeliverables(
  bundle: ReportBundle,
  reportMd: string,
): MissingRenderedDeliverable[] {
  const requirements = (bundle.constraints.requirements ?? []).filter((requirement) =>
    requirement.priority === "must"
    && requirement.kind === "deliverable"
    && isRenderedDeliverableRequirement(requirement)
    && requirementDisposition(bundle, requirement.requirementId) !== "omit");
  if (requirements.length === 0) return [];
  const headings = markdownHeadings(reportMd);
  return requirements.flatMap<MissingRenderedDeliverable>((requirement) => {
    const missing: MissingRenderedDeliverable[] = [];
    const degraded = ["downplay", "accept_risk"].includes(requirementDisposition(bundle, requirement.requirementId) ?? "");
    const partitionLabels = tablePartitionContractLabels(requirement);
    if (partitionLabels) {
      const issue = partitionedEntityTableRenderIssue(reportMd, requirement.entityScope ?? [], partitionLabels, degraded);
      return issue ? [{
        requirementId: requirement.requirementId,
        description: requirement.description,
        headingHint: partitionLabels[0],
        ...issue,
      }] : [];
    }
    const entitySections = requiresRenderedEntitySections(requirement);
    if (entitySections) {
      const nestedParent = nestedSectionContractParent(requirement);
      const missingEntities = nestedParent
        ? missingRenderedNestedEntitySections(reportMd, headings, nestedParent, requirement.entityScope ?? [])
        : missingRenderedEntitySections(reportMd, headings, requirement.entityScope ?? []);
      if (!degraded && missingEntities.length > 0) missing.push({
        requirementId: requirement.requirementId,
        description: requirement.description,
        headingHint: missingEntities[0],
        reason: "missing_entity_sections",
        missingEntities,
      });
    }
    const format = requestedDeliverableFormat(requirement);
    if (entitySections && format !== "other") {
      const missingTableEntities = format === "table" && !degraded
        ? missingEntitySummaryTableRows(reportMd, requirement.entityScope ?? [])
        : [];
      const missingListEntities = format === "list" && !degraded
        ? missingRenderedEntityLists(
          reportMd,
          headings,
          requirement.entityScope ?? [],
          /\bbullet(?:ed|[- ]points?)?\b/iu.test([requirement.description, ...requirement.successCriteria].join(" ")),
        )
        : [];
      const formatPresent = degraded
        ? format === "table" ? containsMarkdownTable(reportMd) : containsMarkdownList(reportMd)
        : format === "table" ? missingTableEntities.length === 0 : missingListEntities.length === 0;
      if (!formatPresent) missing.push({
        requirementId: requirement.requirementId,
        description: requirement.description,
        headingHint: deliverableHeadingHints(bundle, requirement)[0],
        reason: format === "table" ? "missing_table" : "missing_list",
        missingEntities: missingTableEntities.length > 0
          ? missingTableEntities
          : missingListEntities.length > 0 ? missingListEntities : undefined,
      });
      if (formatPresent && format === "table") {
        const tableCountIssue = explicitTableCountRenderIssue(reportMd, requirement);
        if (tableCountIssue) missing.push({
          requirementId: requirement.requirementId,
          description: requirement.description,
          headingHint: deliverableHeadingHints(bundle, requirement)[0],
          ...tableCountIssue,
        });
        const columnIssue = exactTableColumnRenderIssue(reportMd, requirement);
        if (columnIssue) missing.push({
          requirementId: requirement.requirementId,
          description: requirement.description,
          headingHint: deliverableHeadingHints(bundle, requirement)[0],
          ...columnIssue,
        });
      }
      return missing;
    }
    if (entitySections) return missing;
    const hints = deliverableHeadingHints(bundle, requirement);
    const heading = bestMatchingHeading(headings, hints);
    if (!heading) {
      return [{
        requirementId: requirement.requirementId,
        description: requirement.description,
        headingHint: hints[0],
        reason: "missing_section" as const,
      }];
    }
    const body = markdownHeadingBody(reportMd, heading);
    if (!body.trim()) {
      return [{
        requirementId: requirement.requirementId,
        description: requirement.description,
        headingHint: heading.text,
        reason: "empty_section" as const,
      }];
    }
    if (format === "table" && !containsMarkdownTable(body)) {
      return [{
        requirementId: requirement.requirementId,
        description: requirement.description,
        headingHint: heading.text,
        reason: "missing_table" as const,
      }];
    }
    if (format === "table") {
      const tableCountIssue = explicitTableCountRenderIssue(body, requirement);
      if (tableCountIssue) return [{
        requirementId: requirement.requirementId,
        description: requirement.description,
        headingHint: heading.text,
        ...tableCountIssue,
      }];
      const columnIssue = exactTableColumnRenderIssue(body, requirement);
      if (columnIssue) return [{
        requirementId: requirement.requirementId,
        description: requirement.description,
        headingHint: heading.text,
        ...columnIssue,
      }];
      const tableIssue = countedStudyTableRenderIssue(body, requirement, degraded);
      if (tableIssue) return [{
        requirementId: requirement.requirementId,
        description: requirement.description,
        headingHint: heading.text,
        ...tableIssue,
      }];
      const entityIssue = memberEntityTableRenderIssue(body, requirement, degraded);
      if (entityIssue) return [{
        requirementId: requirement.requirementId,
        description: requirement.description,
        headingHint: heading.text,
        ...entityIssue,
      }];
    }
    if (format === "list" && !containsMarkdownList(body)) {
      return [{
        requirementId: requirement.requirementId,
        description: requirement.description,
        headingHint: heading.text,
        reason: "missing_list" as const,
      }];
    }
    return [];
  });
}

export function acceptFinalizedReport(
  originalMarkdown: string,
  candidateMarkdown: string,
  bundle: ReportBundle,
  missingBefore: MissingRenderedDeliverable[],
): boolean {
  const original = originalMarkdown.trim();
  const candidate = candidateMarkdown.trim();
  if (!candidate || candidate.length < original.length * 0.7) return false;
  const allowedCitations = new Set(bundle.globalEvidenceIndex.map((item) => item.citationId));
  const candidateCitations = citationIdsFromMarkdown(candidate);
  if (candidateCitations.some((citationId) => !allowedCitations.has(citationId))) return false;
  const originalCitationCount = citationIdsFromMarkdown(original).length;
  const candidateCitationCount = candidateCitations.length;
  if (candidateCitationCount < Math.floor(originalCitationCount * 0.8)) return false;
  if (detectRenderedTopLevelSectionCountIssue(bundle, candidate)) return false;
  const missingAfter = detectMissingRenderedDeliverables(bundle, candidate);
  const hadRenderedIssue = missingBefore.length > 0 || detectRenderedTopLevelSectionCountIssue(bundle, original) !== undefined;
  return hadRenderedIssue && missingAfter.length === 0;
}

interface MarkdownHeading {
  level: number;
  text: string;
  start: number;
  end: number;
}

function markdownHeadings(markdown: string): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  const pattern = /^(#{1,6})[ \t]+(.+?)\s*$/gm;
  for (const match of markdown.matchAll(pattern)) {
    const start = match.index ?? 0;
    headings.push({ level: match[1]!.length, text: match[2]!.trim(), start, end: start + match[0].length });
  }
  return headings;
}

function markdownHeadingBody(markdown: string, heading: MarkdownHeading): string {
  const headings = markdownHeadings(markdown);
  const next = headings.find((candidate) => candidate.start > heading.start && candidate.level <= heading.level);
  return markdown.slice(heading.end, next?.start ?? markdown.length);
}

function deliverableHeadingHints(
  bundle: ReportBundle,
  requirement: NonNullable<ReportBundle["constraints"]["requirements"]>[number],
): string[] {
  const labels = requirement.evidenceRequired === false
    ? []
    : bundle.tree
        .filter((entry) => entry.node.requirementIds?.includes(requirement.requirementId))
        .map((entry) => entry.node.label.trim())
        .filter(Boolean);
  return Array.from(new Set([
    ...labels,
    requirement.description.trim(),
    ...requirement.successCriteria.map((item) => item.trim()),
  ].filter(Boolean)));
}

function bestMatchingHeading(headings: MarkdownHeading[], hints: string[]): MarkdownHeading | undefined {
  let best: { heading: MarkdownHeading; score: number } | undefined;
  for (const heading of headings) {
    if (heading.level === 1) continue;
    const score = hints.reduce((total, hint) => total + headingHintScore(heading.text, hint), 0);
    if (score > 0 && (!best || score > best.score)) best = { heading, score };
  }
  return best?.heading;
}

function headingHintScore(heading: string, hint: string): number {
  const normalizedHeading = heading.toLocaleLowerCase();
  const normalizedHint = hint.toLocaleLowerCase();
  if (normalizedHint && normalizedHeading.includes(normalizedHint)) return 4;
  const chineseHeading = normalizedHeading.replace(/[^\u4e00-\u9fff]/gu, "");
  if (chineseHeading.length >= 3 && normalizedHint.includes(chineseHeading)) return 3;
  const stopWords = new Set([
    "all", "and", "each", "every", "final", "for", "from", "has", "have", "include",
    "includes", "including", "into", "must", "provide", "provided", "report", "section",
    "that", "the", "this", "used", "using", "with",
  ]);
  const englishTerms = (normalizedHint.match(/[a-z0-9]{3,}/g) ?? []).filter((term) => !stopWords.has(term));
  const chineseTerms = normalizedHint.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  const terms = [...englishTerms, ...chineseTerms];
  return terms.filter((term) => normalizedHeading.includes(term)).length;
}

function requestedDeliverableFormat(requirement: { description: string; successCriteria: string[] }): "table" | "list" | "other" {
  const text = (requirement.description + " " + requirement.successCriteria.join(" "))
    .toLocaleLowerCase()
    // Citation markers and reference lists are validated by citation integrity,
    // not as a generic content-list contract requiring their own report section.
    .replace(/\breference\s+lists?\b|\bbibliograph(?:y|ies)(?:\s+lists?)?\b|参考文献列表|引用标记/giu, " ");
  if (/(table|matrix|tabular|comparison table|表格|对比表|比较表|矩阵)/i.test(text)) return "table";
  if (/(list|bullet|checklist|列表|清单|条目)/i.test(text)) return "list";
  return "other";
}

function isRenderedDeliverableRequirement(
  requirement: NonNullable<ReportBundle["constraints"]["requirements"]>[number],
): boolean {
  if (requiresRenderedEntitySections(requirement)) return true;
  if (requestedDeliverableFormat(requirement) !== "other") return true;
  const text = requirement.description + " " + requirement.successCriteria.join(" ");
  return /\b(chart|diagram|heading|titled section)\b|图表|示意图|标题章节/i.test(text);
}

function requiresRenderedEntitySections(
  requirement: NonNullable<ReportBundle["constraints"]["requirements"]>[number],
): boolean {
  if ((requirement.entityScope ?? []).filter((entity) => entity.trim()).length < 2) return false;
  if (nestedSectionContractParent(requirement)) return true;
  const text = [requirement.description, ...requirement.successCriteria].join(" ");
  return /(?:(?:分成|分为).{0,16}(?:部分|章节|小节)|(?:每个|每一(?:个|类|种)|逐个|分别|各(?:个|类)?).{0,18}(?:介绍|说明|分析|讨论|详述|展开)|独立.{0,8}(?:章节|小节)|案例(?:章节|研究|分析)|公司.{0,12}章节|产品.{0,12}章节|divide.{0,24}into.{0,12}(?:parts?|sections?)|for\s+each.{0,30}(?:explain|describe|analy[sz]e|discuss|section)|each\s+(?:company|product|case|entity|category|class|material).{0,24}(?:explain|describe|analy[sz]e|discuss|section)|separate\s+subsections?|separate\s+sections?|subsection\s+for\s+(?:each|every)|section\s+for\s+(?:each|every)|case\s+stud(?:y|ies)|entity\s+profiles?)/iu.test(text);
}

function nestedSectionContractParent(
  requirement: NonNullable<ReportBundle["constraints"]["requirements"]>[number],
): string | undefined {
  if (!requirement.requirementId.startsWith("RQ_NESTED_SECTION_CONTRACT_")) return undefined;
  return requirement.description.match(/^Under top-level section \[([^\]\n]{2,160})\], render\b/u)?.[1]?.trim() || undefined;
}

function missingRenderedNestedEntitySections(
  markdown: string,
  headings: MarkdownHeading[],
  parent: string,
  entities: string[],
): string[] {
  const parentHeading = headings.find((heading) => heading.level === 2 && topLevelHeadingMatches(heading.text, parent));
  if (!parentHeading) return entities;
  const nextPeer = headings.find((heading) => heading.start > parentHeading.start && heading.level <= parentHeading.level);
  const parentEnd = nextPeer?.start ?? markdown.length;
  const nestedHeadings = headings.filter((heading) => (
    heading.start > parentHeading.start
    && heading.start < parentEnd
    && heading.level > parentHeading.level
  ));
  return entities.filter((entity) => {
    const aliases = entityHeadingAliases(entity);
    const heading = nestedHeadings.find((candidate) => aliases.some((alias) => normalizeHeadingText(candidate.text).includes(alias)));
    return !heading || !markdownHeadingBody(markdown, heading).trim();
  });
}

function missingRenderedEntitySections(
  markdown: string,
  headings: MarkdownHeading[],
  entities: string[],
): string[] {
  return entities.filter((entity) => {
    const aliases = entityHeadingAliases(entity);
    const heading = headings.find((candidate) => candidate.level > 1 && aliases.some((alias) => normalizeHeadingText(candidate.text).includes(alias)));
    return !heading || !markdownHeadingBody(markdown, heading).trim();
  });
}

function missingRenderedEntityLists(
  markdown: string,
  headings: MarkdownHeading[],
  entities: string[],
  bulletsOnly: boolean,
): string[] {
  return entities.filter((entity) => {
    const aliases = entityHeadingAliases(entity);
    const heading = headings.find((candidate) => candidate.level > 1 && aliases.some((alias) => normalizeHeadingText(candidate.text).includes(alias)));
    if (!heading) return true;
    const body = markdownHeadingBody(markdown, heading);
    return bulletsOnly ? !containsMarkdownBulletList(body) : !containsMarkdownList(body);
  });
}

function entityHeadingAliases(entity: string): string[] {
  const aliases = [entity];
  for (const match of entity.matchAll(/[（(]([^（）()]+)[）)]/gu)) aliases.push(match[1] ?? "");
  const withoutParenthetical = entity.replace(/[（(][^（）()]+[）)]/gu, " ");
  aliases.push(withoutParenthetical);
  aliases.push(withoutParenthetical
    .replace(/^\s*基于/gu, "")
    .replace(/(?:的)?(?:阻挡层|材料类别|候选材料|材料|类别|技术|方案)\s*$/gu, "")
    .trim());
  return Array.from(new Set(aliases
    .flatMap((value) => value.split(/[/／]|\s+\bor\b\s+/iu))
    .map(normalizeHeadingText)
    .filter((value) => value.length >= 2)));
}

function normalizeHeadingText(value: string): string {
  return value
    .replace(/[*_`~]/gu, "")
    .replace(/[^\p{L}\p{N}.+#]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase();
}

function containsMarkdownTable(markdown: string): boolean {
  const lines = markdown.split(/\r?\n/).map((line) => line.trim());
  return lines.some((line, index) => {
    if (!/^\|.*\|$/.test(line) || index + 1 >= lines.length) return false;
    return isMarkdownTableSeparator(lines[index + 1]!);
  });
}

interface MarkdownTable {
  headers: string[];
  rows: string[][];
  context: string;
}

function exactTableColumnRenderIssue(
  markdown: string,
  requirement: NonNullable<ReportBundle["constraints"]["requirements"]>[number],
): Pick<MissingRenderedDeliverable, "reason" | "expectedTableColumns"> | undefined {
  const exactCriterion = requirement.successCriteria.find((criterion) => (
    /Markdown table headers must appear exactly in this order/iu.test(criterion)
  ));
  const expectedTableColumns = exactCriterion ? explicitTableColumns(exactCriterion) : undefined;
  if (!expectedTableColumns) return undefined;
  const expected = expectedTableColumns.map(normalizeHeadingText);
  const matched = markdownTables(markdown).some((table) => (
    table.headers.length === expected.length
    && table.headers.every((header, index) => normalizeHeadingText(header) === expected[index])
  ));
  return matched ? undefined : { reason: "wrong_table_columns", expectedTableColumns };
}

function countedStudyTableRenderIssue(
  markdown: string,
  requirement: NonNullable<ReportBundle["constraints"]["requirements"]>[number],
  allowPartial = false,
): Pick<MissingRenderedDeliverable, "reason" | "expectedTableColumns" | "minimumTableRows" | "observedTableRows"> | undefined {
  const minimumTableRows = countedStudyTableMinimum(requirement);
  if (minimumTableRows === undefined) return undefined;
  const tables = markdownTables(markdown);
  const expectedTableColumns = (requirement.metricScope ?? []).map((column) => column.trim()).filter(Boolean);
  const expectedNormalized = expectedTableColumns.map(normalizeHeadingText);
  const matching = expectedNormalized.length >= 2
    ? tables.filter((table) => (
        table.headers.length === expectedNormalized.length
        && table.headers.every((header, index) => normalizeHeadingText(header) === expectedNormalized[index])
      ))
    : tables;
  if (expectedNormalized.length >= 2 && matching.length === 0) {
    return { reason: "wrong_table_columns", expectedTableColumns, minimumTableRows, observedTableRows: 0 };
  }
  let observedTableRows = 0;
  for (const table of matching) {
    const completeRows = table.rows.filter((row) => (
      row.length === table.headers.length
      && row.every(isCompleteRenderedTableCell)
      && /\[C\d+\]/iu.test(row.join(" "))
    ));
    const distinctRows = new Set(completeRows.map((row) => row
      .map((cell) => normalizeHeadingText(cell.replace(/\[C\d+\]/giu, "")))
      .join("\u0001")));
    observedTableRows = Math.max(observedTableRows, distinctRows.size);
  }
  const requiredRows = allowPartial ? 1 : minimumTableRows;
  return observedTableRows >= requiredRows
    ? undefined
    : { reason: "incomplete_table", expectedTableColumns, minimumTableRows, observedTableRows };
}

function markdownTables(markdown: string): MarkdownTable[] {
  const lines = markdown.split(/\r?\n/).map((line) => line.trim());
  const tables: MarkdownTable[] = [];
  let previousTableEnd = 0;
  for (let index = 0; index + 1 < lines.length; index += 1) {
    if (!/^\|.*\|$/u.test(lines[index]!) || !isMarkdownTableSeparator(lines[index + 1]!)) continue;
    const rows: string[][] = [];
    let rowIndex = index + 2;
    while (rowIndex < lines.length && /^\|.*\|$/u.test(lines[rowIndex]!)) {
      rows.push(markdownTableCells(lines[rowIndex]!));
      rowIndex += 1;
    }
    tables.push({
      headers: markdownTableCells(lines[index]!),
      rows,
      context: lines.slice(previousTableEnd, index).filter(Boolean).join(" "),
    });
    previousTableEnd = rowIndex;
    index = rowIndex - 1;
  }
  return tables;
}

function tablePartitionContractLabels(requirement: ResearchRequirement): string[] | undefined {
  return requirement.requirementId.startsWith("RQ_TABLE_PARTITION_CONTRACT")
    ? explicitTablePartitionLabels(requirement.description)
    : undefined;
}

function partitionedEntityTableRenderIssue(
  markdown: string,
  entities: string[],
  partitions: string[],
  allowPartial = false,
): Pick<MissingRenderedDeliverable, "reason" | "missingEntities" | "duplicateEntities" | "missingPartitions" | "expectedTableCount" | "observedTableCount"> | undefined {
  const tables = markdownTables(markdown);
  const assignedTables = new Set<number>();
  const missingPartitions: string[] = [];
  for (const partition of partitions) {
    const aliases = entityHeadingAliases(partition);
    const index = tables.findIndex((table, tableIndex) => (
      !assignedTables.has(tableIndex)
      && aliases.some((alias) => normalizeHeadingText(table.context).includes(alias))
    ));
    if (index < 0) missingPartitions.push(partition);
    else assignedTables.add(index);
  }
  const entityCounts = new Map(entities.map((entity) => [entity, 0]));
  for (const tableIndex of assignedTables) {
    const table = tables[tableIndex]!;
    for (const entity of entities) {
      const aliases = entityHeadingAliases(entity);
      const count = table.rows.filter((row) => aliases.some((alias) => normalizeHeadingText(row[0] ?? "").includes(alias))).length;
      entityCounts.set(entity, (entityCounts.get(entity) ?? 0) + count);
    }
  }
  const missingEntities = entities.filter((entity) => (entityCounts.get(entity) ?? 0) === 0);
  const duplicateEntities = entities.filter((entity) => (entityCounts.get(entity) ?? 0) > 1);
  if (tables.length === partitions.length
    && missingPartitions.length === 0
    && (allowPartial || missingEntities.length === 0)
    && duplicateEntities.length === 0) return undefined;
  return {
    reason: "incomplete_table",
    expectedTableCount: partitions.length,
    observedTableCount: tables.length,
    missingEntities: missingEntities.length > 0 ? missingEntities : undefined,
    duplicateEntities: duplicateEntities.length > 0 ? duplicateEntities : undefined,
    missingPartitions: missingPartitions.length > 0 ? missingPartitions : undefined,
  };
}

function memberEntityTableRenderIssue(
  markdown: string,
  requirement: ResearchRequirement,
  allowPartial = false,
): Pick<MissingRenderedDeliverable, "reason" | "missingEntities"> | undefined {
  if (allowPartial) return undefined;
  if (requirement.entityScopeRole === "groups") return undefined;
  const entities = (requirement.entityScope ?? []).filter((entity) => entity.trim());
  if (entities.length < 2) return undefined;
  const tables = markdownTables(markdown);
  const missingEntities = entities.filter((entity) => {
    const aliases = entityHeadingAliases(entity);
    return !tables.some((table) => table.rows.some((row) => (
      aliases.some((alias) => normalizeHeadingText(row[0] ?? "").includes(alias))
    )));
  });
  return missingEntities.length > 0 ? { reason: "incomplete_table", missingEntities } : undefined;
}

function explicitTableCountRenderIssue(
  markdown: string,
  requirement: ResearchRequirement,
): Pick<MissingRenderedDeliverable, "reason" | "expectedTableCount" | "observedTableCount"> | undefined {
  const expectedTableCount = explicitTableCount([
    requirement.description,
    ...requirement.successCriteria,
  ].join(" "));
  if (expectedTableCount === undefined) return undefined;
  const observedTableCount = markdownTables(markdown).length;
  return observedTableCount >= expectedTableCount
    ? undefined
    : { reason: "insufficient_tables", expectedTableCount, observedTableCount };
}

function markdownTableCells(line: string): string[] {
  const body = line.trim().replace(/^\|/u, "").replace(/\|$/u, "");
  const cells: string[] = [];
  let current = "";
  let escaped = false;
  for (const char of body) {
    if (char === "|" && !escaped) {
      cells.push(current.trim().replace(/\\\|/gu, "|"));
      current = "";
      continue;
    }
    current += char;
    escaped = char === "\\" ? !escaped : false;
  }
  cells.push(current.trim().replace(/\\\|/gu, "|"));
  return cells;
}

function isCompleteRenderedTableCell(value: string): boolean {
  const normalized = normalizeHeadingText(value.replace(/\[C\d+\]/giu, ""));
  return normalized.length > 0
    && !/\b(?:unknown|not\s+(?:available|reported|stated|provided|specified|extracted)|unavailable|missing|n\s*a|could not)\b/iu.test(normalized);
}

function missingEntitySummaryTableRows(markdown: string, entities: string[]): string[] {
  const required = entities.filter((entity) => entity.trim());
  if (required.length < 2) return containsMarkdownTable(markdown) ? [] : required;
  const lines = markdown.split(/\r?\n/).map((line) => line.trim());
  let bestCovered = new Set<string>();
  for (let index = 0; index + 1 < lines.length; index += 1) {
    if (!/^\|.*\|$/u.test(lines[index]!) || !isMarkdownTableSeparator(lines[index + 1]!)) continue;
    const rows: string[] = [];
    for (let rowIndex = index + 2; rowIndex < lines.length && /^\|.*\|$/u.test(lines[rowIndex]!); rowIndex += 1) {
      rows.push(normalizeHeadingText(lines[rowIndex]!.split("|")[1] ?? ""));
    }
    const covered = new Set(required.filter((entity) => {
      const aliases = entityHeadingAliases(entity);
      return rows.some((row) => aliases.some((alias) => row.includes(alias)));
    }));
    if (covered.size > bestCovered.size) bestCovered = covered;
    if (covered.size === required.length) return [];
  }
  return required.filter((entity) => !bestCovered.has(entity));
}

function isMarkdownTableSeparator(value: string): boolean {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/u.test(value);
}

function containsMarkdownList(markdown: string): boolean {
  return /(^|\n)\s*(?:[-*+] |\d+[.)] |\[C\d+\]\s+)/i.test(markdown);
}

function containsMarkdownBulletList(markdown: string): boolean {
  return /(^|\n)\s*[-*+]\s+/u.test(markdown);
}

export function requestedTopLevelSectionCount(bundle: ReportBundle): number | undefined {
  const texts = topLevelSectionContractTexts(bundle);
  const combined = texts.join("\n\n");
  for (const text of texts) {
    const count = explicitTopLevelSectionCountFromText(text);
    if (count === undefined) continue;
    const competingSequenceCount = topLevelTaskSequenceCount(text) ?? topLevelTaskSequenceCount(combined);
    return competingSequenceCount !== undefined && competingSequenceCount > count ? competingSequenceCount : count;
  }
  return requestedTopLevelSectionNames(bundle)?.length;
}

export function requestedTopLevelSectionNames(bundle: ReportBundle): string[] | undefined {
  const texts = topLevelSectionContractTexts(bundle);
  for (const text of texts) {
    const names = explicitTopLevelSectionNames(text);
    if (names) return names;
  }
  return undefined;
}

function topLevelSectionContractTexts(bundle: ReportBundle): string[] {
  const requirements = bundle.constraints.requirements ?? [];
  const recovered = requirements.filter((requirement) => requirement.requirementId === "RQ_TOP_LEVEL_SECTION_CONTRACT");
  const others = requirements.filter((requirement) => requirement.requirementId !== "RQ_TOP_LEVEL_SECTION_CONTRACT");
  return [
    ...[...recovered, ...others].flatMap((requirement) => [requirement.description, ...requirement.successCriteria]),
    bundle.constraints.rubricText,
  ];
}

export function detectRenderedTopLevelSectionCountIssue(
  bundle: ReportBundle,
  markdown: string,
): RenderedTopLevelSectionCountIssue | undefined {
  const expectedHeadings = requestedTopLevelSectionNames(bundle);
  const expected = requestedTopLevelSectionCount(bundle) ?? expectedHeadings?.length;
  if (expected === undefined) return undefined;
  const headings = markdownHeadings(markdown)
    .filter((heading) => heading.level === 2 && !isReferenceSectionHeading(heading.text))
    .map((heading) => heading.text);
  const headingsMatch = !expectedHeadings || (
    headings.length === expectedHeadings.length
    && headings.every((heading, index) => topLevelHeadingMatches(heading, expectedHeadings[index]!))
  );
  return headings.length === expected && headingsMatch
    ? undefined
    : { expected, observed: headings.length, headings, expectedHeadings };
}

function topLevelHeadingMatches(actual: string, expected: string): boolean {
  const normalizedActual = normalizeHeadingText(actual).replace(/^\d+[.)]?\s*/u, "");
  const normalizedExpected = normalizeHeadingText(expected).replace(/^\d+[.)]?\s*/u, "");
  return normalizedActual === normalizedExpected || normalizedActual.startsWith(`${normalizedExpected} `);
}

function isReferenceSectionHeading(value: string): boolean {
  const normalized = normalizeHeadingText(value).replace(/^\d+[.)]?\s*/u, "");
  return /^(?:references|bibliography|works cited|sources|参考文献|参考资料|引用来源|来源)$/iu.test(normalized);
}

function explicitTopLevelSectionCountFromText(value: string): number | undefined {
  const englishNumber = "(?:2|3|4|5|6|7|8|9|10|11|12|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)";
  const englishPatterns = [
    new RegExp(`(?:divide|divided|organize|organized|structure|structured|separate)[^.!?\\n]{0,70}\\binto\\s+(?:exactly\\s+)?(${englishNumber})\\s+(?:main\\s+)?(?:sections?|parts?)\\b`, "igu"),
    new RegExp(`\\b(${englishNumber})\\s+(?:main\\s+)?sections?\\b[^.!?\\n]{0,50}\\beach\\s+(?:corresponding|covering)\\b`, "igu"),
    new RegExp(`(?:answer|report|response)\\s+(?:must|should|needs?\\s+to)?[^.!?\\n]{0,40}(?:contain|include|consist\\s+of)\\s+(?:exactly\\s+)?(${englishNumber})\\s+(?:main\\s+)?(?:sections?|parts?)\\b`, "igu"),
  ];
  for (const pattern of englishPatterns) {
    for (const match of value.matchAll(pattern)) {
      const prefix = value.slice(Math.max(0, (match.index ?? 0) - 24), match.index ?? 0);
      if (/(?:at\s+least|minimum(?:\s+of)?|no\s+fewer\s+than)\s*$/iu.test(prefix)) continue;
      const count = sectionCountNumber(match[1] ?? "");
      if (count !== undefined) return count;
    }
  }
  for (const match of value.matchAll(/(?:分为|分成|划分为|包含|包括)\s*([二两三四五六七八九十百\d]{1,3})\s*(?:个)?(?:主要)?(?:部分|章节|小节)/gu)) {
    const prefix = value.slice(Math.max(0, (match.index ?? 0) - 12), match.index ?? 0);
    if (/(?:至少|不少于|最少)\s*$/u.test(prefix)) continue;
    const count = sectionCountNumber(match[1] ?? "");
    if (count !== undefined) return count;
  }
  return enumeratedTopLevelSectionCount(value);
}

function topLevelTaskSequenceCount(value: string): number | undefined {
  const ordinalWords: Record<string, number> = {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6,
    seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12,
    第一: 1, 首先: 1, 第二: 2, 其次: 2, 第三: 3, 第四: 4, 第五: 5, 第六: 6,
    第七: 7, 第八: 8, 第九: 9, 第十: 10, 第十一: 11, 第十二: 12,
  };
  const actionCue = /(?:provide|create|present|analy[sz]e|explain|compare|overview|table|profile|assess|summarize|describe|discuss|review|identify|提供|创建|展示|分析|解释|比较|概述|表格|画像|评估|总结|讨论|审查|识别)/iu;
  const sequence: Array<number | "final"> = [];
  for (const rawSegment of value.split(/\r?\n(?:\s*\r?\n)*/gu)) {
    const segment = rawSegment.trim().replace(/^(?:#{1,6}|[-*+])\s+/u, "");
    const english = segment.match(/^(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|finally)\b\s*[,.:;—-]?\s*(.*)$/iu);
    const chinese = segment.match(/^(首先|其次|最后|最终|第(?:十二|十一|十|九|八|七|六|五|四|三|二|一))\s*[，,:：。；—-]?\s*(.*)$/u);
    const marker = (english?.[1] ?? chinese?.[1] ?? "").toLowerCase();
    const body = english?.[2] ?? chinese?.[2] ?? "";
    if (!marker || !actionCue.test(body)) continue;
    if (marker === "finally" || marker === "最后" || marker === "最终") sequence.push("final");
    else {
      const number = ordinalWords[marker];
      if (number !== undefined) sequence.push(number);
    }
  }
  let expected = 1;
  for (const marker of sequence) {
    if (marker === "final") return expected > 1 && expected <= 12 ? expected : undefined;
    if (marker < expected) continue;
    if (marker !== expected) return undefined;
    expected += 1;
  }
  const count = expected - 1;
  return count >= 2 && count <= 12 ? count : undefined;
}

function enumeratedTopLevelSectionCount(value: string): number | undefined {
  const leadIns = [
    /(?:answer|report|response)[^.!?\n:：]{0,80}(?:include|contain|comprise|cover|address|consist\s+of|be\s+(?:divided|organized|structured)\s+into)[^.!?\n:：]{0,40}\b(?:the\s+)?following\s+(?:(?:main|major|top-level)\s+)?(?:sections?|parts?)(?:\s+below)?\s*[:：]/igu,
    /(?:报告|回答|答复|正文)[^。！？\n:：]{0,80}(?:包含|包括|涵盖|分为|分成)[^。！？\n:：]{0,24}以下[^。！？\n:：]{0,16}(?:部分|章节|方面|内容)\s*[:：]/gu,
  ];
  for (const leadIn of leadIns) {
    for (const match of value.matchAll(leadIn)) {
      if (/(?:at\s+least|minimum(?:\s+of)?|no\s+fewer\s+than|至少|不少于|最少)/iu.test(match[0])) continue;
      const tail = value.slice((match.index ?? 0) + match[0].length);
      const count = consecutiveNumberedItemCount(tail);
      if (count !== undefined) return count;
    }
  }
  return undefined;
}

function consecutiveNumberedItemCount(value: string): number | undefined {
  const markers = value.matchAll(/(?:^|\n)[ \t]{0,1}(?:\((\d{1,2}|[一二三四五六七八九十]{1,2})\)|（(\d{1,2}|[一二三四五六七八九十]{1,2})）|(\d{1,2}|[一二三四五六七八九十]{1,2})[.)、．])(?:[ \t]+|(?=\*{1,2}))/gu);
  let expected = 1;
  let count = 0;
  for (const match of markers) {
    const itemNumber = sectionCountNumber(match[1] ?? match[2] ?? match[3] ?? "", 1);
    if (itemNumber === undefined) continue;
    if (count === 0 && itemNumber !== 1) continue;
    if (itemNumber !== expected) break;
    count += 1;
    expected += 1;
    if (count > 12) return undefined;
  }
  return count >= 2 ? count : undefined;
}

function sectionCountNumber(value: string, minimum = 2): number | undefined {
  const normalized = value.trim().toLocaleLowerCase();
  const words: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
    eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
    一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
    十一: 11, 十二: 12,
  };
  const count = words[normalized] ?? Number(normalized);
  return Number.isSafeInteger(count) && count >= minimum && count <= 12 ? count : undefined;
}
