# deepresearch-framework

This workspace keeps the v5 data/model invariants described by [`docs/SPEC_V5.md`](docs/SPEC_V5.md), while the current implementation has added the v6 agent runtime, ToolRegistry, streaming backend, checkpoint resume, and example DeepResearch console described by [`docs/SPEC_V6.md`](docs/SPEC_V6.md).

For a compact component and persistence map, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Packages

- `@deepresearch/contracts`: v5 public contracts: `TaskSubmission`, reduced `ResearchContext`, `RuntimeProfile`, `ReportNode`, `KnowledgeNode`, `EvidenceLink`, `TaskItem`, `ContextPacket`, `AgentRunResult`, `ReportBundle`, and `EpisodeResult`.
- `@deepresearch/net-utils`: shared network helpers — abort/sleep utilities, fetch error formatting, proxy detection, and undici dispatcher-backed fetch.
- `@deepresearch/orchestrator`: phase runner and the v5 phases: parse, rubric, init-root, scout, architect-tree, dispatch-evidence, cycle-reflection, structure-review, completion-gate, report, publish-gate.
- `@deepresearch/knowledge-graph`: in-memory and SQLite KG storing only report nodes, knowledge nodes, evidence links, and open gaps.
- `@deepresearch/task-ledger`: v5 task ledger with non-empty acceptance criteria and queued/running/blocked/completed/failed/cancelled states.
- `@deepresearch/memory-graph`: event and trace store only. Agent context is assembled by orchestrator `ContextBuilder`.
- `@deepresearch/report-evaluator`: v5 reporter service consuming only `ReportBundle`.
- `@deepresearch/search-providers`: concrete search provider implementations plus URL normalization, deduplication, and source policy filtering.
- `@deepresearch/tool-providers`: unified tool provider surface for search, fetch-page, and user-file capabilities.
- `@deepresearch/embedding-providers`: local embedding fallback and OpenAI-compatible/DeepSeek chat providers.
- `@deepresearch/benchmark-adapters`: benchmark task adapters that produce v5 `TaskSubmission` and `RuntimeProfile`.
- `@deepresearch/testing`: v5 fixtures and in-memory stack helpers.
- `@deepresearch/calibration`: post-run calibration metrics over v5 `AgentRunResult` artifacts.

Evidence portfolio quality is governed by `RuntimeProfile.evidenceQuality`. The default balanced policy performs bounded repairs, then automatically omits unsupported branches or qualifies the cited subset; it records framework dispositions in `publication-warnings.json` instead of pausing for routine evidence scarcity. `mode: "strict"` keeps unresolved quality and coverage failures blocking. Citation integrity, forbidden-source rules, fabricated evidence, and remaining unsupported claims are never force-published. See [`docs/EVIDENCE_QUALITY.md`](docs/EVIDENCE_QUALITY.md).

Each `ResearchRequirement` carries orthogonal structured policies: `failurePolicy` controls degrade versus block, while `visibility` controls reader-facing versus internal enforcement. Ordinary coverage and deliverables are degradable/readable; non-waivable source prohibitions are blocking/internal. Text inference remains only as a safety-compatible fallback for older checkpoints.

User constraints are normalized into stable `ResearchRequirement` records and mapped to report leaves. If the rubric model drops items from an explicitly introduced numbered research-task list, deterministic one-to-one matching restores only the missing evidence-bearing requirements; numbered language, formatting, and citation instructions are excluded. Restarted nested outlines are preserved separately: each explicitly introduced 1…N group with bold item headings maps to its own requirement, while a shared “for each item” field list becomes `metricScope`. Indented bold subtopics under one numbered parent use a parent-bound contract instead: each child receives its own cited research responsibility, while the rendered H3-or-deeper heading must remain inside that parent H2. Both paths require bounded hierarchy language and reject ordinary bullets, unheaded instructions, count mismatches, or broad parent requirements masquerading as one child. Counted named scopes are likewise recovered from the original task when the target is unambiguous. Supported forms include “the following 13 countries: …”, Chinese postpositive lists such as “北京、上海……这五个城市”, and count-validated parenthetical lists such as “10种系统制式（……）”; declared counts must exactly match unique parsed names. The complete ordered list becomes `entityScope` with `entityScopeRole=members`; aggregate index or trend requirements do not inherit rows. Repeated identical scopes can map to separate requirements only when each has a strong local type and lexical match, preventing the first recovery criterion from contaminating later ranking. The initial scout expands every structured member scope even when generic authority keywords are absent, and the architect groups wide scopes into bounded entity leaves. Open discovery categories instead use `entityScopeRole=groups` and produce verified member rows bottom-up. Explicitly mandated narrative cases use a separate `exampleScope`: they become cited internal reportlets under the owning leaf, never artificial matrix rows, and the completion gate names any omitted example in a targeted repair. Exact requested fields use `metricScope`. Completion audits examples, entity-field or entity-year-field cells, and direct evidence for every `must` requirement. See [`docs/REQUIREMENT_TRACEABILITY.md`](docs/REQUIREMENT_TRACEABILITY.md).

Initial source discovery is breadth-fair under a hard query cap. Entity-expanded authority queries are round-robined across requirements, so an early wide table cannot consume every slot; when several requirements or planned queries compete, scout also reserves bounded coverage for one broad planned query and the fallback. Exact named-source exception queries remain first priority. This changes allocation, not the total call ceiling.

Leaf-first writing respects user-owned top-level structure. If the task explicitly says to use exactly N sections, or introduces “the following sections”/“整理以下几块内容” and supplies a consecutive top-level 1…N list, normalization recovers both the count and any explicit section names in order. When a smaller abstract count conflicts with a longer complete First/Second/Finally or 首先/其次/最后 sequence of substantive outputs, the concrete sequence wins, preventing the last named analysis from being collapsed away. When the plan contains the resolved number of aspects, the automatic executive summary becomes front matter and root synthesis is appended inside the final user section as an H3 instead of creating extra H2 sections. The final organizer and publish gate recheck H2 count, names, and order; optional numeric prefixes and descriptive suffixes are allowed, but renamed, missing, or reordered sections are not. If the user asks for bullets in every named section, each section body must contain a real Markdown bullet list—one list elsewhere or a numbered list does not satisfy the contract. Ancillary tables/lists remain nested as H3, reference headings are excluded, and a final `Conclusion`/`结论` aspect receives the same synthesis treatment. “At least N” remains open-ended. Bottom-up cross-branch recommendations and citations are preserved.

Temporal requirements distinguish a source's publication date from the period it describes. Explicit global report/research and public-availability cutoffs propagate to compatible evidence requirements, and every ordinary scout query carries the same semantic bound. If the rubric model omits a clearly global boundary, it is conservatively recovered from the original user input. A positively required, explicitly quoted report/study title whose year is later than that boundary is likewise recovered as a narrow exception on the most relevant requirement; its exact scout query is unbounded while ordinary queries remain bounded. Negative instructions and benchmark blocked-source text are excluded before recovery. Natural-language boundaries remain exact: “before March 2025” ends on February 28, “through March 2025” ends on March 31, “early 2024”/Q1/`2024年初` ends on March 31, and “from January 2020 to August 2023” remains `2020-01-01` through `2023-08-31`; first-half expressions end on June 30. Source-publication ranges use `after:` with the day before the inclusive start and `before:` with the day after the inclusive end, filtering both edges before fetch. Covered-period scopes instead use the same exact endpoints in `covering evidence/period` wording without publication-date operators, so a later report that explicitly covers the requested period remains discoverable and is checked by coverage metadata. Exact user-named out-of-window sources remain narrow exceptions only.

Chinese global wording such as `以2021年中期之前的信息为准` is also normalized: `中期` denotes the June period and the exclusive `之前` boundary ends on May 31. Inclusive `截至…中期` ends on June 30. Negated lower-bound wording such as `not before mid 2021` is never converted into a maximum cutoff.

Long policy, event, and development timelines are searched as bounded chronological reportlets, typically three- to four-year windows plus a small pre-period foundation part when the request explicitly relates the timeline to earlier laws or commitments. These reportlets are written bottom-up and merged in time order; the planner does not invent an event for every year or apply this sharding to ordinary literature-publication windows.

Explicit dual-perspective analysis follows the same tree discipline. When the original request says “on the one hand … on the other hand” (or the Chinese equivalent), normalization restores both sides as observable criteria on the best-matching substantive requirement. A coarsened single architect leaf is then split into two focused sibling evidence leaves, each searching and writing only its assigned side. Their parent section compares the two cited reportlets bottom-up, so one-sided evidence cannot silently stand in for a requested dual analysis or turn a nuanced question into automatic praise/condemnation.

Named comparison tables and repeated case-study/category sections are planned entity-first rather than field-first. Scout queries can expand explicit non-geographic entities into concise official or academic searches; plural cues such as `academic papers` and `studies` retain that path. Counted prefix lists preserve dotted technology names such as `Node.js` and `ASP.NET` instead of treating their dots as sentence endings. Each evidence reportlet fills every requested field for its own entity; a numbered comparison-dimension list can restore missing `metricScope`, including explicitly named security subdimensions. Requirements with the same entity set share evidence, while distinct entity-field matrices remain isolated even when debug or tree limits compress them into one leaf, preventing invalid cross-products. If one unambiguous table schema and one required category list are explicit in the original task but the rubric model drops them, normalization restores the ordered headers as `metricScope` and the categories as discovery groups; scout and planning then work category by category. For two explicitly named table partitions, every entity reportlet also determines exactly one partition from direct evidence without inventing an extra output column. The organizer and publish gate require both labels, require every scoped entity in a first-column row, and reject omissions or duplicates across the partition tables. Ordinary member comparison tables likewise cannot silently drop a scoped row. For compound deliverables, every entity must retain a non-empty Markdown heading and appear in one complete summary-table block, including Chinese/English aliases and common category shorthand. Explicit requests for 2–12 separate tables are preserved from the original task; one table cannot satisfy a three-table contract, and a three-column schema is never mistaken for three tables.

Counted empirical-study tables retain their collective minimum through publication. The same deterministic minimum parser drives search allocation, gap consolidation, final organization, and publish review. A rendered table must preserve the requested `metricScope` column order and contain at least the requested number of complete, distinct rows, each with a citation; duplicate, uncited, blank, or “not reported” rows do not satisfy the count. Render-only defects trigger report reorganization rather than another evidence-search cycle.

Derived distribution analysis is reproducible inside the evidence leaf. `calculate_distribution_indices` accepts matching source-grounded label, weight, and value arrays and deterministically returns Atkinson, Hoover, and Theil indices plus normalized per-entry shares and concentration ratios. The evidence agent must cite the saved sources for every input series; calculator output is a derivation rather than an external source, and missing inputs become explicit gaps instead of guessed or zero-filled values.

Runs reserve `needs_human_review` for strict-mode failures, non-waivable integrity constraints, or genuine preference-dependent decisions. Routine missing evidence is handled automatically and audibly. A paused run can still consume structured decisions and resume from the same checkpoint. See [`docs/HUMAN_REVIEW.md`](docs/HUMAN_REVIEW.md).

Episode-wide provider usage is enforced and written to `budget-audit.json`; safe plateau detection can stop only low-yield exploratory work after every quality and requirement gate is already satisfied. See [`docs/COST_AND_ADAPTIVE_BUDGETS.md`](docs/COST_AND_ADAPTIVE_BUDGETS.md).

Artifact-level quality baselines run with `pnpm quality:regression`. The gate evaluates declarative fixtures and persisted episode audits, emits machine-readable results, and exits non-zero on a regression. See [`docs/QUALITY_REGRESSION.md`](docs/QUALITY_REGRESSION.md).

External optimization is benchmark-driven: `pnpm bench:drb2 -- --select-only` picks one official DeepResearch Bench II task at random, while a normal run generates an evaluator-compatible `idx-<n>.md` report and records a reproducible seed, dataset hash, speed/cost metrics, failures, and optional official rubric score. See [`docs/DEEPRESEARCH_BENCH_II.md`](docs/DEEPRESEARCH_BENCH_II.md).

`pnpm live:stress` runs a bounded three-topic DeepSeek + live Bing matrix across official AI-risk, battery-regulation, and gene-therapy sources. It fails unless each topic succeeds with at least one covered must requirement, 67% requirement coverage, 80% citation utilization, evidence quality 70, and zero budget breaches. Results and full episode artifacts are written under `artifacts/live-search-stress-<date>` (override with `LIVE_STRESS_ARTIFACT_DIR`); `LIVE_STRESS_TOPIC=<id>` reruns one case. Bing is keyless and therefore has an explicit zero request-cost rate instead of inheriting the paid-search estimate. This is an explicit paid/network gate and is not part of ordinary offline CI.

Recoverable benchmark failures include a `resumeCommand`; `pnpm bench:drb2 -- --resume <checkpoint>` restores the original single task, provider boundaries, generation configuration, episode artifacts, and cached work without overwriting the original run manifest.

## Runtime Configuration

The default runtime profile lives at `configs/runtime/default.json`.

`RuntimeProfile` is the single runtime configuration surface. The merge order is:

1. CLI explicit arguments.
2. Benchmark adapter inputs.
3. `configs/runtime/default.json`.

The orchestrator expects a complete merged `RuntimeProfile` and only reads runtime values from that profile.

## Minimal Run

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm quality:regression
```

Run from the terminal:

```bash
cd deepresearch-framework
AGENT_PROVIDER=deepseek DEEPSEEK_API_KEY=... DEEPSEEK_BASE_URL=https://relay.example/v1 DEEPSEEK_MODEL=deepseek-v4-flash BOCHA_API_KEY=... pnpm research "Research whether property tax can replace land finance" \
  --artifactDir artifacts/cli \
  --lang en
```

The terminal entry reads `AGENT_PROVIDER` from `.env.local` when `--llm` is omitted, falling back to BigModel GLM if no provider is configured. DeepSeek-compatible relays use `AGENT_PROVIDER=deepseek`, `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, and `DEEPSEEK_MODEL`. BigModel remains available with `AGENT_PROVIDER=bigmodel` or `--llm bigmodel`.
Progress events stream to stderr by default while the final JSON summary stays on stdout. Summary mode prints phase-level events. `--trace full` automatically switches live output to steps mode, which shows LLM thinking boundaries, search queries/results, source saves, evidence links, open gaps, and agent assessments. Pass `--stream transcript` to also print the visible LLM system/user/assistant transcript snippets for each agent call. Pass `--stream full` for lower-level KG/ledger/debug events, or `--no-stream` if you only want the final JSON.
DeepSeek-compatible transient retry count can be tuned with `DEEPSEEK_RETRY`; Bocha request timeout, retry count, and search result count can be tuned with `BOCHA_TIMEOUT_MS`, `BOCHA_RETRY`, and `BOCHA_COUNT`. Jina remains available only as an explicit fallback through `--search jina` or `FETCH_USE_JINA_READER=1`.

The default episode budget is intentionally bounded at an estimated `$5` and 2,000,000 total tokens. The example HTTP server applies a tighter `$2` / 750,000-token cap per run. These are framework-side estimates based on configured token prices, not a live provider-balance guarantee; set provider balance alerts and lower the server caps when operating from a small prepaid balance.

```bash
pnpm research "你的研究问题" \
  --artifactDir artifacts/real-run \
  --lang zh-CN
```

Run a local smoke episode with explicit deterministic test providers:

```bash
pnpm research "Research fixture evidence for v5 migration" \
  --llm echo \
  --search mock \
  --artifactDir artifacts/local-smoke \
  --cycles 1 \
  --lang en
```

Trace output is two-tiered:

- `trace.jsonl` is the summary trace: phase and agent lifecycle events only.
- `trace-full.jsonl` is written when `--trace full` is set and includes the summary events plus full LLM requests/responses, search requests/responses, KG/ledger writes, and artifact writes.

```bash
pnpm research "Research fixture evidence for v5 migration" \
  --llm echo \
  --search mock \
  --trace full \
  --artifactDir artifacts/full-trace-smoke \
  --cycles 1 \
  --lang en
```

Useful runtime switches:

- `--no-stream`: disable live terminal progress output.
- `--stream summary`: phase-level progress only.
- `--stream steps` or `--stream codex`: Codex-like step output with agent thinking/search/evidence summaries.
- `--stream transcript`: include visible LLM request/response snippets for each agent call. Backend frames are marked `kind: "transcript"` and include structured `messages` with `system`, `user`, and `assistant` roles so UIs can group/fold them per agent. This does not expose hidden model chain-of-thought.
- `--stream full`: include low-level KG, ledger, artifact, and debug trace events in the terminal.
- `--stream-max-chars 4000`: raise the transcript snippet limit per prompt/response block.
- `--cycles 1`: run one dispatch/reflection cycle for smoke testing. Omit this for a full research run.
- `--quality strict`: enforce source depth, independent-domain, authority, full-source inspection, and report citation-coverage thresholds. Default: `balanced`; use `advisory` for diagnostics-only runs.
- `--max-cost-usd`, `--max-llm-requests`, `--max-total-tokens`: enforce episode/provider ceilings and stop with a resumable audited failure.
- `--no-adaptive-budget`: disable plateau-based exploratory stopping without weakening hard provider or quality gates.
- `--resume artifacts/<episode>/checkpoints` or `--resume artifacts/<episode>/checkpoints/latest.json`: resume from the latest checkpoint after a failed run.
- `--review-response <response.json>`: apply structured decisions from `human-review.json` while resuming; requires `--resume`.
- `--checkpoint-dir <dir>`: write checkpoints to a specific directory.
- `--no-checkpoint`: disable automatic checkpoint snapshots.
- `BOCHA_TIMEOUT_MS=60000`: raise Bocha search timeout when the network is slow.
- `BOCHA_RETRY=2`: retry transient Bocha failures more times.
- `BOCHA_COUNT=10`: request more raw Bocha results before URL de-duplication.
- `DEEPSEEK_RETRY=5`: retry transient DeepSeek-compatible relay failures more times.
- `FETCH_MODE=fallback`: fetch origin sites directly first and degrade to Jina Reader on failure (timeout, HTTP errors, anti-bot walls). Other values: `direct` (default, origin only) and `jina` (reader only). Takes precedence over the legacy `FETCH_USE_JINA_READER=1` switch. The reader API key is only ever sent to the reader endpoint, never to origin sites.

Checkpoint snapshots are enabled by default. The runner writes JSON snapshots after rubric creation, root initialization, scout, main planning, dispatch cycles, structure review, and report drafting. A failed run also writes `last-error.json` next to `latest.json`. The snapshot contains the run state plus KG/ledger/memory data, so resume does not need to repeat completed planning or evidence work.

Checkpoint v3 uses atomic replacement, immutable checksummed event sidecars, bounded validation, and newest-valid fallback when `latest.json` or its event snapshot is damaged. Versions 1 and 2 remain readable. See [`docs/CHECKPOINT_RECOVERY.md`](docs/CHECKPOINT_RECOVERY.md).

```bash
pnpm research "你的研究问题" --trace full --lang zh-CN

# if it fails, resume from the latest checkpoint shown under the episode artifact directory
pnpm research --resume artifacts/<episode-id>/checkpoints --trace full --lang zh-CN
```

If the run returns `needs_human_review`, answer question IDs from `human-review.json` and pass the response during resume:

```bash
pnpm research \
  --resume artifacts/<episode-id>/checkpoints/latest.json \
  --review-response review-response.json \
  --quality strict \
  --lang zh-CN
```

The normalized decision is persisted as `human-review-response.json`. See [`docs/HUMAN_REVIEW.md`](docs/HUMAN_REVIEW.md) for the response schema and action semantics.

## Backend Integration

Application backends should use `runResearch` from `@deepresearch/orchestrator`. It creates the runtime profile, providers, orchestrator, trace handling, and final summary in one place. Stream frames are the same structured events used by the CLI and can be forwarded through SSE, WebSocket, or an application event bus.

```ts
import { runResearch } from "@deepresearch/orchestrator";

const { result, summary } = await runResearch({
  prompt: "你的研究问题",
  sessionId: "S_web_001",
  language: "zh-CN",
  citationRequired: true,
  artifactDir: "artifacts/web",
  streamMode: "transcript",
  streamMaxChars: 1200,
  signal: requestAbortController.signal,
  env: process.env,
  onFrame(frame) {
    sse.send(JSON.stringify(frame));
  },
});
```

For persisted jobs, inject SQLite-backed KG / ledger / memory implementations through `stack`. For stateless API requests or tests, omit `stack` and the in-memory defaults are used.

```ts
await runResearch({
  prompt,
  sessionId,
  llm,
  search,
  stack: { kg, ledger, memory, reporter },
  onEvent(event) {
    jobEvents.append(event);
  },
});
```

For a plain Node backend, `createResearchHttpHandler` gives you `GET /healthz`, `POST /research` as an SSE endpoint, run status, event replay, artifact reads, and cancellation endpoints:

```ts
import { createServer } from "node:http";
import { createResearchHttpHandler } from "@deepresearch/orchestrator";

createServer(createResearchHttpHandler({
  env: process.env,
  defaults: {
    artifactDir: "artifacts/server",
    language: "zh-CN",
    streamMode: "transcript",
  },
})).listen(8787);
```

Production or multi-worker backends should inject the WAL-backed run store so public `RUN_*` identifiers, statuses, replay frames, checkpoint mappings, and cancellation requests survive process restarts. Configure `apiToken`, request-rate/concurrency protection, and hard request caps before exposing the handler outside a trusted host:

```ts
import {
  createResearchHttpHandler,
  createSqliteResearchRunStore,
} from "@deepresearch/orchestrator";

const runStore = createSqliteResearchRunStore({
  dbPath: "artifacts/server/research-runs.sqlite",
});

createServer(createResearchHttpHandler({
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
})).listen(8787, "127.0.0.1");
```

SQLite runs in WAL mode with a busy timeout. Duplicate client-supplied run IDs return HTTP 409 instead of replacing an active record. Workers poll durable cancellation state while executing, and a stale `running` heartbeat is exposed as `interrupted`; resume from its persisted checkpoint rather than treating it as active. Episode IDs include a per-process nonce so concurrent workers cannot collide on an artifact directory. See [`docs/RUN_STORE.md`](docs/RUN_STORE.md) for recovery semantics and deployment boundaries.

For existing HTTP frameworks, use `streamResearchToSse` when the transport is Server-Sent Events:

```ts
import { streamResearchToSse } from "@deepresearch/orchestrator";

await streamResearchToSse(response, {
  prompt,
  sessionId,
  language: "zh-CN",
  streamMode: "transcript",
  signal: requestAbortController.signal,
  env: process.env,
});
```

`createResearchHttpHandler` parses JSON request bodies, validates `prompt`, maps safe request fields (`sessionId`, `language`, `maxCycles`, `traceLevel`, `streamMode`, budget controls, etc.), wires client disconnects to `AbortSignal`, and streams `run`, `frame`, `result`, and `error` SSE events. Resume requests may include `resumeCheckpointPath`/`resume` plus `humanReviewResponse`/`reviewResponse`; a review response without a checkpoint is rejected. The returned `runId` can be used with `GET /research/:runId`, `GET /research/:runId/events`, `GET /research/:runId/report`, `GET /research/:runId/evidence-index`, `GET /research/:runId/evidence-quality`, `GET /research/:runId/budget`, and `POST /research/:runId/cancel`. `streamResearchToSse` writes standard SSE headers and emits the same events for framework-specific handlers. Use lower-level `streamResearch` directly for WebSocket, queues, or custom event buses. `signal` is optional but recommended for backend deployments. Wire it to the HTTP request/client lifecycle so a disconnected browser or cancelled job stops pending LLM, Bocha search, and page fetches instead of waiting for their full timeout.

A dependency-free Node HTTP/SSE example is available at `examples/backend-sse-server.mjs`. From this workspace, run:

```bash
PORT=8787 DEEPSEEK_API_KEY=... BOCHA_API_KEY=... pnpm run server
```

Bocha remains the default search backend. For a keyless fallback or connectivity diagnosis, the CLI and backend API also accept `--search bing` / `searchProvider: "bing"`; set `BING_MARKET` when a locale other than `zh-CN` is required. Bing HTML search is less stable than a contracted API and should be exercised by the live stress gate before production use.

The Bing adapter resolves formal EU legal identifiers before general search: explicit CELEX IDs and `Regulation|Directive|Decision (EU) YYYY/NNNN` map directly to the canonical EUR-Lex text. This is identifier resolution, not task-specific answer data, and prevents Bing from misreading `EUR-Lex` as a currency query.

The example server binds only to `127.0.0.1` and uses `artifacts/server/research-runs.sqlite` by default. Override storage with `ARTIFACT_DIR` and `RUN_STORE_DB_PATH`. To expose it on another interface, set `HOST` and `SERVER_API_TOKEN`; the server refuses an unauthenticated non-loopback bind unless `ALLOW_UNAUTHENTICATED_PUBLIC=1` is explicitly set. The console asks for the token on the first 401 and keeps it in session storage.

Operational protection variables:

- `SERVER_MAX_STARTS_PER_MINUTE` (default `6`).
- `SERVER_MAX_CONCURRENT_RUNS` (default `2`).
- `SERVER_MAX_EPISODE_COST_USD` (default `2`).
- `SERVER_MAX_EPISODE_TOKENS` (default `750000`).
- `SERVER_MAX_LLM_REQUESTS` (default `350`).
- `SERVER_MAX_CYCLES` (default `48`).
- `SERVER_TRUST_PROXY=1` only behind a trusted reverse proxy.

Client-supplied artifact directories are ignored by default, and resume checkpoints must stay inside the configured artifact directory. `allowClientArtifactDir` and `allowExternalResumePath` are explicit trusted-deployment escape hatches.

`FetchPageProvider` rejects credentials in URLs, localhost/private/link-local/reserved IP space, hostnames resolving to non-public addresses, and redirects into those ranges. Direct undici requests revalidate DNS at the connection boundary and connect through the validated address, reducing DNS-rebinding exposure. It buffers at most 10 MB of HTML/reader text and 50 MB of PDF data by default, enforcing the text limit while streaming even when `Content-Length` is absent. A configured HTTP proxy or custom `fetchImpl` is a trusted transport boundary and must enforce equivalent destination policy itself. Trusted intranet-only deployments can opt into `allowPrivateNetwork`; never enable it for a service accepting untrusted prompts.

Image-only PDFs can use an opt-in OCR fallback. Set `FETCH_PDF_OCR=1` on hosts with `pdftoppm` and Tesseract installed; tune `FETCH_PDF_OCR_LANGUAGES` (for example `eng+chi_sim`), `FETCH_PDF_OCR_MAX_PAGES` (default `12`), and `FETCH_PDF_OCR_TIMEOUT_MS` (default `120000`). OCR runs only when the embedded text layer is substantively empty, inherits the PDF byte limit, uses argument-safe child processes, stops on cancellation/timeout, and deletes its temporary raster files. Keep it disabled in sandboxes that do not trust their native PDF/OCR toolchain.

Semantic publication review can use an independent model provider. Set `PUBLISH_REVIEW_PROVIDER=bigmodel|deepseek|openai|custom` and provide that provider's normal API credentials, or inject `reviewLlm` in `ResearchRunInput`/`EpisodeStack`. `PUBLISH_REVIEW_MODEL` selects a reviewer-specific model (for example `deepseek-reasoner`) without changing the writer. Only the semantic publish judgment uses this channel; report rewriting remains on the primary writer model. Reviewer calls retain the same budget enforcement and are attributed to a distinct `review:<provider>:<model>` identity in full traces and budget audits.

Then open `http://localhost:8787/console` for the built-in DeepResearch Agent Console. It shows main-agent and sub-agent clusters, expandable thinking/tool/transcript details, writer/gate events, replay, cancellation, and final report preview using the same `VisualResearchEvent` frames exposed by the backend API. `/` serves the same console; `/ui` keeps the older lightweight page.

In a downstream app, install `@deepresearch/orchestrator` and use `createResearchHttpHandler` directly or copy the example entrypoint into that app.

Then call:

```bash
curl -N http://localhost:8787/research \
  -H 'content-type: application/json' \
  -d '{"prompt":"帮我做一份研究马克思主义在中国的发展路线的研究","language":"zh-CN","streamMode":"transcript","maxCycles":1}'
```

For container deployment from this monorepo, use `Dockerfile.backend`:

```bash
docker build -f Dockerfile.backend -t deepresearch-backend:local .
docker run --rm -p 8787:8787 \
  -e BIGMODEL_API_KEY=... \
  -e BOCHA_API_KEY=... \
  deepresearch-backend:local
```

The backend container exposes the DeepResearch Console at `/`, `GET /healthz`, `POST /research`, `GET /research/:runId`, `GET /research/:runId/events`, `GET /research/:runId/report`, `GET /research/:runId/evidence-index`, `GET /research/:runId/evidence-quality`, and `POST /research/:runId/cancel`. The runtime entrypoint uses the real BigModel GLM + Bocha providers by default. Local smoke-only providers and DeepSeek remain explicit CLI/API choices and are not used unless you pass/inject them.

## Packaging

Packages publish from `dist`, not TypeScript source. Build before packaging:

```bash
pnpm build
pnpm package:check
pnpm package:pack
```

`pnpm package:pack` writes tarballs to `artifacts/packages` and uses `pnpm pack` so internal `workspace:*` dependencies are converted to package versions in the tarball manifest. Do not use `npm pack` directly for workspace packages; it does not rewrite `workspace:*` dependencies.

Before handing the packages to a backend application or private registry, run the installed-package smoke:

```bash
pnpm package:verify
```

`package:verify` rebuilds, repacks, creates a temporary downstream application, installs all generated tarballs through `file:` dependencies with pnpm overrides, then verifies both packaged backend imports (`runResearch` / `streamResearch`) and the packaged `deepresearch` CLI binary. Use `KEEP_PACKAGE_SMOKE_DIR=1 pnpm package:verify` when you need to inspect the temporary app after a failure.

The orchestrator package also exposes a CLI binary after packaging:

```bash
deepresearch "你的研究问题" --stream steps --lang zh-CN
```

## API Smoke

`packages/orchestrator/src/tests/deepseek.live.spec.ts` contains real API block tests. These are intentionally opt-in so normal `pnpm test` does not spend money or depend on the network. Keys are read from the environment only and must not be committed.

```bash
# Real DeepSeek block tests: planner schemas, EvidenceAgent AgentRuntime, reflection/structure, writer/publish review.
DEEPSEEK_API_KEY=... DEEPSEEK_LIVE_SMOKE=1 pnpm --filter @deepresearch/orchestrator test -- src/tests/deepseek.live.spec.ts

# Real Bocha search provider test.
BOCHA_API_KEY=... BOCHA_LIVE_SMOKE=1 pnpm --filter @deepresearch/orchestrator test -- src/tests/deepseek.live.spec.ts

# Optional Jina search + reader fallback test.
JINA_API_KEY=... JINA_LIVE_SMOKE=1 pnpm --filter @deepresearch/orchestrator test -- src/tests/deepseek.live.spec.ts

# Optional full live episode. Slower and more expensive; use only when validating the whole backend path.
DEEPSEEK_API_KEY=... BOCHA_API_KEY=... DEEPRESEARCH_LIVE_E2E=1 pnpm --filter @deepresearch/orchestrator test -- src/tests/deepseek.live.spec.ts
```

## v5 Invariants

- Report-to-knowledge binding uses only `EvidenceLink`.
- Reporter consumes only `ReportBundle`.
- MemoryGraph stores events and trace only.
- `ContextPacket` is assembled explicitly by `packages/orchestrator/src/context-builder.ts`.
- Agent outputs use unified `AgentRunResult`.
- Structure review only accepts `StructurePatch` ops from `packages/contracts/src/patch.ts`.
