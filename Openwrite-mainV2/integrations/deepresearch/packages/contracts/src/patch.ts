export type StructurePatch =
  | {
      op: "add_aspect_node";
      parentNodeId: string;
      newNodeId?: string;
      label: string;
      scopeNote: string;
    }
  | {
      op: "add_hypothesis_node";
      parentNodeId: string;
      newNodeId?: string;
      statement: string;
      researchBrief: string;
      evidenceGuidance: string;
    }
  | {
      op: "rename_report_node";
      reportNodeId: string;
      label: string;
      scopeNote?: string;
    }
  | {
      op: "move_report_node";
      reportNodeId: string;
      fromParentId: string;
      toParentId: string;
    }
  | {
      op: "merge_report_nodes";
      sourceNodeId: string;
      targetNodeId: string;
    }
  | {
      op: "move_evidence_link";
      linkId: string;
      fromReportNodeId: string;
      toReportNodeId: string;
      reason?: string;
    }
  | {
      op: "retag_knowledge_node";
      knowledgeNodeId: string;
      metadataPatch: Record<string, unknown>;
    }
  | {
      op: "discard_knowledge_node";
      knowledgeNodeId: string;
      reason: string;
    }
  | {
      op: "downplay_hypothesis";
      reportNodeId: string;
      writePolicy: string;
      parentNodeStatusAfterPatch?: string;
    };

export interface StructurePatchSuggestion {
  patch: StructurePatch;
  rationale: string;
  confidence: number;
}

export type StructurePatchRisk = "safe" | "risky" | "dangerous";

export interface StructurePatchCritique {
  patchIndex: number;
  risk: StructurePatchRisk;
  concerns: string[];
  suggestedAction: "apply" | "reject" | "redispatch";
  reason: string;
}

export interface StructurePatchDecision {
  patchIndex: number;
  decision: "apply" | "reject" | "redispatch";
  finalPatch?: StructurePatch;
  rationale: string;
}
