import type { ReportArtifact, ReportBundle, ReporterService } from "@deepresearch/contracts";
import { cacheKey, type BaseReporterOptions, type RenderedBundle, type ReporterSnapshot } from "./types.js";

export class BaseReporterService implements ReporterService {
  protected readonly artifacts = new Map<string, ReportArtifact>();
  protected readonly now: () => string;

  constructor(opts: BaseReporterOptions = {}) {
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  async generate(bundle: ReportBundle): Promise<ReportArtifact> {
    const key = cacheKey(bundle);
    const cached = this.artifacts.get(key);
    if (cached) return cached;

    const rendered = renderBundle(bundle);
    const artifact: ReportArtifact = {
      episodeId: bundle.episodeId,
      reportMd: rendered.markdown,
      citationMap: rendered.citationMap,
      evidenceIndex: bundle.globalEvidenceIndex,
      diagnostics: rendered.diagnostics,
      generatedAt: this.now(),
    };
    this.artifacts.set(key, artifact);
    return artifact;
  }

  serialize(): string {
    const snapshot: ReporterSnapshot = {
      version: 5,
      artifacts: [...this.artifacts.entries()],
    };
    return JSON.stringify(snapshot, null, 2);
  }

  restoreFromString(json: string): void {
    const snapshot = JSON.parse(json) as ReporterSnapshot;
    if (snapshot.version !== 5) {
      throw new Error(`Unsupported reporter snapshot version: ${String(snapshot.version)}`);
    }
    this.artifacts.clear();
    for (const [key, artifact] of snapshot.artifacts) {
      this.artifacts.set(key, artifact);
    }
  }
}

export function renderBundle(bundle: ReportBundle): RenderedBundle {
  const citationMap: Record<string, string> = {};
  for (const item of bundle.globalEvidenceIndex) {
    citationMap[item.citationId] = item.knowledgeNodeId;
  }

  const diagnostics: ReportArtifact["diagnostics"] = [];
  if (bundle.globalEvidenceIndex.length === 0 && bundle.constraints.citationRequired) {
    diagnostics.push({
      code: "no_evidence",
      severity: "warning",
      message: "Citation-required report has no evidence index.",
    });
  }

  const lines: string[] = [
    `# ${bundle.root.label}`,
    "",
    bundle.root.scopeNote,
    "",
  ];

  for (const entry of bundle.tree) {
    if (entry.node.nodeId === bundle.root.nodeId) continue;
    const level = entry.node.nodeKind === "hypothesis" ? "###" : "##";
    lines.push(`${level} ${entry.node.label}`, "", entry.node.scopeNote, "");
    if (entry.node.hypothesis) {
      lines.push(`Hypothesis: ${entry.node.hypothesis.statement}`, "");
    }
    if (entry.evidence.length > 0) {
      for (const item of entry.evidence) {
        const citation = findCitationId(bundle, item.knowledge.nodeId);
        const suffix = citation ? ` [${citation}]` : "";
        lines.push(`- ${item.link.claimText}${suffix}`);
      }
      lines.push("");
    }
    if (entry.openGaps.length > 0) {
      diagnostics.push({
        code: "open_gaps",
        severity: "warning",
        message: `${entry.node.nodeId} has ${entry.openGaps.length} open gap(s).`,
      });
    }
  }

  if (bundle.globalEvidenceIndex.length > 0) {
    lines.push("## Evidence Index", "");
    for (const item of bundle.globalEvidenceIndex) {
      const url = item.url ? ` - ${item.url}` : "";
      lines.push(`- [${item.citationId}] ${item.title}${url}`);
    }
    lines.push("");
  }

  return {
    markdown: lines.join("\n").trimEnd() + "\n",
    citationMap,
    diagnostics,
  };
}

function findCitationId(bundle: ReportBundle, knowledgeNodeId: string): string | undefined {
  return bundle.globalEvidenceIndex.find((item) => item.knowledgeNodeId === knowledgeNodeId)?.citationId;
}
