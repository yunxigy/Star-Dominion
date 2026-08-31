import type { ReportArtifact, ReportBundle } from "@deepresearch/contracts";

export interface BaseReporterOptions {
  now?: () => string;
}

export interface ReporterSnapshot {
  version: 5;
  artifacts: Array<[string, ReportArtifact]>;
}

export interface RenderedBundle {
  markdown: string;
  citationMap: Record<string, string>;
  diagnostics: ReportArtifact["diagnostics"];
}

export function cacheKey(bundle: ReportBundle): string {
  return `${bundle.episodeId}:${bundle.root.nodeId}:${bundle.tree.length}:${bundle.globalEvidenceIndex.length}`;
}
