import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { createResearchHttpHandler, createSqliteResearchRunStore } = await importOrchestrator();

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";
const apiToken = process.env.SERVER_API_TOKEN?.trim() || undefined;
if (!isLoopbackHost(host) && !apiToken && process.env.ALLOW_UNAUTHENTICATED_PUBLIC !== "1") {
  throw new Error("Refusing to expose the research server without authentication. Set SERVER_API_TOKEN, bind HOST=127.0.0.1, or explicitly set ALLOW_UNAUTHENTICATED_PUBLIC=1.");
}
const here = dirname(fileURLToPath(import.meta.url));
const consolePath = join(here, "research-console.html");
const legacyUiPath = join(here, "research-ui.html");
const artifactDir = process.env.ARTIFACT_DIR ?? "artifacts/server";
await mkdir(artifactDir, { recursive: true });
const runStore = createSqliteResearchRunStore({
  dbPath: process.env.RUN_STORE_DB_PATH ?? join(artifactDir, "research-runs.sqlite"),
});

const researchHandler = createResearchHttpHandler({
  env: process.env,
  runStore,
  apiToken,
  maxResearchStartsPerMinute: positiveInteger(process.env.SERVER_MAX_STARTS_PER_MINUTE, 6),
  maxConcurrentRuns: positiveInteger(process.env.SERVER_MAX_CONCURRENT_RUNS, 2),
  trustProxy: process.env.SERVER_TRUST_PROXY === "1",
  requestCaps: {
    maxEpisodeCostUsd: positiveNumber(process.env.SERVER_MAX_EPISODE_COST_USD, 6.5),
    maxEpisodeTokens: positiveInteger(process.env.SERVER_MAX_EPISODE_TOKENS, 3_000_000),
    maxLlmRequests: positiveInteger(process.env.SERVER_MAX_LLM_REQUESTS, 1_200),
    maxCycles: positiveInteger(process.env.SERVER_MAX_CYCLES, 48),
  },
  defaults: {
    artifactDir,
    language: "zh-CN",
    streamMode: "transcript",
    streamMaxChars: 12000,
    evidenceTargetSteps: 24,
    evidenceTargetFetchCalls: 8,
    maxEpisodeCostUsd: positiveNumber(process.env.SERVER_MAX_EPISODE_COST_USD, 6.5),
    maxEpisodeTokens: positiveInteger(process.env.SERVER_MAX_EPISODE_TOKENS, 3_000_000),
    maxLlmRequests: positiveInteger(process.env.SERVER_MAX_LLM_REQUESTS, 1_200),
    humanReview: false,
    completionRepairCycles: 0,
    debugSingleBranch: false,
  },
});

const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (req.method === "GET" && (path === "/" || path === "/console" || path === "/ui")) {
    try {
      const html = await readFile(path === "/ui" ? legacyUiPath : consolePath, "utf8");
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-cache",
      });
      res.end(html);
    } catch (err) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }
  await researchHandler(req, res);
});

server.on("error", (err) => {
  if (err && typeof err === "object" && "code" in err && err.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use.`);
    console.error(`Stop the existing server or run with another port, for example: PORT=${port + 1} pnpm run server`);
    process.exit(1);
  }
  throw err;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    server.close(() => {
      runStore.close();
      process.exit(0);
    });
  });
}

server.listen(port, host, () => {
  console.log(`deepresearch console listening on http://${displayHost(host)}:${port}/console`);
  console.log(`research start protection: ${positiveInteger(process.env.SERVER_MAX_STARTS_PER_MINUTE, 6)}/minute, ${positiveInteger(process.env.SERVER_MAX_CONCURRENT_RUNS, 2)} concurrent`);
  if (apiToken) console.log("research API authentication: enabled");
});

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isLoopbackHost(value) {
  return value === "127.0.0.1" || value === "::1" || value === "localhost";
}

function displayHost(value) {
  return value.includes(":") ? `[${value}]` : value;
}

async function importOrchestrator() {
  try {
    return await import("../packages/orchestrator/src/index.ts");
  } catch (sourceErr) {
    try {
      return await import("@deepresearch/orchestrator");
    } catch {
      try {
        return await import("../packages/orchestrator/dist/index.js");
      } catch {
        throw sourceErr;
      }
    }
  }
}
