# Human review response and resume

Human interaction mode and evidence disposition are intentionally separate. In balanced/advisory quality mode, bounded repair exhaustion normally produces automatic `qualify` or `omit` dispositions even when `hilMode="explicit"`. The orchestrator returns `status: "needs_human_review"` only when strict mode, a structured non-waivable requirement, citation/content integrity, or a genuine user preference prevents safe completion.

When such a run cannot safely finish, the orchestrator writes:

- `human-review.json`: the authoritative questions and their stable IDs.
- `checkpoints/latest.json`: the resumable execution state.
- `incomplete-report.md` or the current report artifact: a readable explanation of the unresolved decision.

Human answers are executable decisions, not free-form notes. Submit a JSON document with one or more decisions:

```json
{
  "submittedBy": "reviewer@example.com",
  "decisions": [
    {
      "questionId": "quality_1",
      "action": "continue_research",
      "rationale": "Use the regulator's newly released dataset.",
      "sourceUrls": ["https://regulator.example/data/latest"]
    }
  ]
}
```

`questionId` must exist in `human-review.json`; `rationale` is required. Optional `reportNodeId` must match the question binding. Only `http:` and `https:` source URLs are retained, with at most 20 URLs per decision.

Supported actions:

| Action | Effect |
| --- | --- |
| `continue_research` | Queues a priority-100 repair task on the bound hypothesis and authorizes one extra dispatch cycle even if the automatic cycle budget was exhausted. |
| `downplay` | Excludes the leaf from the active evidence-quality audit and records the approved limitation. |
| `omit` | Prunes the leaf and cancels unfinished tasks bound to it. |
| `accept_risk` | Waives the exact reviewed issue while retaining a conservative node disposition. Only requirement-level freshness or coverage issues waive the requirement itself. |

For `downplay` and `omit`, a mapped requirement is waived only when no other active hypothesis still owns it. This prevents a decision about one branch from silently removing an obligation that another branch can satisfy.

## CLI resume

Save the response as `review-response.json`, then resume from the checkpoint produced by the same episode:

```bash
pnpm research \
  --resume artifacts/<episode-id>/checkpoints/latest.json \
  --review-response review-response.json \
  --quality strict \
  --no-stream
```

`--review-response` requires `--resume`. After validation and application, the runner writes `human-review-response.json`, emits `human_review_response_applied`, saves a new checkpoint, and continues from the deterministic post-review cursor.

## TypeScript API

```ts
await runResearch({
  prompt: "__resume__",
  resumeCheckpointPath: "artifacts/<episode-id>/checkpoints/latest.json",
  humanReviewResponse: {
    submittedBy: "reviewer@example.com",
    decisions: [{
      questionId: "quality_1",
      action: "accept_risk",
      rationale: "The limitation is acceptable for this scoped report."
    }]
  }
});
```

The Node HTTP endpoint accepts the same object under `humanReviewResponse` or the `reviewResponse` alias, together with `resumeCheckpointPath` or `resume`:

```json
{
  "resume": "artifacts/<episode-id>/checkpoints/latest.json",
  "reviewResponse": {
    "submittedBy": "reviewer@example.com",
    "decisions": [
      {
        "questionId": "quality_1",
        "action": "omit",
        "rationale": "This claim is outside the approved scope."
      }
    ]
  }
}
```

A response without a resume checkpoint is rejected. The server validates decisions again against the episode's `human-review.json`; clients cannot invent question IDs or retarget a decision to another report node.

## Audit trail

The response artifact records the review stage and generation time, submitter, normalized decisions, created task IDs, waiver IDs, and application time. Checkpoints persist issue waivers and the response path. Human decisions use `decidedBy: "user"`; automatic bounded-repair dispositions use `decidedBy: "framework"`. `evidence-quality-audit.json` records waived requirement coverage, while `publication-warnings.json` exposes framework dispositions for offline evaluation without leaking internal mechanics into reader-facing prose.

No disposition can waive a `failurePolicy="block"` requirement. Missing/orphan/empty citations, forbidden-source rules, fabricated evidence, rendered output corruption, and unsupported claims still present in the draft remain publication blockers.
