# DeepResearch Framework Architecture

This repository is a TypeScript/pnpm monorepo for a deep research pipeline. The
current code keeps the v5 report-tree / knowledge-graph / task-ledger
invariants, and adds v6 agent runtime, ToolRegistry, streaming backend,
checkpoint resume, and example UI surfaces.

## Workspace Layout

```text
deepresearch-framework/
  configs/runtime/default.json      RuntimeProfile defaults
  examples/backend-sse-server.mjs   Minimal HTTP/SSE backend
  packages/
    contracts/                      Shared public interfaces and types
    net-utils/                      Shared network helpers (abort/sleep, fetch errors, proxy, undici fetch)
    orchestrator/                   v5 phase runner, CLI, backend API, SSE
    knowledge-graph/                ReportNode, KnowledgeNode, EvidenceLink storage
    task-ledger/                    Task queue and state transitions
    memory-graph/                   Event and trace storage
    report-evaluator/               Deterministic ReportBundle reporter fallback
    embedding-providers/            DeepSeek/OpenAI-compatible chat and embeddings
    search-providers/               Search providers, normalization, source policy
    tool-providers/                 Search/fetch/user-file tool providers
    benchmark-adapters/             Optional benchmark adapters
    calibration/                    Post-run calibration metrics
    testing/                        In-memory test stack helpers
  scripts/                          Packaging and smoke-check helpers
```

Generated directories such as `dist/`, `node_modules/`, `artifacts/`, coverage
output, local `.env*` files, and temporary SQLite/databases are intentionally
ignored and should not be committed.

## Core Runtime Model

The runtime entrypoint accepts a `TaskSubmission` and a complete
`RuntimeProfile`. The main public surfaces are:

- CLI: `pnpm research "..."`.
- Backend API: `runResearch`, `streamResearch`, `createResearchHttpHandler`.
- Orchestrator: `createInMemoryOrchestrator` or `createSqliteOrchestrator`.

The high-level runtime flow is:

```text
TaskSubmission
  -> parse
  -> rubric
  -> init-root
  -> scout
  -> architect-tree
  -> dispatch-evidence <-> cycle-reflection
  -> structure-review
  -> completion-gate
  -> report
  -> publish-gate
  -> artifacts/report.md + evidence-index.json + evidence-quality-audit.json + optional publication-warnings.json + trace.jsonl
```

## Data Model

The v5 data model is intentionally narrow:

- `ReportNode`: root/aspect/hypothesis nodes that form the report tree.
- `TaskItem`: ledger entries attached to report nodes.
- `KnowledgeNode`: normalized source records with summaries and source metadata.
- `EvidenceLink`: support/contradiction/mention links from sources to report nodes.
- `ResearchRequirement`: a stable, testable user obligation mapped through `ReportNode.requirementIds`, with orthogonal `failurePolicy=degrade|block` and `visibility=reader|internal` policies.
- `OpenGap`: explicit unresolved evidence gaps.
- `MemoryEvent`: summary and full trace events.
- `ReportBundle`: the assembled tree/evidence/gap payload used by report writing.

`contracts` owns these public types. Implementation packages depend on
`contracts`; generated `dist/` outputs are required for package exports, so the
root `pnpm test` and `pnpm typecheck` scripts build the workspace first.

## Orchestrator Phases

The orchestrator package keeps each pipeline step in `src/phases/`:

- `parse.ts`: produces the initial normalized task submission payload.
- `rubric.ts`: creates the global rubric and output hints, preserves exact temporal endpoints (including exclusive Chinese `年中期之前` wording), and conservatively restores omitted numbered tasks, separately restarted bold-headed outlines plus shared per-item fields, indented bold child topics as focused evidence requirements and parent-bound subsection contracts, prefix/postpositive/parenthetical counted named-entity lists with count validation (without splitting dotted names), numbered comparison dimensions and security subfields, named table partitions, mandatory named narrative examples, explicit two-sided analytical perspectives, ordered top-level section contracts, one unambiguous table schema plus its discovery groups, and positively required quoted sources beyond a global cutoff.
- `init-root.ts`: creates `R_root` and the root task.
- `scout.ts`: performs broad initial source discovery with exact-exception priority, requirement-round-robin authority allocation, automatic per-member queries for explicit structured scopes, bounded planned/fallback coverage, two-sided source-publication query operators, and operator-free covered-period qualifiers.
- `architect-tree.ts`: creates top-level aspects and hypotheses, using declared member `entityScope` for bounded wide-matrix groups and recovered paired perspectives for focused sibling evidence leaves even when the model initially emits one coarse leaf.
- `dispatch-evidence.ts`: runs evidence agents in parallel, isolates failures, and decomposes long annual series, event timelines, mandatory narrative examples, named comparison tables, repeated profiles, or recovered outline items into bounded leaf reportlets; every outline item carries the same explicit per-item dimensions and receives a runtime budget scaled by reportlet count. A partitioned comparison adds one evidence-backed partition decision to each entity reportlet without changing the user-requested table columns. Named examples stay inside the owning leaf and receive distinct cited analysis rather than table-row semantics. Compatible entity matrices share evidence while independent matrices remain field-isolated before bottom-up merging. Evidence leaves can invoke a deterministic Atkinson/Hoover/Theil calculator over exact sourced arrays, while citations remain attached to those external inputs rather than to the calculation itself.
- `cycle-reflection.ts`: reuses saved evidence, creates bounded repair/gap tasks, and accepts structured `qualify|omit` recommendations only when the agent marks the narrower claim safe without the missing fact.
- `structure-review.ts`: applies conservative v5 tree/evidence patches.
- `completion-gate.ts`: blocks during repair passes; after repair exhaustion, balanced/advisory mode automatically downplays unsupported leaves, qualifies partially evidenced leaves, and creates framework-owned audit waivers. Strict mode and `failurePolicy=block` remain non-skippable.
- `report.ts`: writes leaf-first report drafts, section overviews, summary, and conclusion; an explicit exact-N or consecutive numbered-list top-level section contract, resolved in favor of a longer complete First/Second/Finally-style substantive sequence when the prompt contradicts itself, or a user-owned final conclusion aspect, causes root synthesis to merge into the final section instead of creating extra peer sections. It then deterministically checks final H2 count/name/order, parent-bound named H3-or-deeper subsections, per-named-section bullet lists, explicit multi-table counts, recovered exact header order, member-row coverage, named partition labels, cross-partition omissions/duplicates, required tables/lists, and non-empty case/category/recovered-outline sections—including compound and counted-study contracts—before accepting organizer output.
- `evidence-quality.ts`: audits evidence depth, source independence/authority, requirement coverage (including numeric or categorical entity-field and entity-year-field cells, plus substantive open-taxonomy group coverage), exact month/day/qualified-year source-publication eligibility versus covered-period freshness, named temporal exceptions, conflict consistency, fetched-content inspection, and sentence-level citation coverage; narrative date/geography scopes and discovery-group labels are kept out of structured value matrices.
- `human-review-response.ts`: validates decisions against the authoritative review artifact, creates approved repair tasks or scoped waivers, and records the response audit trail before checkpoint resume.
- `sqlite-run-store.ts`: WAL-backed durable HTTP run metadata, bounded replay events/frames, stable run-to-episode mapping, heartbeat recovery, and cross-worker cancellation state.
- `budget.ts`: episode-wide provider usage/cost accounting, hard-limit enforcement, marginal cycle-gain measurement, quality-protected adaptive stopping, and `budget-audit.json` generation.
- `publish-gate.ts`: validates citations, evidence quality, truncation, repeated H2 conclusion blocks, nested H3 synthesis conclusions, unresolved gaps, rendered deliverable contracts, and exact main-section counts/names/order; pure render defects are not redispatched as evidence searches or force-published. Only a semantic-reviewer outage may publish with an error warning; citation and content-integrity failures remain blocking.

Full trace events are emitted through `trace.ts` and rendered for CLI/SSE through
`stream-renderer.ts`.

## Report Writing

Report generation is leaf-first when `phases.report.maxLlmCalls` can cover the
planned leaves and section overviews:

1. Every non-pruned leaf report node gets a `report.leaf` draft.
2. Each top-level aspect gets a `report.section` overview.
3. The ordinary final report is assembled as:
   `title + executive summary + section overview + leaf drafts + conclusion`.
   If the task explicitly requests exactly N top-level parts, or declares
   “the following parts” with a consecutive 1…N list, and N aspect drafts exist—or
   the final user aspect is explicitly `Conclusion`/`结论`—the summary is demoted
   to a non-H2 introduction and root synthesis is appended inside the final
   aspect as an H3. Minimum-only wording such as “at least N” is not fixed.
   Later organizer repairs must also preserve those N H2 headings: ancillary
   tables and lists use H3, while reference/bibliography headings are not counted.
4. `publish-gate` blocks reports that are truncated, template-completed,
   duplicate-concluded, shallow for the researched tree, or citation-invalid.

This makes the smallest report nodes structurally present in the final report
instead of relying on a final whole-report rewrite.

## Providers

The default CLI/backend providers are real:

- LLM: DeepSeek via `DEEPSEEK_API_KEY`.
- Search: Bocha via `BOCHA_API_KEY`.
- Fetch: direct `fetch-page` by default; `FETCH_MODE=jina` routes everything through Jina Reader, and `FETCH_MODE=fallback` fetches origins first and degrades to Jina Reader on failure (legacy switch: `FETCH_USE_JINA_READER=1`).

Explicit local-only smoke providers are still available:

```bash
pnpm research "fixture task" --llm echo --search mock --cycles 1
```

Environment variables should be kept in `.env.local`, copied from
`.env.example`. Do not commit `.env.local` or real API keys.

## Tests And Verification

Recommended clean-checkout verification:

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm package:check
```

The root `test` and `typecheck` scripts build first so packages can resolve each
other through their `dist` exports. Live DeepSeek prompt-schema tests are gated
behind `DEEPSEEK_API_KEY` and `DEEPSEEK_LIVE_SMOKE=1`.

## Packaging

Packages publish from `dist/`. Use:

```bash
pnpm package:verify
```

This builds, checks package readiness, packs workspace packages, creates a
temporary downstream app, installs the tarballs, and smoke-tests packaged API and
CLI imports.
