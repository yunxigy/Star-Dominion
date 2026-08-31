# DeepResearch Bench II optimization loop

DeepResearch Bench II is the primary external quality signal for framework optimization. Architecture documents are guidance, not the objective: an implementation change is valuable when it improves research recall, analysis, presentation, usability, recovery, speed, or error rate while preserving the core top-down search and bottom-up writing model.

The official benchmark contains 132 tasks and 9,430 atomic rubrics across three dimensions:

- Information Recall: find, verify, and cover the necessary facts.
- Analysis: connect evidence into mechanisms, comparisons, and conclusions.
- Presentation: produce a structured, readable, verifiable report.

The public leaderboard reports rubric pass rates. A one-task random run is a fast development signal, not a directly comparable leaderboard submission.

## Fast random run

The default is intentionally one random task. Running all 132 tasks requires explicit `--all`.

```bash
# Inspect the randomly selected task without spending model/search budget.
pnpm bench:drb2 -- --select-only

# Generate one randomly selected report.
pnpm bench:drb2 -- --name local-baseline --maxUsd 5 --maxRounds 2
```

The command downloads the official dataset into the ignored artifact cache when it is not already present. It prints and records the random seed. Reuse that seed for an A/B comparison:

```bash
pnpm bench:drb2 -- --seed 92cc7e74a61d5f0a --name before
# change the framework
pnpm bench:drb2 -- --seed 92cc7e74a61d5f0a --name after
```

Other selection modes:

```bash
pnpm bench:drb2 -- --sample 3
pnpm bench:drb2 -- --ids 7,42
pnpm bench:drb2 -- --all
```

The runner loads `.env.local` or `.env` from the repository as defaults; variables set explicitly in the shell take precedence. When multiple search APIs are configured, it tries them sequentially and stops at the first non-empty result. The default order is Bocha, Brave, Jina, then explicitly enabled Bing. Override it without changing code:

```bash
BENCH_SEARCH_ORDER=jina,bocha,brave pnpm bench:drb2 -- --seed 92cc7e74a61d5f0a
```

Evidence agents keep the newest tool observation plus compact summaries and source IDs from older steps instead of replaying full pages. Named matrices use explicit entity and field scopes: counted original lists are restored, mapped away from aggregate siblings, expanded into entity-specific scout queries, and batched from declared scope. Explicit dual-perspective clauses are also recovered when the rubric model compresses them: one wide leaf becomes two focused siblings under the same parent requirement, and bottom-up writing performs the requested comparison only after both reportlets exist. This improves nuanced historical, policy, risk/benefit, and mechanism/countermechanism prompts without hard-coding benchmark conclusions. Agents still produce complete rows/profiles and completion audits structured cells. Table schemas, category groups, multi-table counts, study minima, named H2 contracts, per-section bullets, temporal bounds, and narrow source exceptions continue through organization and publication. Initial authority queries remain round-robin with bounded broad coverage. The benchmark default remains 12 ReAct turns per leaf and a 32,000-character history ceiling; use `--maxSubAgentTurns` or `--subAgentContextMaxChars` for controlled experiments.

Random task rounds can also expose analysis-error risks rather than only retrieval gaps. A distribution-analysis task selected with seed `402cef9e7498d3cf` required repeated Atkinson, Hoover, and Theil derivations from sourced entity arrays. The general fix is a deterministic, validated evidence tool—not benchmark answer data: agents pass exact saved-source inputs, receive auditable normalized shares and indices, cite the input evidence, and leave missing values unresolved. This reduces silent arithmetic variation across annual series while remaining reusable for unrelated geographic, market, demographic, or ecological distributions.

A later random round selected task 118 with seed `cc64660afb0fe38d`. Its four analytical sections each contain several mandatory named narratives, exposing a different general failure mode: a model can preserve the broad section while silently omitting one required case. The framework now separates `exampleScope` from table/profile entities, plans each required example as an internal cited reportlet, audits exact missing names, and generates focused repairs. No biblical conclusion or benchmark answer is encoded; the same contract applies to named legal cases, historical incidents, clinical examples, literary figures, and other narrative evidence sets.

The next random round selected task 107 with seed `5987ef25db992260`. It repeats one five-city scope across two independent matrices and declares another ten-member scope inside parentheses, revealing that prefix-only list recovery is insufficient. Counted-scope normalization now supports postpositive and parenthetical forms, validates declared counts, maps repeated identical lists without feedback from earlier generated criteria, and makes structured member scopes trigger per-member scout queries even without generic “official” keywords. The change contains no rail-transit values or benchmark answers and applies to any count-validated city, system, product, technology, material, or other structured member list.

The random round with seed `81ab35390906703e` selected task 13, whose PET prompt contains a four-stage outline and then restarts numbering for six clinical applications, with three shared fields required for every item. This exposed a general structural loss: preserving only the first 1…N sequence lets a later nested outline collapse into prose. The framework now recovers each explicitly introduced bold-headed group independently, binds shared per-item dimensions, plans one bounded entity-field reportlet per item, and blocks publication when an item subsection is absent. The implementation contains no PET conclusions or benchmark answer data and applies to any prompt with separately restarted workflow, scenario, task, or section outlines.

The next random round used seed `88f875152ccc8d86` and selected task 89 (index 101), a game-design-methodology prompt with four named main parts, three required child categories under only the second part, and a Chinese `2021年中期之前` cutoff. It exposed three reusable gaps: task-style “整理以下几块内容” wording did not create an H2 contract, indented child headings had no parent-aware evidence/render trace, and `中期之前` was not normalized as an exclusive qualified boundary. The framework now restores the four H2 names, gives every bold child topic focused cited ownership without cannibalizing its broad parent, requires each H3-or-deeper heading inside the correct H2, and resolves the exclusive cutoff to May 31. No game-design facts, names, or benchmark conclusions are encoded in runtime logic.

The round with seed `c4ab291158473ae8` selected task 70 (index 51), a ten-entity web-framework matrix with numbered fields, nested security dimensions, and two language-based output tables. It exposed a cross-phase conservation gap: dots inside names truncated counted scope recovery, two table blocks did not prove complete or unique entity placement, and a generic Security field could hide five independently scored cells. The framework now preserves dotted names, restores explicit comparison/security dimensions, makes each entity reportlet choose one cited named partition, and rejects missing, duplicated, or unlabeled partition rows. Runtime logic contains no framework values or category membership; it enforces only user-declared fields, labels, and entity conservation.

## Resume a failed generation

Recoverable failures include a ready-to-run command in their episode `failure.json`. The equivalent manual command is:

```bash
pnpm bench:drb2 -- --resume artifacts/benchmark-traces/deepresearch-bench-ii/<run>/<episode>/checkpoints/latest.json
```

The benchmark runner reads the checkpoint and original `benchmark-run.json`, then automatically restores the task index, episode identity, dataset path, model label, trace root, output directories, and generation budgets. It resumes exactly one task with the task-specific blocked-source filters still active. You may explicitly override a budget flag such as `--maxRounds`, but `--ids` is unnecessary and must match the checkpoint when supplied. When the checkpoint has already consumed all configured evidence cycles, the CLI prints the minimum `--maxRounds` needed to authorize more research instead of silently spending more.

Resume writes a new `benchmark-resume-<timestamp>.json` and archives the previous `failure.json`/`failures.json` before execution. The original run manifest remains unchanged. Completed planning, evidence, fetch cache, reportlets, and writer work remain in the same episode artifact directory and are reused.

## Official rubric evaluation

The repository integrates the official `imlrz/DeepResearch-Bench-II` evaluator. Configure its Gemini-compatible judge and add `--evaluate`:

```bash
GEMINI_API_URL=... \
GEMINI_API_TOKEN=... \
GEMINI_MODEL=... \
pnpm bench:drb2 -- --seed 92cc7e74a61d5f0a --name after --evaluate
```

If needed, the runner bootstraps the official evaluator into the ignored benchmark cache. You can instead pass an existing checkout with `--evaluatorRoot`.

Scores are not fabricated when judge credentials are absent. Without `--evaluate`, the run is marked `not_requested`; requesting evaluation without credentials fails explicitly. A random subset scored with a locally configured judge is recorded as not directly leaderboard-comparable even though it uses the official evaluator code.

## Artifact contract

Each run has an isolated trace root containing:

- `benchmark-run.json`: selection, seed, dataset hash, runtime configuration, duration, provider metrics, failures, score, and previous same-task delta;
- `official-input/<model>/idx-<n>.md`: report layout and filename accepted by the official evaluator;
- `official-evaluation.jsonl`: raw official rubric decisions when evaluated;
- `official-score.json`: per-task and aggregate Information Recall, Analysis, Presentation, total pass rate, and blocked-reference rate;
- episode trace directories, evidence-quality audits, budget audits, and checkpoints.

Only an episode whose framework status is `succeeded` becomes official evaluator input. Budget exhaustion, a human-review pause, or any other non-success status is recorded as a failed unresolved task; placeholder/recovery reports are never emitted as `idx-<n>.md`.

The benchmark profile keeps `hilMode="explicit"` so genuine preference and non-waivable integrity decisions remain inspectable. Routine evidence scarcity is nevertheless handled by the balanced completion disposition policy: unsupported branches may be omitted, partial branches qualified, and unmet degradable minima reported as achieved N-of-M coverage. These decisions are recorded in the episode evidence audit and `publication-warnings.json`; they do not weaken blocked-source filtering or citation-integrity gates.

A global ignored history is appended at `artifacts/benchmark-history/deepresearch-bench-ii.jsonl`. Comparisons are made only against the same model label and exact task set.

Every run records the SHA-256 hash of `tasks_and_rubrics.jsonl`; results from different dataset revisions should not be treated as a controlled A/B pair.

## Benchmark fairness and safety

Each task forbids the expert article used to derive its rubric. The adapter:

- uses the clean `content.task` instead of duplicating the wrapper prompt;
- filters forbidden URLs and titles from search results;
- rejects forbidden URLs before page fetch;
- rejects blocked redirects/titles before sources can be saved;
- supplies a real fetch provider so the framework can inspect full pages instead of relying only on snippets.

The deterministic internal evidence-quality gate remains useful for debugging, but its score is not a substitute for the benchmark rubric score.

## Interpreting random results

Use random one-task runs to discover errors cheaply. Use the same seed before and after a change to measure causality. A change should normally be retained only when it improves or preserves the official rubric score while also checking runtime duration, request/token cost, recovery behavior, and failures. Periodically run a larger fixed sample; use all 132 tasks and the benchmark's stated judge conditions for leaderboard-level claims.
