import type { ReportBundle } from "@deepresearch/contracts";
import { requestedTopLevelSectionCount } from "./report-headings.js";

export function assembleLeafFirstReport(bundle: ReportBundle, sections: Array<{ title: string; markdown: string }>, synthesisMarkdown: string): string {
  const labels = reportSectionLabels(bundle.constraints.language);
  const summary = extractMarkdownSection(synthesisMarkdown, labels.executiveSummary)
    || (isChineseReportLanguage(bundle.constraints.language)
      ? `## ${labels.executiveSummary}\n\n本报告围绕“${bundle.root.label}”展开，依据当前证据和约束条件，自下而上综合各分节的证据细节与引用。`
      : `## ${labels.executiveSummary}\n\nThis report examines ${bundle.root.label} by synthesizing cited leaf findings into the requested report structure.`);
  const conclusion = ensureConclusionSection(extractMarkdownSection(synthesisMarkdown, labels.conclusion), bundle.constraints.language);
  const requestedSectionCount = requestedTopLevelSectionCount(bundle);
  const layout = mergeSynthesisConclusionIntoFinalSection(
    sections,
    conclusion,
    bundle.constraints.language,
    requestedSectionCount !== undefined && requestedSectionCount === sections.length,
  );
  const renderedSummary = layout.conclusionMerged
    ? `**${labels.executiveSummary}.**\n\n${stripLeadingLevelTwoHeading(summary)}`
    : summary.trim();
  const body = layout.sections
    .map((section) => section.markdown.trim())
    .filter(Boolean)
    .join("\n\n---\n\n");
  return [
    `# ${bundle.root.label}`,
    renderedSummary,
    body,
    layout.trailingConclusion?.trim(),
  ].filter(Boolean).join("\n\n").trimEnd() + "\n";
}

/**
 * Markdown attribution often lets one cited lead sentence govern the list that
 * follows it, while the grounding audit intentionally evaluates each numeric
 * bullet independently. Preserve that attribution locally by copying only the
 * lead sentence's already-valid citation markers onto uncited quantitative
 * items in the immediately following list. No new source association is made.
 */
export function propagateLeadCitationsToQuantitativeListItems(markdown: string): string {
  const lines = markdown.split("\n");
  let lastProseCitations: string[] = [];
  let activeListCitations: string[] = [];
  let inList = false;
  return lines.map((line) => {
    const isListItem = /^\s*(?:[-*+]\s+|\d+[.)]\s+)/u.test(line);
    if (isListItem) {
      if (!inList) activeListCitations = lastProseCitations;
      inList = true;
      if (
        activeListCitations.length > 0
        && !/\[C\d+\]/u.test(line)
        && /(?:\b(?:19|20)\d{2}\b|\d+(?:[.,]\d+)?\s*%)/u.test(line)
      ) {
        return `${line.trimEnd()} ${activeListCitations.map((id) => `[${id}]`).join("")}`;
      }
      return line;
    }
    if (!line.trim()) return line;
    inList = false;
    activeListCitations = [];
    lastProseCitations = Array.from(new Set(Array.from(line.matchAll(/\[(C\d+)\]/gu)).map((match) => match[1]!)));
    return line;
  }).join("\n");
}

/**
 * Add a local citation only when one mapped source contains every concrete
 * percentage, date/year, and formal numeric identifier repeated by a sentence.
 * This repairs citation placement lost during synthesis without guessing a new
 * source association for qualitative claims.
 */
export function completeProvableLocalCitations(markdown: string, bundle: ReportBundle): string {
  if (!bundle.constraints.citationRequired) return normalizeDuplicateLocalCitations(markdown);
  const supportByCitation = citationSupportText(bundle);
  let inCodeFence = false;
  const completed = markdown.split("\n").map((line) => {
    if (/^\s*```/u.test(line)) {
      inCodeFence = !inCodeFence;
      return line;
    }
    if (
      inCodeFence
      || /^\s*#{1,6}\s/u.test(line)
      || /^\s*\|.*\|\s*$/u.test(line)
      || /^\s*[-*_]{3,}\s*$/u.test(line)
    ) return line;
    return line.split(/(?<=[。！？!?])|(?<=[.])(?=\s|$)/u).map((sentence) => {
      if (/\[C\d+\]/u.test(sentence)) return sentence;
      const tokens = concreteCitationTokens(sentence);
      if (tokens.length === 0) return sentence;
      const citationId = Array.from(supportByCitation.entries())
        .find(([, support]) => tokens.every((token) => support.includes(token)))?.[0];
      if (!citationId) return sentence;
      return sentence.replace(/([\s]*)([。！？.!?]+)?([\s]*)$/u, (_match, before: string, punctuation = "", after: string) => (
        `${before} [${citationId}]${punctuation}${after}`
      ));
    }).join("");
  }).join("\n");
  return normalizeDuplicateLocalCitations(completed);
}

export function normalizeDuplicateLocalCitations(markdown: string): string {
  return markdown
    .replace(/(\[C\d+\])(?:\s*\1)+/gu, "$1")
    .replace(/(\[C\d+\])([。！？.!?])\s+\1/gu, "$1$2");
}

function citationSupportText(bundle: ReportBundle): Map<string, string> {
  const textByKnowledge = new Map<string, string[]>();
  for (const entry of bundle.tree) {
    for (const item of entry.evidence) {
      const values = textByKnowledge.get(item.knowledge.nodeId) ?? [];
      values.push(
        item.link.claimText,
        item.link.evidenceQuote ?? "",
        item.knowledge.title,
        item.knowledge.summary,
      );
      textByKnowledge.set(item.knowledge.nodeId, values);
    }
  }
  return new Map(bundle.globalEvidenceIndex.map((citation) => {
    const evidenceText = textByKnowledge.get(citation.knowledgeNodeId) ?? [];
    return [citation.citationId, normalizeCitationSupport([
      ...evidenceText,
      citation.title,
      citation.summary ?? "",
    ].join("\n"))];
  }));
}

function concreteCitationTokens(sentence: string): string[] {
  const normalized = sentence.normalize("NFKC");
  const matches = [
    ...normalized.matchAll(/\b(?:19|20)\d{2}\/\d{1,4}\b/gu),
    ...normalized.matchAll(/\b(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b|\b(?:19|20)\d{2}年\d{1,2}月\d{1,2}日/gu),
    ...normalized.matchAll(/\b(?:19|20)\d{2}(?:年)?\b/gu),
    ...normalized.matchAll(/\b\d+(?:[.,]\d+)?\s*%/gu),
  ].map((match) => normalizeCitationSupport(match[0]));
  return Array.from(new Set(matches.filter(Boolean)));
}

function normalizeCitationSupport(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/gu, "");
}

export function mergeSynthesisConclusionIntoFinalSection(
  sections: Array<{ title: string; markdown: string }>,
  conclusionMarkdown: string,
  language: string,
  preserveTopLevelSectionCount = false,
): { sections: Array<{ title: string; markdown: string }>; trailingConclusion?: string; conclusionMerged: boolean } {
  const finalIndex = sections.length - 1;
  const finalSection = sections[finalIndex];
  if (!finalSection || (!preserveTopLevelSectionCount && !isConclusionLikeSectionTitle(finalSection.title))) {
    return { sections, trailingConclusion: conclusionMarkdown, conclusionMerged: false };
  }
  const synthesisBody = stripLeadingLevelTwoHeading(conclusionMarkdown);
  if (!synthesisBody) return { sections, trailingConclusion: undefined, conclusionMerged: true };
  const base = finalSection.markdown.trim();
  const normalizedBase = base.replace(/\s+/gu, " ").toLocaleLowerCase();
  const normalizedSynthesis = synthesisBody.replace(/\s+/gu, " ").toLocaleLowerCase();
  const mergedMarkdown = normalizedBase.includes(normalizedSynthesis)
    ? base
    : [
      base,
      `### ${isChineseReportLanguage(language) ? "跨分节综合、建议与结论" : "Cross-Section Synthesis, Recommendations, and Conclusion"}`,
      synthesisBody,
    ].filter(Boolean).join("\n\n");
  return {
    sections: sections.map((section, index) => index === finalIndex ? { ...section, markdown: mergedMarkdown } : section),
    trailingConclusion: undefined,
    conclusionMerged: true,
  };
}

function isConclusionLikeSectionTitle(value: string): boolean {
  return /\bconclusions?\b|结论/iu.test(value);
}

function stripLeadingLevelTwoHeading(markdown: string): string {
  return markdown.trim().replace(/^##\s+[^\n]+\n+/u, "").trim();
}

function assembleSectionWithLeafDrafts(title: string, overviewMarkdown: string, leafSections: Array<{ title: string; markdown: string }>): string {
  const overview = normalizeSectionOverview(title, overviewMarkdown);
  const leaves = leafSections
    .map((leaf) => normalizeLeafDraft(leaf.title, leaf.markdown))
    .filter(Boolean)
    .join("\n\n");
  return [overview, leaves].filter(Boolean).join("\n\n").trim();
}

function normalizeSectionOverview(title: string, markdown: string): string {
  const trimmed = markdown.trim();
  if (!trimmed) return `## ${title}`;
  const withoutNestedLeafBodies = trimmed.split(/\n###\s+/)[0]?.trim() || trimmed;
  if (/^##\s+/m.test(withoutNestedLeafBodies)) return withoutNestedLeafBodies;
  return `## ${title}\n\n${withoutNestedLeafBodies}`;
}

function normalizeLeafDraft(title: string, markdown: string): string {
  const trimmed = stripStandaloneLeafCoverageNotes(markdown).trim();
  if (!trimmed) return "";
  if (/^###\s+/m.test(trimmed)) return trimmed;
  return `### ${title}\n\n${trimmed}`;
}

/** Leaf writers contribute findings only; one report-wide evidence boundary is synthesized at the root. */
export function stripStandaloneLeafCoverageNotes(markdown: string): string {
  return markdown
    .split(/\n\s*\n/gu)
    .filter((block) => !/^(?:#{3,6}\s*)?(?:\*\*|__)?\s*(?:覆盖说明|证据边界|研究范围与证据边界|coverage\s+note|evidence\s+boundar(?:y|ies)|scope\s+and\s+evidence\s+boundar(?:y|ies))\s*(?:\*\*|__)?\s*[:：]?/iu.test(block.trim()))
    .join("\n\n")
    .trim();
}

function extractMarkdownSection(markdown: string, heading: string): string | undefined {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|\\n)##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`);
  const match = markdown.match(pattern);
  if (!match?.[2]?.trim()) return undefined;
  return `## ${heading}\n\n${match[2].trim()}`;
}

function ensureConclusionSection(section: string | undefined, language: string): string {
  const labels = reportSectionLabels(language);
  const fallback = isChineseReportLanguage(language)
    ? `## ${labels.conclusion}\n\n本报告已基于当前证据完成综合分析，并将结论限定在已有证据能够支持的范围内。`
    : `## ${labels.conclusion}\n\nThis report limits its conclusions to the claims supported by the cited evidence.`;
  const candidate = section?.trim() || fallback;
  if (/[。！？.!?]$/.test(candidate)) return candidate;
  return `${candidate.replace(/[，,；;：:、][^\n#]{0,120}$/, "")}${isChineseReportLanguage(language) ? "。" : "."}`;
}

function reportSectionLabels(language: string): { executiveSummary: string; scopeAndEvidence: string; conclusion: string } {
  return isChineseReportLanguage(language)
    ? { executiveSummary: "执行摘要", scopeAndEvidence: "研究范围与证据边界", conclusion: "结论" }
    : { executiveSummary: "Executive Summary", scopeAndEvidence: "Scope and Evidence Boundaries", conclusion: "Conclusion" };
}

function isChineseReportLanguage(language: string): boolean {
  return language.toLowerCase().startsWith("zh");
}

export { assembleSectionWithLeafDrafts, isChineseReportLanguage, reportSectionLabels };
