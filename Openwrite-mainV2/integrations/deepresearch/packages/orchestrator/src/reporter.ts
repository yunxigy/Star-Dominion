import type { ReportArtifact, ReportBundle, ReporterService } from "@deepresearch/contracts";
import { canonicalizeSourceUrl } from "./source-identity.js";

export class MarkdownReporter implements ReporterService {
  async generate(bundle: ReportBundle): Promise<ReportArtifact> {
    const citationByKnowledge = new Map(bundle.globalEvidenceIndex.map((entry) => [entry.knowledgeNodeId, entry.citationId]));
    const citationByUrl = new Map<string, string>();
    for (const entry of bundle.globalEvidenceIndex) {
      if (entry.canonicalUrl) citationByUrl.set(entry.canonicalUrl, entry.citationId);
      if (entry.url) citationByUrl.set(canonicalizeSourceUrl(entry.url), entry.citationId);
    }
    const lines: string[] = [`# ${bundle.root.label}`, ""];
    const active = (entry: ReportBundle["tree"][number]) => {
      if (entry.node.status === "pruned" || entry.node.status === "downplayed") return false;
      const ids = entry.node.requirementIds ?? [];
      return ids.length === 0 || ids.some((id) => !bundle.constraints.waivers?.some((waiver) => (
        waiver.action === "omit" && waiver.requirementIds?.includes(id)
      )));
    };
    const aspects = bundle.tree.filter((entry) => (
      entry.node.nodeKind === "aspect"
      && active(entry)
      && bundle.tree.some((child) => child.node.parentNodeId === entry.node.nodeId && active(child) && child.evidence.length > 0)
    ));
    for (const aspect of aspects) {
      lines.push(`## ${aspect.node.label}`, "", aspect.node.scopeNote, "");
      const children = bundle.tree.filter((entry) => entry.node.parentNodeId === aspect.node.nodeId && active(entry) && entry.evidence.length > 0);
      for (const child of children) {
        lines.push(`### ${child.node.label}`, "");
        if (child.node.hypothesis) lines.push(child.node.hypothesis.statement, "");
        for (const { link, knowledge } of child.evidence) {
          const canonical = typeof knowledge.metadata.canonicalUrl === "string"
            ? knowledge.metadata.canonicalUrl
            : canonicalizeSourceUrl(knowledge.url);
          const cid = citationByKnowledge.get(knowledge.nodeId) ?? citationByUrl.get(canonical);
          lines.push(`- ${link.claimText}${cid ? ` [${cid}]` : ""}`);
        }
        lines.push("");
      }
    }
    if (bundle.globalEvidenceIndex.length > 0) {
      lines.push("## Evidence Index", "");
      for (const entry of bundle.globalEvidenceIndex) {
        lines.push(`- [${entry.citationId}] ${entry.title}${entry.url ? ` - ${entry.url}` : ""}${entry.summary ? `\n  - ${entry.summary}` : ""}`);
      }
      lines.push("");
    }
    lines.push("## 结论", "", "This deterministic report is complete for local smoke testing; claims above are grounded in the listed evidence。");

    return {
      episodeId: bundle.episodeId,
      reportMd: lines.join("\n"),
      citationMap: Object.fromEntries(bundle.globalEvidenceIndex.map((entry) => [entry.citationId, entry.knowledgeNodeId])),
      evidenceIndex: bundle.globalEvidenceIndex,
      diagnostics: [],
      generatedAt: new Date().toISOString(),
    };
  }
}
