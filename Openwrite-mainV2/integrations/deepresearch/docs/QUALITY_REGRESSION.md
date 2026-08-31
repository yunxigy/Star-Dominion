# Artifact-level quality regression

The quality regression gate turns persisted research audits into deterministic CI assertions. It detects quality, requirement-traceability, citation-grounding, waiver-scope, and budget regressions without rerunning a live model or search provider.

## Run the gate

From the repository root:

```bash
pnpm quality:regression
```

The command reads `configs/regression/quality-regression.json`, prints one `PASS` or `FAIL` line per case, and writes the complete machine-readable result to `artifacts/quality-regression/results.json`. Any failed case sets a non-zero exit code, so CI can invoke this command directly.

Custom paths are supported:

```bash
pnpm --filter @deepresearch/benchmark-adapters quality-regression -- \
  --manifest configs/regression/quality-regression.json \
  --output artifacts/quality-regression/results.json
```

## Manifest model

The version 1 manifest supports two case types:

- `cases` are compact declarative fixtures. The evaluator builds a `ReportBundle`, runs the production `auditEvidenceQuality` implementation, and checks the resulting audit.
- `artifactCases` point at an episode artifact directory containing `evidence-quality-audit.json` and, when budget assertions are used, `budget-audit.json`.

Expectations can constrain:

- minimum or maximum evidence score;
- exact or maximum active error count;
- required, forbidden, or waived issue codes;
- per-requirement coverage status;
- minimum sentence-level citation coverage;
- maximum uncited quantitative/date claims;
- request, token, estimated-cost, breach, and adaptive-stop budget values.

The repository baseline also protects scope semantics: dated study corpora and narrative geographic overviews must stay out of structured value matrices, explicit numeric and categorical table fixtures exercise exact entity-field cell auditing, open-taxonomy groups require substantive cited category coverage without becoming fake group-field rows, March 1 must fail a boundary stated as “before March,” a later retrospective paper must fail a hard source-publication cutoff, and one exact user-named later report may pass without admitting unnamed later sources.

Case IDs must be unique across both case types. Unsupported manifest versions, malformed JSON, and duplicate IDs fail immediately. A missing optional `budget-audit.json` is reported as a case failure when the case declares budget expectations; malformed audit JSON is not silently ignored.

## Add a real episode baseline

Copy or retain the episode's audit files under a stable repository fixture directory, then add an artifact case using a path relative to the manifest:

```json
{
  "artifactCases": [
    {
      "id": "representative_policy_report",
      "description": "A representative completed policy report stays grounded and within budget.",
      "artifactDir": "./artifacts/representative-policy-report",
      "expect": {
        "minScore": 90,
        "maxActiveErrorCount": 0,
        "minCitationCoverage": 0.9,
        "maxUncitedQuantitativeClaims": 0,
        "budget": {
          "maxRequests": 100,
          "maxTotalTokens": 120000,
          "maxEstimatedCostUsd": 3,
          "maxBreaches": 0
        }
      }
    }
  ]
}
```

Commit only stable, scrubbed audit artifacts; do not commit credentials, raw provider transcripts, or unrelated episode files. Use thresholds that encode an intentional quality floor. Avoid lowering a threshold merely to accept a newly failing run—first inspect the case's `observed` values and issue codes in the result JSON.

## Benchmark integration

`runBenchmarkAdapter` always preserves `evidence-quality-audit.json` and `budget-audit.json` in each task trace directory when the orchestrator produced them. It also writes per-attempt `failure.json` files and a trace-root `failures.json` aggregate.

Callers can additionally set `qualityExpectation` to one expectation object or a task-dependent function. The runner evaluates the just-produced audit before rendering benchmark output; a failed expectation becomes a structured benchmark failure instead of a console-only error.

```ts
await runBenchmarkAdapter({
  // normal benchmark options...
  qualityExpectation: (task) => ({
    minScore: task.isHighRisk ? 95 : 85,
    maxActiveErrorCount: 0,
    minCitationCoverage: 0.9,
  }),
});
```

This per-run gate is useful for benchmark execution. The repository manifest remains the fast, provider-independent CI gate.
