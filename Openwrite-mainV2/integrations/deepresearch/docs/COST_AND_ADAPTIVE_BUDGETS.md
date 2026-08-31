# Cost accounting and adaptive research budgets

The framework enforces episode-wide provider budgets in addition to each agent's local ReAct limits. Every real LLM, search, and uncached fetch request passes through one shared usage ledger. Cache hits and rejected URLs do not consume provider request budget.

Each completed or budget-exhausted episode writes `budget-audit.json`. The Node backend exposes the same artifact at `GET /research/:runId/budget`.

## Provider limits

Limits live in `RuntimeProfile.providers`. Resolution is operation-aware:

1. `<operation>:<provider-name>` such as `llm:deepseek`.
2. Exact `<provider-name>`.
3. `default_llm`, `default_search`, or `default_fetch`.
4. `episode` is also checked against aggregate requests, tokens, and estimated cost.

```json
{
  "providers": {
    "llm:deepseek": {
      "maxRequests": 500,
      "maxTotalTokens": 2000000,
      "maxCostUsd": 8,
      "inputCostPerMillionTokensUsd": 0.28,
      "outputCostPerMillionTokensUsd": 0.42
    },
    "default_search": {
      "maxRequests": 300,
      "costPerRequestUsd": 0.01
    },
    "default_fetch": { "maxRequests": 1000 },
    "episode": {
      "maxRequests": 3000,
      "maxTotalTokens": 3000000,
      "maxCostUsd": 12
    }
  }
}
```

Supported limits are `maxRequests`, `maxInputTokens`, `maxOutputTokens`, `maxTotalTokens`, and `maxCostUsd`. Cost is an estimate derived from configured per-million token prices and per-request prices. Provider-reported token usage is preferred; when usage is absent, the ledger records a conservative character-based estimate and increments `estimatedTokenRequests`.

The guard checks a limit before every request. The request that reaches a threshold completes and records the exhausted threshold; the next request is blocked. A blocked run returns a normal `EpisodeResult` with `status: "failed"`, `budget-exhausted.md`, `budget-audit.json`, trace files, and the latest stable checkpoint. Resume with explicitly increased limits; quality gates are never force-passed because money ran out.

Temporal decomposition is budget-aware rather than open-ended. For annual-series and long event-timeline leaves, the evidence-agent ceiling grows only with the bounded number of planned reportlets: at least one search slot per window and up to two fetch slots per window. The task still remains under the episode/provider ledgers, and a single ordered agent produces all parts so the framework avoids spawning a separate branch and repeating shared context for every period.

Hard literature-publication windows are also applied before search: deterministic authority queries and otherwise broad planned/fallback scout queries share the same date qualifier when the cutoff is global. This reduces post-cutoff result churn; the evidence gate still verifies source-visible publication dates because search operators alone are not treated as proof.

Month-level availability cutoffs use the same early filtering. Exclusive boundaries are converted to the preceding calendar day before query generation, including leap years, so “before March” produces `before:YYYY-03-01` rather than an imprecise year-wide search. This avoids fetching and later rejecting an entire month of ineligible results.

When a user names a required source outside that boundary, scout reserves one early query combining its localized title, official-title aliases, and stable identifiers without the date operator. Regular authority, planned, and fallback queries remain bounded, so one exception does not reopen the search space or create repeated post-cutoff fetch churn.

Wide entity matrices do not increase the initial scout ceiling. Their authority queries are interleaved across requirements, and at most two existing slots are reserved for planned/fallback breadth when competition exists. This prevents a long first matrix from wasting the whole source-map budget while preserving the same total number of provider calls.

Named entity tables and repeated case/category profiles use the same bounded approach. Ordinary rows/profiles target roughly one search per two entities and one fetch per entity, counted from the actual instructions even when several are grouped because of a part limit. A compound detail-section plus summary-table entity targets one search and up to two fetches so its narrative can cover mechanisms, examples, measurements, and challenges with corroboration; the same evidence is reused for the table instead of paying for separate row and prose agents. One leaf agent shares context and sources across its entities, and hard episode/provider ceilings still apply before every request.

An open taxonomy category is neither one row nor an unbounded per-member fan-out. It receives one category leaf with a target of one focused search and two full-source fetches. That leaf discovers and deduplicates members, completes their rows together, and writes one reusable category reportlet. This preserves breadth without guessing a member count or creating an agent for every item found.

Convenience overrides:

```bash
pnpm research "..." \
  --max-cost-usd 10 \
  --max-llm-requests 400 \
  --max-total-tokens 2500000
```

The TypeScript/HTTP fields are `maxEpisodeCostUsd`, `maxLlmRequests`, and `maxEpisodeTokens`. HTTP also accepts `maxCostUsd` and `maxTotalTokens` aliases.

## Adaptive stopping

`RuntimeProfile.adaptiveBudget` detects a plateau over recent dispatch cycles using:

- new knowledge nodes;
- new evidence links;
- completed tasks;
- evidence-quality score improvement;
- newly covered must requirements;
- reduced active quality errors.

Plateau detection alone cannot stop research. The deterministic guard additionally requires:

- zero active evidence-quality errors;
- every must requirement covered or explicitly waived;
- no medium/high open gap;
- no blocking hypothesis status;
- no queued completion, publish, writer, human-review, or other repair task.

Only remaining exploratory tasks are cancelled. If any quality or repair condition is unresolved, the framework emits `adaptive_budget_plateau_deferred` and continues. A successful stop emits `adaptive_budget_stopped`, records cancelled task IDs, and appears in the budget audit and episode metrics.

Disable adaptive stopping without disabling hard provider budgets:

```bash
pnpm research "..." --no-adaptive-budget
```

TypeScript and HTTP use `adaptiveBudget: false`.

## Audit shape

`budget-audit.json` contains:

- resolved provider limits;
- per-operation/provider request, success, failure, token, estimation, and cost totals;
- episode totals;
- threshold breaches with phase and timestamp;
- per-cycle marginal gains;
- the adaptive-stop decision, reason, cycle, and cancelled task IDs.

The estimates are operational controls, not billing invoices. Reconcile actual invoices using provider billing exports when exact accounting is required.
