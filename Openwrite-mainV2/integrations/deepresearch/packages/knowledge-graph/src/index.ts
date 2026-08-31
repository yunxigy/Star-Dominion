export const MODULE_NAME = "knowledge-graph";

export type { KgService } from "@deepresearch/contracts";
export { createInMemoryKgService, createFixtureKgService, BaseKgService, FixtureKgService, InMemoryKgService } from "./factory.js";
export { buildReportBundleFromState, validateEvidenceLink, validateKnowledgeNode, validateReportNode } from "./types.js";
export type { KgSnapshot } from "./types.js";
