# Durable HTTP run store

Run metadata durability and episode execution recovery are separate layers. The run store persists run ownership, status, replay windows, heartbeat, and cancellation; checkpoint v3 persists resumable orchestrator state with atomic files and immutable event snapshots. See [`CHECKPOINT_RECOVERY.md`](CHECKPOINT_RECOVERY.md).

`createResearchHttpHandler` supports two run-store implementations:

- `createInMemoryResearchRunStore()` for tests and single-process ephemeral use.
- `createSqliteResearchRunStore()` for restart-safe and multi-worker deployments on one shared filesystem.

The SQLite store persists the public `RUN_*` identifier independently from the internal `EP_*` episode identifier. This keeps status, replay, cancellation, and artifact links stable after a server restart.

```ts
import { createServer } from "node:http";
import {
  createResearchHttpHandler,
  createSqliteResearchRunStore,
} from "@deepresearch/orchestrator";

const runStore = createSqliteResearchRunStore({
  dbPath: "artifacts/server/research-runs.sqlite",
  staleAfterMs: 15 * 60_000,
  maxEvents: 6000,
  maxFrames: 3000,
});

const server = createServer(createResearchHttpHandler({
  runStore,
  apiToken: process.env.SERVER_API_TOKEN,
  maxResearchStartsPerMinute: 6,
  maxConcurrentRuns: 2,
  requestCaps: {
    maxEpisodeCostUsd: 2,
    maxEpisodeTokens: 750000,
    maxLlmRequests: 350,
    maxCycles: 48,
  },
  defaults: { artifactDir: "artifacts/server" },
}));
```

`GET /health` remains public for probes. Every other route requires `Authorization: Bearer <token>` or `x-api-key` when `apiToken` is configured. Token comparison is constant-time. Rate limiting applies to research starts per client, concurrent-run admission is global to the handler, and request caps reject over-budget input before a run record or provider request is created. When a reverse proxy supplies client IP headers, enable trust only for a proxy you control; otherwise those headers are attacker-controlled.

## Concurrency behavior

The database enables WAL mode, `synchronous=NORMAL`, and a 5-second busy timeout. Run creation is an atomic primary-key insert: two workers cannot claim the same client-provided run ID, and a collision returns HTTP 409 without modifying the existing run.

Each active worker updates a durable heartbeat while appending events or frames. A `running` record whose heartbeat exceeds `staleAfterMs` is exposed as `interrupted`; clients should resume from `checkpointPath`. The default 15-minute threshold is deliberately longer than normal provider timeouts to avoid declaring a long LLM request dead.

Cancellation is durable. Any worker can set the record to `cancelled`; the owning HTTP worker polls the lightweight status row and aborts its local `AbortController`. A late success or failure cannot overwrite the cancelled status.

Episode IDs include a process-instance nonce. Multiple workers starting in the same second therefore write to different artifact directories.

## Replay and recovery

Events and rendered frames are stored in ordered, bounded tables. The default limits retain the newest 6,000 events and 3,000 frames per run. Checkpoint events also update `checkpointPath` and the checkpoint cursor, so a crashed run remains resumable even before a final `EpisodeResult` exists.

Completed result and summary JSON are persisted with the run-to-episode mapping. Artifact files remain in `artifactDir`; the database does not duplicate report bodies, evidence indexes, or traces.

## Operational boundaries

The reference server binds to `127.0.0.1`. It refuses a non-loopback bind without `SERVER_API_TOKEN` unless the operator explicitly sets `ALLOW_UNAUTHENTICATED_PUBLIC=1`. That override is intended only for an already authenticated private gateway, not direct Internet exposure.

Client-provided artifact directories are ignored by default. Resume checkpoints are resolved and confined to the configured artifact directory before hydration, preventing a request from reading an arbitrary local checkpoint. `allowClientArtifactDir` and `allowExternalResumePath` are trusted-deployment escape hatches and should remain disabled for public or multi-tenant handlers.

SQLite WAL is appropriate for multiple Node workers on the same host or a filesystem with correct SQLite locking semantics. It is not a cross-region coordination system. For horizontally distributed hosts, implement the `ResearchRunStore` interface on a transactional database and use a distributed cancellation notification or equivalent polling strategy.

`better-sqlite3` is a native dependency. Downstream installations must allow its install/build script; package verification intentionally instantiates the installed SQLite store so a missing native binding fails before deployment.

Close `SqliteResearchRunStore` during graceful shutdown. The included `examples/backend-sse-server.mjs` does this for `SIGINT` and `SIGTERM` and accepts:

- `ARTIFACT_DIR` for episode artifacts.
- `RUN_STORE_DB_PATH` for the SQLite database.
- `SERVER_API_TOKEN` for Bearer/API-key authentication.
- `SERVER_MAX_STARTS_PER_MINUTE` and `SERVER_MAX_CONCURRENT_RUNS` for admission control.
- `SERVER_MAX_EPISODE_COST_USD`, `SERVER_MAX_EPISODE_TOKENS`, `SERVER_MAX_LLM_REQUESTS`, and `SERVER_MAX_CYCLES` for hard per-request caps.
- `SERVER_TRUST_PROXY=1` only when the immediate reverse proxy is trusted.

Client-supplied run IDs are restricted to 1–128 ASCII letters, numbers, dots, underscores, or hyphens. Artifact hydration also verifies path containment before reading episode directories.
