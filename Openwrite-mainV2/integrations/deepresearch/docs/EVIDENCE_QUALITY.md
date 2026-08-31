# Evidence Quality Policy and Audit

The framework separates citation validity from evidence quality. A report can use syntactically valid citation IDs and still be weak because every source comes from one publisher, the sources are only search snippets, or a supported node has background material rather than direct evidence.

Every completion and publication pass now runs a deterministic evidence audit. Publication writes `evidence-quality-audit.json`; the backend exposes it at `GET /research/:runId/evidence-quality`.

## Policy

`RuntimeProfile.evidenceQuality` is the single configuration surface:

```json
{
  "mode": "balanced",
  "minSourcesPerLeaf": 2,
  "minIndependentDomainsPerLeaf": 2,
  "minPrimaryOrOfficialSourcesPerLeaf": 1,
  "minAverageQualityScore": 0.6,
  "requireFetchedSourcePerLeaf": true,
  "minReportCitationCoverage": 0.8
}
```

- `advisory`: records quality issues and, after bounded repair, may omit or qualify unresolved coverage without pausing.
- `balanced`: blocks clear grounding defects during repair passes. At final completion it automatically omits branches with no usable material and qualifies evidence-backed partial branches, recording framework dispositions instead of claiming full coverage.
- `strict`: turns every configured threshold into a completion/publication error, schedules targeted evidence repair work, and retains `needs_human_review` after repair exhaustion.

`hilMode` controls whether a real user decision can be requested; it no longer decides whether ordinary evidence scarcity is degradable. `ResearchRequirement.failurePolicy="block"` remains non-waivable in every mode. Automatic dispositions are stable-code and requirement-ID based, not recovered from issue-message text.

A waiver changes publication behavior; it does not turn missing evidence into coverage. Waived requirements remain visible with `status="waived"`, contribute to `waivedCount`/`waivedMustCount`, and stay in the denominator of `requirementCoverage.coverage`. `coveredCount` and `coveredMustCount` include only requirements that are actually grounded and complete. If later evidence satisfies a requirement, the live evidence state wins over an older waiver and the requirement becomes covered.

## Node audit

Each active leaf is scored on unique source depth, independent publisher domains, primary or official source coverage, average source quality, full-content inspection, and direct evidence relations. Repeated links to the same `KnowledgeNode` do not increase source depth; multiple URLs on one domain do not increase independence.

The same artifact contains requirement coverage, source freshness for time-sensitive requirements, entity/year/metric cell coverage for named tables, and evidence/status conflict diagnostics. See [`REQUIREMENT_TRACEABILITY.md`](REQUIREMENT_TRACEABILITY.md).

The overall score deliberately cannot be made perfect by strong source statistics on only part of the assignment. It is `60%` mean active-leaf evidence score plus `40%` true requirement coverage. The summary exposes `waivedMustRequirementCount` separately so a consumer can distinguish a bounded, honestly disclosed omission from completed research.

Repair ownership is requirement-scoped end to end. Initial tasks copy the owning report leaf's `requirementIds`; evidence agents attach those IDs to gaps; completion and reflection copy them onto repair tasks and dispositions. A failed generic repair on a leaf that owns several requirements therefore cannot automatically waive or contaminate unrelated requirements.

For an `as_of` date, freshness uses that calendar day's inclusive end as the exact ceiling. A source or coverage period beginning at midnight on the following day is stale. This differs from `current` mode, where a bounded clock-skew tolerance remains useful for generated-at timestamps. Month-level natural language is normalized before audit, so exclusive and inclusive month phrases cannot silently share the same boundary. A `timeless` requirement does not require a source publication date; it is evaluated on grounding and completeness instead of inventing a freshness failure.

## Table completeness

When a structured requirement explicitly names multiple row subjects in `entityScope` and columns in `metricScope`, the audit records the expected entity-field cells. If explicit comparison years are also required, it expands them into entity-year-field cells. Despite its compatibility name, `metricScope` may contain categorical fields such as architecture, software layer, or XSS support. A cell is covered only when a cited claim or cited reportlet binds the correct entity, optional year, field label/header, and a concrete numeric or categorical value. `No` and `Not applicable` are valid explicit categories; missing or unavailable statements are not. A neighboring field cannot satisfy the cell.

This exact-cell rule applies to `entityScopeRole=members` and legacy scopes with no role. With `entityScopeRole=groups`, the names are discovery partitions rather than rows: the audit requires substantive directly cited material for every requested group and reports missing groups, but does not fabricate group-field cells for members that were not known before research. Member completeness is enforced by category-leaf acceptance criteria, cited reportlets, and unresolved-gap checks.

Recovered nested outline headings also use member semantics when the prompt supplies shared per-item dimensions. Every outline item/dimension pair is therefore auditable like a profile field, while final Markdown structure is checked separately: a cited value cannot compensate for an omitted required subsection, and an empty subsection cannot compensate for missing cited fields.

Explicit indented child topics without a shared field matrix remain separate evidence requirements instead of synthetic rows. Completion therefore requires direct evidence for each child branch, while the evidence-free parent contract is excluded from source-depth calculations. Publication independently verifies that the corresponding non-empty child heading is inside the declared parent H2; evidence attached to a misplaced sibling section does not erase the render defect.

Markdown tables, labeled row prose, and field-grouped prose are recognized. An entity with at least one real field is recorded as present, while every remaining missing field stays visible as its own repair cell. This prevents an otherwise populated row from being mislabeled as an entirely missing entity and lets completion repair only the omitted columns.

Numbered comparison-dimension recovery feeds this same cell audit, including explicitly enumerated security/threat subfields. Table partition labels do not become artificial fields: each entity reportlet records one evidence-backed partition decision in its narrative, while the rendered-deliverable guard separately checks that the final labeled tables conserve every member exactly once. Thus cell completeness, classification correctness, and final row placement remain distinct checks.

The trigger is deliberately conservative. A date range that bounds which studies were published, a chronological policy/event window, or a narrative geographic distribution does not imply that both endpoint years or every named region needs a value. Parenthesized categorical answer values such as `effective/ineffective/neutral` are not entities. Explicit “every year” requests and structured tables/comparisons still receive the full completeness audit.

## Narrative example completeness

`exampleScope` is audited separately from table completeness. It contains only user-mandated named cases, figures, stories, or incidents that must contribute to a broader narrative analysis. An example counts as covered only when a direct non-background EvidenceLink claim/quote or a cited reportlet names it and contains substantive surrounding analysis; a bare name or an explicit missing/unavailable placeholder does not count. Missing examples produce `incomplete_example_coverage` with `requiredExamples`, `coveredExamples`, and `missingExamples`, allowing completion to create one cache-first repair for the exact omissions. The audit never converts these examples into entity-field cells.

## Report grounding audit

The publication audit detects evidence-bearing sentences using conservative factual and quantitative cues. Cited factual prose is evidence-bearing even when it omits heuristic phrases such as “research shows.” The audit reports the number of evidence-bearing sentences, valid local `[C#]` coverage, and uncited numeric, percentage, or dated claims with short samples.

This is a deterministic guard, not a semantic entailment oracle. The semantic publish reviewer still checks overclaim, rubric coverage, and hidden gaps. The two layers are complementary.

## Source calibration

The storage path preserves the agent-declared tier and score in metadata, then applies only high-confidence deterministic upgrades. Government and major intergovernmental domains are recognized as `official`; fetched official/primary sources receive a conservative quality floor. Academic hosting alone is not enough to infer that a page is primary research.

The audit artifact is detailed enough for UI rendering, offline evaluation, and regression comparisons without re-running the model.

## Degraded deliverables

An automatically downplayed counted or entity deliverable must keep its requested structure and render the verified subset. The report states the achieved coverage, such as “6 of the requested 15 rows could be verified,” and never fills missing factual cells from model memory. The ordinary completeness detector still blocks the same partial output without an audited disposition. `omit` removes a wholly unsupported deliverable; `downplay` does not silently pretend its minimum was met.
