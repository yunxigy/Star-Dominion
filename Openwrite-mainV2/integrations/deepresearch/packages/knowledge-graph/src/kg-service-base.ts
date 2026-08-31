import {
  MockNotFoundError,
  type EvidenceLink,
  type KgService,
  type KnowledgeNode,
  type OpenGap,
  type ReportBundle,
  type Reportlet,
  type ReportNode,
} from "@deepresearch/contracts";
import {
  buildReportBundleFromState,
  validateEvidenceLink,
  validateKnowledgeNode,
  validateReportNode,
  validateReportlet,
  mergeOpenGap,
  sameOpenGap,
  type KgSnapshot,
} from "./types.js";

export type { KgSnapshot } from "./types.js";

export interface KgFactoryOptions {
  seed?: number;
  withFixture?: boolean;
}

export class InMemoryKgService implements KgService {
  protected readonly reportNodes = new Map<string, ReportNode>();
  protected readonly knowledgeNodes = new Map<string, KnowledgeNode>();
  protected readonly evidenceLinks = new Map<string, EvidenceLink>();
  protected readonly reportlets = new Map<string, Reportlet>();
  protected readonly openGaps: OpenGap[] = [];

  constructor(opts: KgFactoryOptions = {}) {
    if (opts.withFixture) this.loadFixture();
  }

  async upsertReportNode(node: ReportNode): Promise<{ created: boolean }> {
    validateReportNode(node);
    const created = !this.reportNodes.has(node.nodeId);
    this.reportNodes.set(node.nodeId, structuredClone(node));
    return { created };
  }

  async getReportNode(id: string): Promise<ReportNode | null> {
    return cloneOrNull(this.reportNodes.get(id));
  }

  async listReportNodes(): Promise<ReportNode[]> {
    return Array.from(this.reportNodes.values()).map((node) => structuredClone(node));
  }

  async listChildren(parentNodeId: string): Promise<ReportNode[]> {
    return Array.from(this.reportNodes.values())
      .filter((node) => node.parentNodeId === parentNodeId)
      .map((node) => structuredClone(node));
  }

  async updateReportNode(node: ReportNode): Promise<void> {
    if (!this.reportNodes.has(node.nodeId)) throw new MockNotFoundError("ReportNode", node.nodeId);
    validateReportNode(node);
    this.reportNodes.set(node.nodeId, structuredClone(node));
  }

  async upsertKnowledgeNode(node: KnowledgeNode): Promise<{ created: boolean; nodeId: string }> {
    validateKnowledgeNode(node);
    const created = !this.knowledgeNodes.has(node.nodeId);
    this.knowledgeNodes.set(node.nodeId, structuredClone(node));
    return { created, nodeId: node.nodeId };
  }

  async getKnowledgeNode(id: string): Promise<KnowledgeNode | null> {
    return cloneOrNull(this.knowledgeNodes.get(id));
  }

  async listKnowledgeNodes(): Promise<KnowledgeNode[]> {
    return Array.from(this.knowledgeNodes.values()).map((node) => structuredClone(node));
  }

  async upsertEvidenceLink(link: EvidenceLink): Promise<{ created: boolean; linkId: string }> {
    validateEvidenceLink(link);
    if (!this.reportNodes.has(link.reportNodeId)) throw new MockNotFoundError("ReportNode", link.reportNodeId);
    if (!this.knowledgeNodes.has(link.knowledgeNodeId)) throw new MockNotFoundError("KnowledgeNode", link.knowledgeNodeId);
    const previous = this.evidenceLinks.get(link.linkId);
    const created = !this.evidenceLinks.has(link.linkId);
    this.evidenceLinks.set(link.linkId, structuredClone(link));
    this.recomputeCoverageCascade(link.reportNodeId);
    if (previous && previous.reportNodeId !== link.reportNodeId) this.recomputeCoverageCascade(previous.reportNodeId);
    return { created, linkId: link.linkId };
  }

  async getEvidenceLink(id: string): Promise<EvidenceLink | null> {
    return cloneOrNull(this.evidenceLinks.get(id));
  }

  async listEvidenceLinks(reportNodeId?: string): Promise<EvidenceLink[]> {
    return Array.from(this.evidenceLinks.values())
      .filter((link) => !reportNodeId || link.reportNodeId === reportNodeId)
      .map((link) => structuredClone(link));
  }

  async listEvidenceLinksByKnowledgeNode(knowledgeNodeId: string): Promise<EvidenceLink[]> {
    return Array.from(this.evidenceLinks.values())
      .filter((link) => link.knowledgeNodeId === knowledgeNodeId)
      .map((link) => structuredClone(link));
  }

  async updateEvidenceLink(link: EvidenceLink): Promise<void> {
    const previous = this.evidenceLinks.get(link.linkId);
    if (!previous) throw new MockNotFoundError("EvidenceLink", link.linkId);
    validateEvidenceLink(link);
    this.evidenceLinks.set(link.linkId, structuredClone(link));
    this.recomputeCoverageCascade(link.reportNodeId);
    if (previous.reportNodeId !== link.reportNodeId) this.recomputeCoverageCascade(previous.reportNodeId);
  }

  async upsertReportlet(reportlet: Reportlet): Promise<{ created: boolean; reportletId: string }> {
    validateReportlet(reportlet);
    if (!this.reportNodes.has(reportlet.reportNodeId)) throw new MockNotFoundError("ReportNode", reportlet.reportNodeId);
    for (const evidenceLinkId of reportlet.citedEvidenceLinkIds) {
      if (!this.evidenceLinks.has(evidenceLinkId)) throw new MockNotFoundError("EvidenceLink", evidenceLinkId);
    }
    for (const knowledgeNodeId of reportlet.citedKnowledgeNodeIds) {
      if (!this.knowledgeNodes.has(knowledgeNodeId)) throw new MockNotFoundError("KnowledgeNode", knowledgeNodeId);
    }
    const created = !this.reportlets.has(reportlet.reportletId);
    this.reportlets.set(reportlet.reportletId, structuredClone(reportlet));
    return { created, reportletId: reportlet.reportletId };
  }

  async getReportlet(id: string): Promise<Reportlet | null> {
    return cloneOrNull(this.reportlets.get(id));
  }

  async listReportlets(reportNodeId?: string): Promise<Reportlet[]> {
    return Array.from(this.reportlets.values())
      .filter((reportlet) => !reportNodeId || reportlet.reportNodeId === reportNodeId)
      .map((reportlet) => structuredClone(reportlet));
  }

  async listOpenGaps(reportNodeId?: string): Promise<OpenGap[]> {
    return this.openGaps
      .filter((gap) => !reportNodeId || gap.reportNodeId === reportNodeId)
      .map((gap) => structuredClone(gap));
  }

  addOpenGap(gap: OpenGap): void {
    const index = this.openGaps.findIndex((existing) => sameOpenGap(existing, gap));
    if (index >= 0) this.openGaps[index] = structuredClone(mergeOpenGap(this.openGaps[index]!, gap));
    else this.openGaps.push(structuredClone(gap));
    if (gap.reportNodeId) this.recomputeCoverageCascade(gap.reportNodeId);
  }

  async closeOpenGaps(reportNodeId: string, _reason?: string): Promise<number> {
    let closed = 0;
    for (let i = 0; i < this.openGaps.length; i++) {
      const gap = this.openGaps[i]!;
      if (gap.reportNodeId !== reportNodeId || gap.status === "closed") continue;
      this.openGaps[i] = { ...gap, status: "closed" };
      closed++;
    }
    if (closed > 0) this.recomputeCoverageCascade(reportNodeId);
    return closed;
  }

  async acknowledgeOpenGaps(matches: Array<{ reportNodeId?: string; description: string; reason: string }>): Promise<number> {
    let acknowledged = 0;
    const touched = new Set<string>();
    for (let i = 0; i < this.openGaps.length; i++) {
      const gap = this.openGaps[i]!;
      if (gap.status === "closed" || gap.status === "acknowledged") continue;
      const match = matches.find((item) => gapMatches(gap, item));
      if (!match) continue;
      this.openGaps[i] = { ...gap, status: "acknowledged" };
      if (gap.reportNodeId) touched.add(gap.reportNodeId);
      acknowledged++;
    }
    for (const reportNodeId of touched) this.recomputeCoverageCascade(reportNodeId);
    return acknowledged;
  }

  async closeOpenGapsMatching(matches: Array<{ reportNodeId?: string; description: string; reason: string }>): Promise<number> {
    let closed = 0;
    const touched = new Set<string>();
    for (let i = 0; i < this.openGaps.length; i++) {
      const gap = this.openGaps[i]!;
      if (gap.status === "closed" || !matches.some((item) => gapMatches(gap, item))) continue;
      this.openGaps[i] = { ...gap, status: "closed" };
      if (gap.reportNodeId) touched.add(gap.reportNodeId);
      closed++;
    }
    for (const reportNodeId of touched) this.recomputeCoverageCascade(reportNodeId);
    return closed;
  }

  async buildReportBundle(episodeId: string, rootNodeId: string, opts: ReportBundle["constraints"]): Promise<ReportBundle> {
    return buildReportBundleFromState({
      episodeId,
      rootNodeId,
      reportNodes: await this.listReportNodes(),
      knowledgeNodes: await this.listKnowledgeNodes(),
      evidenceLinks: await this.listEvidenceLinks(),
      openGaps: await this.listOpenGaps(),
      reportlets: await this.listReportlets(),
      constraints: opts,
    });
  }

  toJSON(): KgSnapshot {
    return {
      version: 5,
      reportNodes: Array.from(this.reportNodes.values()).map((node) => structuredClone(node)),
      knowledgeNodes: Array.from(this.knowledgeNodes.values()).map((node) => structuredClone(node)),
      evidenceLinks: Array.from(this.evidenceLinks.values()).map((link) => structuredClone(link)),
      openGaps: this.openGaps.map((gap) => structuredClone(gap)),
      reportlets: Array.from(this.reportlets.values()).map((reportlet) => structuredClone(reportlet)),
    };
  }

  serialize(): string {
    return JSON.stringify(this.toJSON());
  }

  restore(snapshot: KgSnapshot): void {
    for (const node of snapshot.reportNodes) validateReportNode(node);
    for (const node of snapshot.knowledgeNodes) validateKnowledgeNode(node);
    for (const link of snapshot.evidenceLinks) validateEvidenceLink(link);
    for (const reportlet of snapshot.reportlets ?? []) validateReportlet(reportlet);
    this.reportNodes.clear();
    this.knowledgeNodes.clear();
    this.evidenceLinks.clear();
    this.reportlets.clear();
    this.openGaps.length = 0;
    for (const node of snapshot.reportNodes) this.reportNodes.set(node.nodeId, structuredClone(node));
    for (const node of snapshot.knowledgeNodes) this.knowledgeNodes.set(node.nodeId, structuredClone(node));
    for (const link of snapshot.evidenceLinks) this.evidenceLinks.set(link.linkId, structuredClone(link));
    for (const reportlet of snapshot.reportlets ?? []) this.reportlets.set(reportlet.reportletId, structuredClone(reportlet));
    for (const gap of snapshot.openGaps) this.openGaps.push(structuredClone(gap));
  }

  restoreFromString(value: string): void {
    this.restore(JSON.parse(value) as KgSnapshot);
  }

  private recomputeCoverageCascade(reportNodeId: string): void {
    for (const nodeId of this.nodeAndAncestorIds(reportNodeId)) this.recomputeCoverage(nodeId);
  }

  private nodeAndAncestorIds(reportNodeId: string): string[] {
    const ids: string[] = [];
    let cursor: string | null | undefined = reportNodeId;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      ids.push(cursor);
      cursor = this.reportNodes.get(cursor)?.parentNodeId;
    }
    return ids;
  }

  private subtreeIds(reportNodeId: string): Set<string> {
    const ids = new Set<string>([reportNodeId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of this.reportNodes.values()) {
        if (node.parentNodeId && ids.has(node.parentNodeId) && !ids.has(node.nodeId)) {
          ids.add(node.nodeId);
          changed = true;
        }
      }
    }
    return ids;
  }

  private recomputeCoverage(reportNodeId: string): void {
    const node = this.reportNodes.get(reportNodeId);
    if (!node) return;
    const subtree = this.subtreeIds(reportNodeId);
    const links = Array.from(this.evidenceLinks.values()).filter((link) => subtree.has(link.reportNodeId));
    node.coverage = {
      supportingCount: links.filter((link) => link.relation === "supports").length,
      contradictingCount: links.filter((link) => link.relation === "contradicts").length,
      openGapCount: this.openGaps.filter((gap) => gap.reportNodeId && subtree.has(gap.reportNodeId) && isBlockingGap(gap)).length,
    };
    node.updatedAt = new Date().toISOString();
    this.reportNodes.set(reportNodeId, node);
  }

  private loadFixture(): void {
    const iso = "2026-07-01T00:00:00.000Z";
    const root: ReportNode = {
      nodeId: "R_root",
      nodeKind: "root",
      label: "Fixture report",
      parentNodeId: null,
      scopeNote: "Fixture root",
      status: "planned",
      coverage: { supportingCount: 0, contradictingCount: 0, openGapCount: 0 },
      createdAt: iso,
      updatedAt: iso,
    };
    const aspect: ReportNode = {
      nodeId: "R_aspect_1",
      nodeKind: "aspect",
      label: "Evidence aspect",
      parentNodeId: "R_root",
      scopeNote: "Fixture aspect",
      status: "planned",
      coverage: { supportingCount: 0, contradictingCount: 0, openGapCount: 0 },
      createdAt: iso,
      updatedAt: iso,
    };
    const hypothesis: ReportNode = {
      nodeId: "R_hyp_1",
      nodeKind: "hypothesis",
      label: "Fixture hypothesis",
      parentNodeId: "R_aspect_1",
      scopeNote: "Fixture hypothesis",
      status: "planned",
      hypothesis: {
        statement: "Fixture claim can be supported.",
        researchBrief: "Find fixture evidence.",
        evidenceGuidance: "Use primary sources.",
      },
      coverage: { supportingCount: 0, contradictingCount: 0, openGapCount: 0 },
      createdAt: iso,
      updatedAt: iso,
    };
    const knowledge: KnowledgeNode = {
      nodeId: "K_fixture_1",
      nodeType: "WebPage",
      title: "Fixture source",
      url: "https://example.test/source",
      contentHash: "sha256:fixture",
      summary: "Fixture evidence summary.",
      sourceTier: "primary",
      qualityScore: 0.8,
      retrievedByTaskId: "T_fixture",
      retrievedAt: iso,
      metadata: { publisher: "Example" },
    };
    this.reportNodes.set(root.nodeId, root);
    this.reportNodes.set(aspect.nodeId, aspect);
    this.reportNodes.set(hypothesis.nodeId, hypothesis);
    this.knowledgeNodes.set(knowledge.nodeId, knowledge);
  }
}

export class FixtureKgService extends InMemoryKgService {
  constructor(opts: KgFactoryOptions = {}) {
    super({ ...opts, withFixture: true });
  }
}

export class BaseKgService extends InMemoryKgService {}

function cloneOrNull<T>(value: T | undefined): T | null {
  return value ? structuredClone(value) : null;
}

function isBlockingGap(gap: OpenGap): boolean {
  return gap.status === "open" || (gap.status === "acknowledged" && gap.impact === "high");
}

function gapMatches(gap: OpenGap, match: { reportNodeId?: string; description: string }): boolean {
  if (match.reportNodeId && gap.reportNodeId !== match.reportNodeId) return false;
  return gap.description === match.description || gap.description.includes(match.description) || match.description.includes(gap.description);
}
