import Database from "better-sqlite3";
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
  mergeOpenGap,
  sameOpenGap,
  validateReportNode,
  validateReportlet,
} from "../types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS report_nodes (
  node_id TEXT PRIMARY KEY,
  parent_node_id TEXT,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_report_nodes_parent ON report_nodes(parent_node_id);

CREATE TABLE IF NOT EXISTS knowledge_nodes (
  node_id TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  node_type TEXT NOT NULL,
  source_tier TEXT NOT NULL,
  payload TEXT NOT NULL,
  retrieved_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_type ON knowledge_nodes(node_type);
CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_hash ON knowledge_nodes(content_hash);

CREATE TABLE IF NOT EXISTS evidence_links (
  link_id TEXT PRIMARY KEY,
  report_node_id TEXT NOT NULL,
  knowledge_node_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_links_report ON evidence_links(report_node_id);
CREATE INDEX IF NOT EXISTS idx_evidence_links_knowledge ON evidence_links(knowledge_node_id);

CREATE TABLE IF NOT EXISTS reportlets (
  reportlet_id TEXT PRIMARY KEY,
  report_node_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reportlets_report ON reportlets(report_node_id);
CREATE INDEX IF NOT EXISTS idx_reportlets_task ON reportlets(task_id);

CREATE TABLE IF NOT EXISTS open_gaps (
  gap_id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_node_id TEXT,
  payload TEXT NOT NULL
);
`;

export interface SqliteKgOptions {
  dbPath?: string;
}

export class SqliteKgService implements KgService {
  private readonly db: Database.Database;

  constructor(opts: SqliteKgOptions = {}) {
    this.db = new Database(opts.dbPath ?? ":memory:");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  async upsertReportNode(node: ReportNode): Promise<{ created: boolean }> {
    validateReportNode(node);
    const existed = this.db.prepare("SELECT 1 FROM report_nodes WHERE node_id = ?").get(node.nodeId);
    this.db.prepare(
      `INSERT OR REPLACE INTO report_nodes(node_id, parent_node_id, payload, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(node.nodeId, node.parentNodeId, JSON.stringify(node), node.createdAt, node.updatedAt);
    return { created: !existed };
  }

  async getReportNode(id: string): Promise<ReportNode | null> {
    const row = this.db.prepare("SELECT payload FROM report_nodes WHERE node_id = ?").get(id) as Row | undefined;
    return row ? JSON.parse(row.payload) as ReportNode : null;
  }

  async listReportNodes(): Promise<ReportNode[]> {
    const rows = this.db.prepare("SELECT payload FROM report_nodes ORDER BY created_at, node_id").all() as Row[];
    return rows.map((row) => JSON.parse(row.payload) as ReportNode);
  }

  async listChildren(parentNodeId: string): Promise<ReportNode[]> {
    const rows = this.db.prepare("SELECT payload FROM report_nodes WHERE parent_node_id = ? ORDER BY created_at, node_id").all(parentNodeId) as Row[];
    return rows.map((row) => JSON.parse(row.payload) as ReportNode);
  }

  async updateReportNode(node: ReportNode): Promise<void> {
    if (!(await this.getReportNode(node.nodeId))) throw new MockNotFoundError("ReportNode", node.nodeId);
    await this.upsertReportNode(node);
  }

  async upsertKnowledgeNode(node: KnowledgeNode): Promise<{ created: boolean; nodeId: string }> {
    validateKnowledgeNode(node);
    const existed = this.db.prepare("SELECT 1 FROM knowledge_nodes WHERE node_id = ?").get(node.nodeId);
    this.db.prepare(
      `INSERT OR REPLACE INTO knowledge_nodes(node_id, content_hash, node_type, source_tier, payload, retrieved_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(node.nodeId, node.contentHash, node.nodeType, node.sourceTier, JSON.stringify(node), node.retrievedAt);
    return { created: !existed, nodeId: node.nodeId };
  }

  async getKnowledgeNode(id: string): Promise<KnowledgeNode | null> {
    const row = this.db.prepare("SELECT payload FROM knowledge_nodes WHERE node_id = ?").get(id) as Row | undefined;
    return row ? JSON.parse(row.payload) as KnowledgeNode : null;
  }

  async listKnowledgeNodes(): Promise<KnowledgeNode[]> {
    const rows = this.db.prepare("SELECT payload FROM knowledge_nodes ORDER BY retrieved_at, node_id").all() as Row[];
    return rows.map((row) => JSON.parse(row.payload) as KnowledgeNode);
  }

  async upsertEvidenceLink(link: EvidenceLink): Promise<{ created: boolean; linkId: string }> {
    validateEvidenceLink(link);
    if (!(await this.getReportNode(link.reportNodeId))) throw new MockNotFoundError("ReportNode", link.reportNodeId);
    if (!(await this.getKnowledgeNode(link.knowledgeNodeId))) throw new MockNotFoundError("KnowledgeNode", link.knowledgeNodeId);
    const previous = await this.getEvidenceLink(link.linkId);
    this.db.prepare(
      `INSERT OR REPLACE INTO evidence_links(link_id, report_node_id, knowledge_node_id, relation, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(link.linkId, link.reportNodeId, link.knowledgeNodeId, link.relation, JSON.stringify(link), link.createdAt);
    this.recomputeCoverageCascade(link.reportNodeId);
    if (previous && previous.reportNodeId !== link.reportNodeId) this.recomputeCoverageCascade(previous.reportNodeId);
    return { created: !previous, linkId: link.linkId };
  }

  async getEvidenceLink(id: string): Promise<EvidenceLink | null> {
    const row = this.db.prepare("SELECT payload FROM evidence_links WHERE link_id = ?").get(id) as Row | undefined;
    return row ? JSON.parse(row.payload) as EvidenceLink : null;
  }

  async listEvidenceLinks(reportNodeId?: string): Promise<EvidenceLink[]> {
    const rows = reportNodeId
      ? this.db.prepare("SELECT payload FROM evidence_links WHERE report_node_id = ? ORDER BY created_at, link_id").all(reportNodeId) as Row[]
      : this.db.prepare("SELECT payload FROM evidence_links ORDER BY created_at, link_id").all() as Row[];
    return rows.map((row) => JSON.parse(row.payload) as EvidenceLink);
  }

  async listEvidenceLinksByKnowledgeNode(knowledgeNodeId: string): Promise<EvidenceLink[]> {
    const rows = this.db.prepare("SELECT payload FROM evidence_links WHERE knowledge_node_id = ? ORDER BY created_at, link_id").all(knowledgeNodeId) as Row[];
    return rows.map((row) => JSON.parse(row.payload) as EvidenceLink);
  }

  async updateEvidenceLink(link: EvidenceLink): Promise<void> {
    if (!(await this.getEvidenceLink(link.linkId))) throw new MockNotFoundError("EvidenceLink", link.linkId);
    await this.upsertEvidenceLink(link);
  }

  async upsertReportlet(reportlet: Reportlet): Promise<{ created: boolean; reportletId: string }> {
    validateReportlet(reportlet);
    if (!(await this.getReportNode(reportlet.reportNodeId))) throw new MockNotFoundError("ReportNode", reportlet.reportNodeId);
    for (const evidenceLinkId of reportlet.citedEvidenceLinkIds) {
      if (!(await this.getEvidenceLink(evidenceLinkId))) throw new MockNotFoundError("EvidenceLink", evidenceLinkId);
    }
    for (const knowledgeNodeId of reportlet.citedKnowledgeNodeIds) {
      if (!(await this.getKnowledgeNode(knowledgeNodeId))) throw new MockNotFoundError("KnowledgeNode", knowledgeNodeId);
    }
    const existed = this.db.prepare("SELECT 1 FROM reportlets WHERE reportlet_id = ?").get(reportlet.reportletId);
    this.db.prepare(
      `INSERT OR REPLACE INTO reportlets(reportlet_id, report_node_id, task_id, payload, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(reportlet.reportletId, reportlet.reportNodeId, reportlet.taskId, JSON.stringify(reportlet), reportlet.createdAt, reportlet.updatedAt);
    return { created: !existed, reportletId: reportlet.reportletId };
  }

  async getReportlet(id: string): Promise<Reportlet | null> {
    const row = this.db.prepare("SELECT payload FROM reportlets WHERE reportlet_id = ?").get(id) as Row | undefined;
    return row ? JSON.parse(row.payload) as Reportlet : null;
  }

  async listReportlets(reportNodeId?: string): Promise<Reportlet[]> {
    const rows = reportNodeId
      ? this.db.prepare("SELECT payload FROM reportlets WHERE report_node_id = ? ORDER BY created_at, reportlet_id").all(reportNodeId) as Row[]
      : this.db.prepare("SELECT payload FROM reportlets ORDER BY created_at, reportlet_id").all() as Row[];
    return rows.map((row) => JSON.parse(row.payload) as Reportlet);
  }

  async listOpenGaps(reportNodeId?: string): Promise<OpenGap[]> {
    const rows = reportNodeId
      ? this.db.prepare("SELECT payload FROM open_gaps WHERE report_node_id = ?").all(reportNodeId) as Row[]
      : this.db.prepare("SELECT payload FROM open_gaps").all() as Row[];
    return rows.map((row) => JSON.parse(row.payload) as OpenGap);
  }

  async closeOpenGaps(reportNodeId: string, _reason?: string): Promise<number> {
    const rows = this.db.prepare("SELECT gap_id, payload FROM open_gaps WHERE report_node_id = ?").all(reportNodeId) as GapRow[];
    let closed = 0;
    for (const row of rows) {
      const gap = JSON.parse(row.payload) as OpenGap;
      if (gap.status === "closed") continue;
      const next = { ...gap, status: "closed" as const };
      this.db.prepare("UPDATE open_gaps SET payload = ? WHERE gap_id = ?").run(JSON.stringify(next), row.gap_id);
      closed++;
    }
    if (closed > 0) this.recomputeCoverageCascade(reportNodeId);
    return closed;
  }

  async acknowledgeOpenGaps(matches: Array<{ reportNodeId?: string; description: string; reason: string }>): Promise<number> {
    const rows = this.db.prepare("SELECT gap_id, report_node_id, payload FROM open_gaps").all() as GapRow[];
    let acknowledged = 0;
    const touched = new Set<string>();
    for (const row of rows) {
      const gap = JSON.parse(row.payload) as OpenGap;
      if (gap.status === "closed" || gap.status === "acknowledged") continue;
      if (!matches.some((item) => gapMatches(gap, item))) continue;
      const next = { ...gap, status: "acknowledged" as const };
      this.db.prepare("UPDATE open_gaps SET payload = ? WHERE gap_id = ?").run(JSON.stringify(next), row.gap_id);
      if (gap.reportNodeId) touched.add(gap.reportNodeId);
      acknowledged++;
    }
    for (const reportNodeId of touched) this.recomputeCoverageCascade(reportNodeId);
    return acknowledged;
  }

  async closeOpenGapsMatching(matches: Array<{ reportNodeId?: string; description: string; reason: string }>): Promise<number> {
    const rows = this.db.prepare("SELECT gap_id, report_node_id, payload FROM open_gaps").all() as GapRow[];
    let closed = 0;
    const touched = new Set<string>();
    for (const row of rows) {
      const gap = JSON.parse(row.payload) as OpenGap;
      if (gap.status === "closed" || !matches.some((item) => gapMatches(gap, item))) continue;
      this.db.prepare("UPDATE open_gaps SET payload = ? WHERE gap_id = ?").run(JSON.stringify({ ...gap, status: "closed" as const }), row.gap_id);
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

  addOpenGap(gap: OpenGap): void {
    const rows = this.db.prepare("SELECT gap_id, payload FROM open_gaps WHERE report_node_id IS ?").all(gap.reportNodeId ?? null) as GapRow[];
    const existing = rows.map((row) => ({ row, gap: JSON.parse(row.payload) as OpenGap })).find((item) => sameOpenGap(item.gap, gap));
    if (existing) {
      this.db.prepare("UPDATE open_gaps SET payload = ? WHERE gap_id = ?").run(JSON.stringify(mergeOpenGap(existing.gap, gap)), existing.row.gap_id);
    } else {
      this.db.prepare("INSERT INTO open_gaps(report_node_id, payload) VALUES (?, ?)").run(gap.reportNodeId ?? null, JSON.stringify(gap));
    }
    if (gap.reportNodeId) this.recomputeCoverageCascade(gap.reportNodeId);
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
      cursor = this.getReportNodeSync(cursor)?.parentNodeId;
    }
    return ids;
  }

  private subtreeIds(reportNodeId: string): Set<string> {
    const nodes = this.listReportNodesSync();
    const ids = new Set<string>([reportNodeId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of nodes) {
        if (node.parentNodeId && ids.has(node.parentNodeId) && !ids.has(node.nodeId)) {
          ids.add(node.nodeId);
          changed = true;
        }
      }
    }
    return ids;
  }

  private recomputeCoverage(reportNodeId: string): void {
    const node = this.getReportNodeSync(reportNodeId);
    if (!node) return;
    const subtree = this.subtreeIds(reportNodeId);
    const links = this.listEvidenceLinksSync().filter((link) => subtree.has(link.reportNodeId));
    const gaps = this.listOpenGapsSync().filter((gap) => gap.reportNodeId && subtree.has(gap.reportNodeId));
    node.coverage = {
      supportingCount: links.filter((link) => link.relation === "supports").length,
      contradictingCount: links.filter((link) => link.relation === "contradicts").length,
      openGapCount: gaps.filter(isBlockingGap).length,
    };
    node.updatedAt = new Date().toISOString();
    validateReportNode(node);
    this.db.prepare(
      `INSERT OR REPLACE INTO report_nodes(node_id, parent_node_id, payload, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(node.nodeId, node.parentNodeId, JSON.stringify(node), node.createdAt, node.updatedAt);
  }

  private getReportNodeSync(id: string): ReportNode | null {
    const row = this.db.prepare("SELECT payload FROM report_nodes WHERE node_id = ?").get(id) as Row | undefined;
    return row ? JSON.parse(row.payload) as ReportNode : null;
  }

  private listReportNodesSync(): ReportNode[] {
    const rows = this.db.prepare("SELECT payload FROM report_nodes ORDER BY created_at, node_id").all() as Row[];
    return rows.map((row) => JSON.parse(row.payload) as ReportNode);
  }

  private listEvidenceLinksSync(): EvidenceLink[] {
    const rows = this.db.prepare("SELECT payload FROM evidence_links ORDER BY created_at, link_id").all() as Row[];
    return rows.map((row) => JSON.parse(row.payload) as EvidenceLink);
  }

  private listOpenGapsSync(): OpenGap[] {
    const rows = this.db.prepare("SELECT payload FROM open_gaps").all() as Row[];
    return rows.map((row) => JSON.parse(row.payload) as OpenGap);
  }
}

function isBlockingGap(gap: OpenGap): boolean {
  return gap.status === "open" || (gap.status === "acknowledged" && gap.impact === "high");
}

interface Row {
  payload: string;
}

interface GapRow extends Row {
  gap_id: number;
  report_node_id?: string;
}

function gapMatches(gap: OpenGap, match: { reportNodeId?: string; description: string }): boolean {
  if (match.reportNodeId && gap.reportNodeId !== match.reportNodeId) return false;
  return gap.description === match.description || gap.description.includes(match.description) || match.description.includes(gap.description);
}
