import type { ReportBundle } from "./report.js";
import type { RuntimeLlmConfig } from "./context.js";

export interface ReportArtifact {
  episodeId: string;
  reportMd: string;
  citationMap: Record<string, string>;
  evidenceIndex: ReportBundle["globalEvidenceIndex"];
  diagnostics: Array<{
    code: string;
    severity: "warning" | "error";
    message: string;
  }>;
  generatedAt: string;
}

export interface ReporterService {
  generate(bundle: ReportBundle, opts?: {
    llm?: RuntimeLlmConfig;
    maxContextTokens?: number;
  }): Promise<ReportArtifact>;
}
