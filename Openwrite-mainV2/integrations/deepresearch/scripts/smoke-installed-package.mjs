import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const packagesDir = join(root, "artifacts/packages");
const workspacePackagesDir = join(root, "packages");
const keepDir = process.env.KEEP_PACKAGE_SMOKE_DIR === "1";

if (!existsSync(packagesDir)) {
  fail(`Missing package artifact directory: ${packagesDir}. Run pnpm package:pack first.`);
}

const tarballs = readdirSync(packagesDir)
  .filter((name) => name.endsWith(".tgz"))
  .sort()
  .map((name) => resolve(packagesDir, name));

if (tarballs.length === 0) {
  fail(`No package tarballs found in ${packagesDir}. Run pnpm package:pack first.`);
}

const appDir = mkdtempSync(join(tmpdir(), "deepresearch-installed-smoke-"));

try {
  const dependencies = packageDependencies();
  writeFileSync(join(appDir, "package.json"), JSON.stringify({
    name: "deepresearch-installed-smoke",
    version: "0.0.0",
    private: true,
    type: "module",
    dependencies,
    pnpm: {
      overrides: dependencies,
    },
  }, null, 2));

  run("pnpm", ["install"], appDir);

  writeFileSync(join(appDir, "smoke.mjs"), smokeSource());
  run("node", ["smoke.mjs"], appDir);
  run("pnpm", [
    "exec",
    "deepresearch",
    "Packaged CLI smoke",
    "--llm",
    "echo",
    "--search",
    "mock",
    "--artifactDir",
    join(appDir, "artifacts/cli"),
    "--cycles",
    "1",
    "--quality",
    "advisory",
    "--stream",
    "steps",
    "--lang",
    "en",
  ], appDir);

  console.log(`Installed package smoke passed in ${appDir}`);
} finally {
  if (keepDir) {
    console.log(`Keeping smoke app directory: ${appDir}`);
  } else {
    rmSync(appDir, { recursive: true, force: true });
  }
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: {
      ...process.env,
      npm_config_fund: "false",
      npm_config_audit: "false",
    },
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function packageDependencies() {
  const byFileName = new Map(tarballs.map((tarball) => [tarball.split("/").pop(), tarball]));
  const dependencies = {};
  for (const dirName of readdirSync(workspacePackagesDir).sort()) {
    const pkgPath = join(workspacePackagesDir, dirName, "package.json");
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (!pkg.name || !pkg.version) continue;
    const fileName = `${pkg.name.replace(/^@/, "").replace("/", "-")}-${pkg.version}.tgz`;
    const tarball = byFileName.get(fileName);
    if (!tarball) fail(`Missing tarball for ${pkg.name}: expected ${fileName}`);
    dependencies[pkg.name] = `file:${tarball}`;
  }
  return dependencies;
}

function smokeSource() {
  return String.raw`
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createResearchHttpHandler, createSqliteResearchRunStore, encodeResearchSse, inspectResearchCheckpoint, runResearch, streamResearch } from "@deepresearch/orchestrator";
import { EchoLlmChat } from "@deepresearch/embedding-providers";

const llm = new EchoLlmChat({ echoFn: echoJson });
const search = {
  name: "installed-smoke-search",
  async search(query, topK) {
    return Array.from({ length: Math.min(topK, 3) }, (_, index) => ({
      url: "https://example.test/installed/" + (index + 1),
      title: "Installed smoke source " + (index + 1),
      snippet: "Installed package smoke evidence for " + query,
    }));
  },
};

const frames = [];
assert(encodeResearchSse("frame", "ok") === "event: frame\ndata: ok\n\n", "SSE helper export should be usable from packaged orchestrator");
assert(typeof createResearchHttpHandler === "function", "Node HTTP handler export should be usable from packaged orchestrator");
const durableStore = createSqliteResearchRunStore({ dbPath: new URL("./run-store.sqlite", import.meta.url).pathname });
durableStore.create({ runId: "RUN_packaged_sqlite", prompt: "Packaged SQLite smoke", controller: new AbortController() });
assert(durableStore.get("RUN_packaged_sqlite")?.status === "running", "Packaged SQLite run store should load its native dependency");
durableStore.close();
const output = await runResearch({
  prompt: "Installed package backend API smoke",
  artifactDir: new URL("./artifacts/api", import.meta.url).pathname,
  language: "en",
  maxCycles: 1,
  evidenceQualityMode: "advisory",
  streamMode: "transcript",
  streamMaxChars: 500,
  llm,
  search,
  onFrame(frame) {
    frames.push(frame);
  },
});

assert(output.summary.status === "succeeded", "runResearch should succeed");
assert(existsSync(output.summary.report), "runResearch should write report artifact");
const inspectedCheckpoint = await inspectResearchCheckpoint(output.summary.checkpoint);
assert(inspectedCheckpoint.checkpoint.version === 3, "Packaged runResearch should write checkpoint v3");
assert(/^[a-f0-9]{64}$/.test(inspectedCheckpoint.checkpoint.eventStore?.sha256 ?? ""), "Checkpoint v3 should carry a SHA-256 event digest");
assert((inspectedCheckpoint.checkpoint.eventStore?.compressedBytes ?? 0) > 0, "Checkpoint v3 should carry the compressed event size");
assert(existsSync(join(dirname(inspectedCheckpoint.checkpointPath), inspectedCheckpoint.checkpoint.eventStore.path)), "Checkpoint v3 event sidecar should exist");
assert(inspectedCheckpoint.events.length > 0, "Packaged checkpoint inspection should verify and restore events");
assert(frames.some((frame) => frame.kind === "transcript" && frame.messages?.some((message) => message.role === "assistant")), "runResearch should emit structured transcript frames");
assert(frames.some((frame) => frame.kind === "search"), "runResearch should emit search frames");

const streamed = [];
for await (const message of streamResearch({
  prompt: "Installed package stream API smoke",
  artifactDir: new URL("./artifacts/stream", import.meta.url).pathname,
  language: "en",
  maxCycles: 1,
  evidenceQualityMode: "advisory",
  streamMode: "transcript",
  streamMaxChars: 500,
  llm,
  search,
})) {
  streamed.push(message);
}

assert(streamed.some((message) => message.type === "frame" && message.frame.kind === "transcript"), "streamResearch should yield transcript frames");
assert(streamed.some((message) => message.type === "result" && message.summary.status === "succeeded"), "streamResearch should yield a succeeded result");

console.log("Packaged backend API smoke passed.");

function echoJson(req) {
  if (req.user.includes("\"suggestions\"")) {
    return JSON.stringify({ suggestions: [] });
  }
  if (req.user.includes("\"relation\"")) {
    return JSON.stringify({
      relation: "supports",
      claimText: "Installed smoke evidence supports the central claim.",
      confidence: 0.7,
      nodeStatus: "supported",
      reasoningSummary: "Installed package search observations are sufficient for smoke testing.",
      openGaps: [],
      structurePatchSuggestions: [],
    });
  }
  if (req.user.includes("\"queries\"")) {
    return JSON.stringify({
      queries: ["Background", "Evidence", "Risks"],
      searchRationale: "Use deterministic installed package smoke queries.",
      sourceStrategy: "Use deterministic installed package smoke queries.",
      reasoningSummary: "Installed smoke plan produced deterministic search steps.",
    });
  }
  if (req.user.includes("\"aspects\"")) {
    return JSON.stringify({
      aspects: [{
        label: "Core Evidence",
        scopeNote: "Verify the central research claim.",
        requirementIds: ["RQ_01"],
        hypotheses: [{
          statement: "The central claim requires sourced evidence.",
          researchBrief: "Search for credible sources and record uncertainty.",
          evidenceGuidance: "Prefer official or primary sources.",
          requirementIds: ["RQ_01"],
        }],
        tasks: [{
          title: "Verify central claim",
          objective: "Find evidence for or against the central claim.",
          acceptanceCriteria: ["At least one credible source or an explicit open gap."],
        }],
      }],
    });
  }
  if (req.user.startsWith("Build GlobalRubric JSON")) {
    return JSON.stringify({
      rubricText: "Use credible sources and cite evidence. " + req.user.slice(0, 300),
      outputHints: { titleHint: "Deep Research Report", language: "en", citationRequired: true, format: "markdown" },
      researchQuestionHints: ["Background", "Evidence", "Risks"],
      requirements: [{
        requirementId: "RQ_01",
        description: "Answer the installed package smoke research request.",
        kind: "question",
        priority: "must",
        evidenceRequired: true,
        evidenceNeeds: ["At least one directly linked source"],
        successCriteria: ["The report addresses the central claim"],
      }],
    });
  }
  return "{}";
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
`;
}
