import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  auditInlineCase,
  runQualityRegressionManifest,
  type QualityRegressionManifest,
} from "../quality-regression.js";

const dirs: string[] = [];
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");
const baselineManifestPath = join(repositoryRoot, "configs/regression/quality-regression.json");

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("quality regression gate", () => {
  it("passes every repository baseline case", () => {
    const result = runQualityRegressionManifest(baselineManifestPath);

    expect(result.passed).toBe(true);
    expect(result.failedCount).toBe(0);
    expect(result.caseCount).toBeGreaterThanOrEqual(7);
  });

  it("reports a readable failure when a score baseline is tightened", () => {
    const dir = temporaryDirectory();
    const manifest = readManifest();
    manifest.cases[0]!.expect.minScore = 101;
    // This test exercises an inline threshold only. Repository artifact cases
    // remain covered by the baseline test and should not make a copied
    // temporary manifest depend on fixture directories that were not copied.
    manifest.artifactCases = [];
    const manifestPath = writeManifest(dir, manifest);

    const result = runQualityRegressionManifest(manifestPath);

    expect(result.passed).toBe(false);
    expect(result.cases[0]?.failures).toContain("score expected >= 101, observed 100");
  });

  it("reads evidence and budget audits from an artifact directory", () => {
    const dir = temporaryDirectory();
    const artifactDir = join(dir, "episode-artifacts");
    mkdirSync(artifactDir, { recursive: true });
    const baseline = readManifest();
    const audit = auditInlineCase(baseline.cases[0]!, baseline.generatedAt);
    writeFileSync(join(artifactDir, "evidence-quality-audit.json"), JSON.stringify(audit), "utf8");
    writeFileSync(join(artifactDir, "budget-audit.json"), JSON.stringify({
      version: 1,
      generatedAt: "2026-07-14T00:00:00.000Z",
      limits: {},
      usage: [],
      totals: {
        requests: 2,
        succeededRequests: 2,
        failedRequests: 0,
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        estimatedCostUsd: 0.01,
      },
      breaches: [],
      cycleGains: [],
    }), "utf8");
    const manifest: QualityRegressionManifest = {
      version: 1,
      generatedAt: "2026-07-14T00:00:00.000Z",
      cases: [],
      artifactCases: [{
        id: "real_episode_artifacts",
        description: "Reads persisted episode audit artifacts.",
        artifactDir: "./episode-artifacts",
        expect: {
          minScore: 100,
          activeErrorCount: 0,
          budget: { maxRequests: 2, maxTotalTokens: 150, maxEstimatedCostUsd: 0.01, maxBreaches: 0 },
        },
      }],
    };

    const result = runQualityRegressionManifest(writeManifest(dir, manifest));

    expect(result.passed).toBe(true);
    expect(result.cases[0]?.observed.budget).toMatchObject({ requests: 2, totalTokens: 150, breachCount: 0 });
  });

  it("reports a readable failure when an artifact audit is missing", () => {
    const dir = temporaryDirectory();
    const manifest: QualityRegressionManifest = {
      version: 1,
      generatedAt: "2026-07-14T00:00:00.000Z",
      cases: [],
      artifactCases: [{
        id: "missing_episode_artifacts",
        description: "Missing persisted artifacts should fail without crashing the gate.",
        artifactDir: "./missing-episode",
        expect: {},
      }],
    };

    const result = runQualityRegressionManifest(writeManifest(dir, manifest));

    expect(result.passed).toBe(false);
    expect(result.cases[0]?.failures[0]).toContain("artifact audit missing:");
  });

  it("rejects duplicate case IDs across inline and artifact cases", () => {
    const dir = temporaryDirectory();
    const manifest = readManifest();
    manifest.artifactCases = [{
      id: manifest.cases[0]!.id,
      description: "duplicate",
      artifactDir: ".",
      expect: {},
    }];

    expect(() => runQualityRegressionManifest(writeManifest(dir, manifest))).toThrow("case IDs must be unique");
  });

  it("rejects unsupported manifest versions", () => {
    const dir = temporaryDirectory();
    const manifest = readManifest();
    (manifest as unknown as { version: number }).version = 2;

    expect(() => runQualityRegressionManifest(writeManifest(dir, manifest))).toThrow("Unsupported quality regression manifest version: 2");
  });
});

function temporaryDirectory(): string {
  const dir = mkdtempSync(join(tmpdir(), "quality-regression-"));
  dirs.push(dir);
  return dir;
}

function readManifest(): QualityRegressionManifest {
  return JSON.parse(readFileSync(baselineManifestPath, "utf8")) as QualityRegressionManifest;
}

function writeManifest(dir: string, manifest: object): string {
  const path = join(dir, "manifest.json");
  writeFileSync(path, JSON.stringify(manifest), "utf8");
  return path;
}
