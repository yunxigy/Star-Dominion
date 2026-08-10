# Assessment Center Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add nine complete 18-question assessments, expand MBTI to 40 questions, and introduce a reusable local-only assessment engine with grouped discovery in the existing toolbox.

**Architecture:** Keep every assessment registered as an existing `test` tool and preserve the `ToolDef.component` contract. Add a pure scoring/state core, a reusable React runner, one configuration module per assessment, and thin entry components. Extend toolbox metadata and URL-backed filtering without adding routes or backend APIs.

**Tech Stack:** React 18, TypeScript 5, Vite 5, Vitest 1, Tailwind CSS, Framer Motion, Lucide React.

Run every `npm.cmd` command below with working directory `E:\AI\gp\SD`.

---

## File map

Create the following focused modules:

- `SD/components/tools/test/assessment/types.ts` — public assessment data and score-result types.
- `SD/components/tools/test/assessment/scoring.ts` — deterministic pure scoring and normalization.
- `SD/components/tools/test/assessment/scoring.test.ts` — score, tie, skip and MBTI boundary tests.
- `SD/components/tools/test/assessment/state.ts` — pure answer/navigation state reducer.
- `SD/components/tools/test/assessment/state.test.ts` — back, change, skip and restart tests.
- `SD/components/tools/test/assessment/AssessmentRunner.tsx` — intro, question flow and completion orchestration.
- `SD/components/tools/test/assessment/AssessmentResult.tsx` — common result presentation.
- `SD/components/tools/test/assessment/definitionValidation.ts` — reusable configuration integrity checks.
- `SD/components/tools/test/assessment/definitionValidation.test.ts` — invalid fixture coverage.
- `SD/components/tools/test/assessment/definitions/*.ts` — ten assessment definitions, including MBTI.
- `SD/components/tools/test/assessment/definitions/index.ts` — definition registry.
- `SD/components/tools/test/assessment/definitions/definitions.test.ts` — final content completeness contract.
- `SD/components/tools/test/*Test.tsx` — thin runners for nine new tools; replace `MbtiTest.tsx` with a thin runner.
- `SD/pages/assessmentToolbox.ts` — pure assessment query/filter helpers.
- `SD/pages/assessmentToolbox.test.ts` — URL/filter behavior tests.

Modify only these existing files:

- `SD/tools/registry.tsx` — assessment metadata, lazy imports and nine tool entries.
- `SD/tools/registryMetadata.test.ts` — total counts and metadata assertions.
- `SD/pages/ToolboxPage.tsx` — assessment filter chips and card metadata.
- `SD/README.md` — 184 tools, 20 assessments and local privacy behavior.

Do not modify the other ten existing assessment components in this implementation.

## Shared content conventions

All question text must be original Chinese copy. Do not copy commercial MBTI, EQ, relationship, Kinsey or Klein questionnaires. Use these shared answer presets:

```ts
export const AGREEMENT_LABELS = ['非常不同意', '比较不同意', '不确定', '比较同意', '非常同意'] as const;
export const TENDENCY_LABELS = ['明显偏向前者', '比较偏向前者', '两边都可能', '比较偏向后者', '明显偏向后者'] as const;
```

For a positive Likert statement, score `[0, 1, 2, 3, 4]`; for a reverse statement, score `[4, 3, 2, 1, 0]`. Every sensitive question additionally exposes a runner-level `暂不回答` action; do not add that as a scored option.

---

### Task 1: Pure assessment types and scoring

**Files:**

- Create: `SD/components/tools/test/assessment/types.ts`
- Create: `SD/components/tools/test/assessment/scoring.ts`
- Test: `SD/components/tools/test/assessment/scoring.test.ts`

- [ ] **Step 1: Write failing score normalization and dominant-result tests**

Create fixtures that assert raw scores normalize against the minimum and maximum possible values of answered questions, skipped questions contribute nothing, and a dominant assessment returns primary and secondary result IDs:

```ts
import { describe, expect, it } from 'vitest';
import { scoreAssessment } from './scoring';
import type { AssessmentDefinition } from './types';

const dominantFixture: AssessmentDefinition = {
  id: 'fixture', title: 'Fixture', subtitle: 'Fixture', group: 'personality',
  questionCount: 2, estimatedMinutes: 1, mode: 'dominant', sensitive: false,
  intro: 'Fixture', disclaimer: 'Fixture', minAnsweredRatio: 0,
  dimensions: [
    { id: 'direct', label: '直接', color: '#ef4444', description: '直接表达' },
    { id: 'empathy', label: '共情', color: '#14b8a6', description: '共情倾听' },
  ],
  questions: [
    { id: 'q1', prompt: 'Q1', options: [
      { id: 'a', label: 'A', scores: { direct: 4, empathy: 0 } },
      { id: 'b', label: 'B', scores: { direct: 0, empathy: 4 } },
    ] },
    { id: 'q2', prompt: 'Q2', options: [
      { id: 'a', label: 'A', scores: { direct: 4, empathy: 0 } },
      { id: 'b', label: 'B', scores: { direct: 0, empathy: 4 } },
    ] },
  ],
  results: [
    { id: 'direct', title: '直接型', description: '直接', keywords: ['清晰'] },
    { id: 'empathy', title: '共情型', description: '共情', keywords: ['倾听'] },
  ],
  tieBreakOrder: ['direct', 'empathy'],
};

describe('scoreAssessment', () => {
  it('normalizes answered questions and selects primary and secondary results', () => {
    const result = scoreAssessment(dominantFixture, { q1: 'a', q2: 'b' });
    expect(result.dimensionScores.direct).toBe(50);
    expect(result.dimensionScores.empathy).toBe(50);
    expect(result.primaryResultId).toBe('direct');
    expect(result.secondaryResultId).toBe('empathy');
  });

  it('does not score skipped questions', () => {
    const result = scoreAssessment(dominantFixture, { q1: 'a', q2: null });
    expect(result.dimensionScores.direct).toBe(100);
    expect(result.dimensionScores.empathy).toBe(0);
  });
});
```

- [ ] **Step 2: Run the scoring test and verify RED**

Run: `npm.cmd test -- components/tools/test/assessment/scoring.test.ts`

Expected: FAIL because `types.ts` and `scoring.ts` do not exist.

- [ ] **Step 3: Define the complete assessment contract**

Implement these exported types in `types.ts`:

```ts
export type AssessmentGroup = 'fun' | 'personality' | 'orientation';
export type AssessmentMode = 'dominant' | 'dimensions' | 'mbti';
export type AnswerMap = Record<string, string | null>;

export interface AssessmentDimension {
  id: string;
  label: string;
  color: string;
  description: string;
}

export interface AssessmentOption {
  id: string;
  label: string;
  scores: Record<string, number>;
}

export interface AssessmentQuestion {
  id: string;
  prompt: string;
  options: AssessmentOption[];
}

export interface AssessmentResultProfile {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  suggestion?: string;
}

export interface MbtiPair {
  id: string;
  left: string;
  right: string;
  tieQuestionId: string;
}

export interface AssessmentDefinition {
  id: string;
  title: string;
  subtitle: string;
  group: AssessmentGroup;
  questionCount: number;
  estimatedMinutes: number;
  mode: AssessmentMode;
  sensitive: boolean;
  intro: string;
  disclaimer: string;
  minAnsweredRatio: number;
  dimensions: AssessmentDimension[];
  questions: AssessmentQuestion[];
  results: AssessmentResultProfile[];
  tieBreakOrder?: string[];
  mbtiPairs?: MbtiPair[];
}

export interface AssessmentScoreResult {
  dimensionScores: Record<string, number | null>;
  rankedDimensionIds: string[];
  primaryResultId?: string;
  secondaryResultId?: string;
  mbtiType?: string;
  closeDimensionIds: string[];
  insufficientDimensionIds: string[];
}
```

- [ ] **Step 4: Implement deterministic scoring**

In `scoring.ts`, export `scoreAssessment(definition, answers)`. For each answered question, add the selected option scores, and add that question's minimum and maximum option score to a dimension's possible range only when at least one option on that question references the dimension; an omitted score key is zero for a linked question. Normalize with `Math.round(((raw - min) / (max - min)) * 100)`; return `50` if `max === min`; return `null` if the answered coverage for a dimension is below `minAnsweredRatio`. Sort scores descending and use `tieBreakOrder` only when numeric scores tie. For MBTI, compare each pair, use `tieQuestionId` on an exact tie, and if that answer is neutral use the pair's left letter as the final deterministic fallback while marking the pair as close. Concatenate the four selected letters and mark pair IDs whose two percentages differ by at most 10 points.

- [ ] **Step 5: Add failing MBTI tie and insufficient-information tests, then make them pass**

Extend `scoring.test.ts` with a two-pair fixture asserting `mbtiType`, tie-question resolution, neutral-tie deterministic fallback, `closeDimensionIds`, and a sensitive fixture where only one of three dimension-linked questions is answered and the dimension becomes `null`.

Run: `npm.cmd test -- components/tools/test/assessment/scoring.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the scoring core**

```powershell
git add -- SD/components/tools/test/assessment/types.ts SD/components/tools/test/assessment/scoring.ts SD/components/tools/test/assessment/scoring.test.ts
git commit -m "feat: add assessment scoring core"
```

---

### Task 2: Answer state and reusable runner

**Files:**

- Create: `SD/components/tools/test/assessment/state.ts`
- Test: `SD/components/tools/test/assessment/state.test.ts`
- Create: `SD/components/tools/test/assessment/AssessmentRunner.tsx`
- Create: `SD/components/tools/test/assessment/AssessmentResult.tsx`

- [ ] **Step 1: Write failing state transition tests**

Test the exact transitions `start`, `answer`, `skip`, `previous`, `next`, `finish`, and `restart`. Assert that changing an earlier answer replaces the prior option, skip stores `null`, previous never goes below zero, next never exceeds the final question, and restart returns to the intro with an empty map.

```ts
const initial = createAssessmentState();
const started = assessmentReducer(initial, { type: 'start' });
const answered = assessmentReducer(started, { type: 'answer', questionId: 'q1', optionId: 'a' });
expect(answered.answers).toEqual({ q1: 'a' });
expect(assessmentReducer(answered, { type: 'restart' })).toEqual(createAssessmentState());
```

- [ ] **Step 2: Run the state test and verify RED**

Run: `npm.cmd test -- components/tools/test/assessment/state.test.ts`

Expected: FAIL because `state.ts` does not exist.

- [ ] **Step 3: Implement the reducer and selectors**

Export `AssessmentState`, `AssessmentAction`, `createAssessmentState`, `assessmentReducer`, and `canAdvance`. State fields are `phase: 'intro' | 'questions' | 'result'`, `currentIndex`, and `answers`. `canAdvance(state, questionId, sensitive)` returns true for a selected option and permits explicit skip only after the reducer has stored `null` for a sensitive question; use `Object.prototype.hasOwnProperty.call` to distinguish unanswered from skipped.

- [ ] **Step 4: Run state tests and verify GREEN**

Run: `npm.cmd test -- components/tools/test/assessment/state.test.ts`

Expected: PASS.

- [ ] **Step 5: Implement `AssessmentRunner`**

The component signature is:

```tsx
export interface AssessmentRunnerProps {
  definition?: AssessmentDefinition;
  onClose: () => void;
}

export function AssessmentRunner({ definition, onClose }: AssessmentRunnerProps) { /* render phases */ }
```

If `definition` is absent, render a clear “测评配置加载失败” message and a close button. Otherwise use `useReducer`, `scoreAssessment`, Framer Motion and existing warm toolbox colors. Use a fixed group accent map: pink/orange for fun, violet for personality, and low-saturation rose/teal/neutral tones for orientation; do not use rainbow gradients. Intro shows title, subtitle, question count, minutes, local-only text, disclaimer, and the 16+ notice when `sensitive`. Question view renders one semantic `<fieldset>`, radio-like buttons with `aria-pressed`, progress text/bar, Previous, Next/查看结果, and `暂不回答` only when sensitive. Result view delegates to `AssessmentResult`. Do not read or write Web Storage, cookies, fetch, or APIs.

- [ ] **Step 6: Implement `AssessmentResult`**

Resolve profiles from `primaryResultId` and `secondaryResultId`, render all declared dimensions as 0–100 bars, and render `信息不足` for `null`. MBTI renders the four-letter `mbtiType`; dimensions mode uses `rankedDimensionIds` to explain the two strongest available dimensions without declaring a winner. Show boundary and insufficient-information notices, disclaimer, restart and close buttons. Use CSS transitions only when reduced motion is not requested through Tailwind's `motion-reduce:transition-none` classes.

- [ ] **Step 7: Verify TypeScript and commit**

Run: `npm.cmd run lint`

Expected: PASS.

```powershell
git add -- SD/components/tools/test/assessment/state.ts SD/components/tools/test/assessment/state.test.ts SD/components/tools/test/assessment/AssessmentRunner.tsx SD/components/tools/test/assessment/AssessmentResult.tsx
git commit -m "feat: add reusable assessment runner"
```

---

### Task 3: Definition validation and shared builders

**Files:**

- Create: `SD/components/tools/test/assessment/definitionValidation.ts`
- Test: `SD/components/tools/test/assessment/definitionValidation.test.ts`
- Create: `SD/components/tools/test/assessment/definitions/builders.ts`
- Create: `SD/components/tools/test/assessment/definitions/index.ts`

- [ ] **Step 1: Write failing validation tests**

Assert errors for mismatched `questionCount`, duplicate question IDs, fewer than two options, unknown score dimension, duplicate result IDs, unknown tie-break IDs, a dominant definition without a complete tie-break order, dominant result IDs that do not match dimensions, missing MBTI pairs and a tie question not belonging to its pair. Assert a minimal valid fixture returns an empty error array.

```ts
expect(validateAssessmentDefinition(validFixture)).toEqual([]);
expect(validateAssessmentDefinition({ ...validFixture, questionCount: 9 }))
  .toContain('fixture: questionCount 9 does not match 2 questions');
```

- [ ] **Step 2: Run the validation test and verify RED**

Run: `npm.cmd test -- components/tools/test/assessment/definitionValidation.test.ts`

Expected: FAIL because the validator does not exist.

- [ ] **Step 3: Implement validation and option builders**

Export `validateAssessmentDefinition(definition): string[]`. In `builders.ts`, export `agreementOptions(dimensionId, reverse = false)`, `pairedTendencyOptions(leftId, rightId)`, and `option(id, label, scores)`. Builders must return fresh arrays so definitions cannot mutate one another.

- [ ] **Step 4: Create an initially empty definition registry**

Use an explicit record and accessors:

```ts
export const ASSESSMENT_DEFINITIONS: Record<string, AssessmentDefinition> = {};
export const getAssessmentDefinition = (id: string) => ASSESSMENT_DEFINITIONS[id];
```

Later content tasks replace the empty record with imports; do not use dynamic glob imports.

- [ ] **Step 5: Run validation tests and commit**

Run: `npm.cmd test -- components/tools/test/assessment/definitionValidation.test.ts`

Expected: PASS.

```powershell
git add -- SD/components/tools/test/assessment/definitionValidation.ts SD/components/tools/test/assessment/definitionValidation.test.ts SD/components/tools/test/assessment/definitions/builders.ts SD/components/tools/test/assessment/definitions/index.ts
git commit -m "test: add assessment definition contracts"
```

---

### Task 4: Three fun assessments

**Files:**

- Create: `SD/components/tools/test/assessment/definitions/animalPersonality.ts`
- Create: `SD/components/tools/test/assessment/definitions/colorPersonality.ts`
- Create: `SD/components/tools/test/assessment/definitions/lifeEnergy.ts`
- Create: `SD/components/tools/test/AnimalPersonalityTest.tsx`
- Create: `SD/components/tools/test/ColorPersonalityTest.tsx`
- Create: `SD/components/tools/test/LifeEnergyTest.tsx`
- Modify: `SD/components/tools/test/assessment/definitions/index.ts`

- [ ] **Step 1: Add the animal personality definition**

Declare dimensions/results `cat`, `dog`, `fox`, `wolf`, `otter`, `deer`. Use 18 scenario questions covering: free afternoon, unfamiliar gathering, conflict, new environment, comforting a friend, team role, uncertainty, privacy, competition, travel, sudden change, praise, pressure, rest, planning, curiosity, close relationships and decision-making. Each question has four concrete options and each option scores one primary dimension `2` and one compatible dimension `1`. Rotate primary dimensions so every result is primary exactly 12 times across all 72 options. Use tie order `['cat', 'dog', 'fox', 'wolf', 'otter', 'deer']`.

Result copy must include these identities and keywords:

| ID | Title | Keywords |
|---|---|---|
| `cat` | 猫系观察家 | 独立、敏锐、边界感 |
| `dog` | 犬系同行者 | 真诚、热情、可靠 |
| `fox` | 狐系解题者 | 灵活、机敏、策略感 |
| `wolf` | 狼系守望者 | 坚定、责任、目标感 |
| `otter` | 水獭系气氛家 | 好奇、活力、感染力 |
| `deer` | 鹿系共情者 | 温和、细腻、同理心 |

- [ ] **Step 2: Add the color personality definition**

Declare `red`, `orange`, `yellow`, `green`, `blue`, `purple`. Use 18 scenario questions covering: starting a project, receiving criticism, arranging a room, group discussion, weekend plan, pressure, meeting strangers, choosing a gift, learning, handling disagreement, travel, celebrating success, routine, risk, helping others, expressing ideas, recovering energy and long-term goals. Use the same balanced `2 + 1` scoring rule.

Titles are 红色行动者、橙色连接者、黄色创想家、绿色调和者、蓝色思考者、紫色洞察者. Each result has a distinct two-sentence description, four keywords and one practical suggestion.

- [ ] **Step 3: Add the life energy definition**

Declare `action`, `steady`, `explore`, `ritual`, `social`, `quiet`. Use 18 scenarios covering morning rhythm, task start, meals, workspace, unexpected free time, social battery, exercise, travel, deadlines, learning, home atmosphere, decision speed, celebration, rest, change, creativity, relationships and ideal day. Titles are 行动派、稳态派、探索派、仪式派、社交派、静心派. Balance primary scoring exactly as in Step 1.

- [ ] **Step 4: Add thin entry components and registry exports**

Each entry has this complete shape with its own imported definition:

```tsx
import type { FC } from 'react';
import { AssessmentRunner } from './assessment/AssessmentRunner';
import { animalPersonalityDefinition } from './assessment/definitions/animalPersonality';

const AnimalPersonalityTest: FC<{ onClose: () => void }> = ({ onClose }) => (
  <AssessmentRunner definition={animalPersonalityDefinition} onClose={onClose} />
);
export default AnimalPersonalityTest;
```

Import all three definitions into `definitions/index.ts` and expose them under their exact IDs.

- [ ] **Step 5: Validate content and commit**

Temporarily run `validateAssessmentDefinition` against the three definitions in a focused test or REPL; every result must be `[]`.

Run: `npm.cmd run lint`

Expected: PASS.

```powershell
git add -- SD/components/tools/test/assessment/definitions SD/components/tools/test/AnimalPersonalityTest.tsx SD/components/tools/test/ColorPersonalityTest.tsx SD/components/tools/test/LifeEnergyTest.tsx
git commit -m "feat: add fun personality assessments"
```

---

### Task 5: Three personality assessments

**Files:**

- Create: `SD/components/tools/test/assessment/definitions/communicationStyle.ts`
- Create: `SD/components/tools/test/assessment/definitions/emotionalIntelligence.ts`
- Create: `SD/components/tools/test/assessment/definitions/coreValues.ts`
- Create: `SD/components/tools/test/CommunicationStyleTest.tsx`
- Create: `SD/components/tools/test/EmotionalIntelligenceTest.tsx`
- Create: `SD/components/tools/test/CoreValuesTest.tsx`
- Modify: `SD/components/tools/test/assessment/definitions/index.ts`

- [ ] **Step 1: Add communication style with exact statement allocation**

Dimensions/results: `direct`, `analytical`, `empathetic`, `collaborative`. Add 18 agreement statements in this order, using the named dimension and reverse flag:

| # | Statement | Dimension | Reverse |
|---:|---|---|---|
| 1 | 我会尽早说清楚自己的结论和需求。 | direct | no |
| 2 | 表达前，我习惯先核对事实和逻辑。 | analytical | no |
| 3 | 我能注意到对方没有直接说出的情绪。 | empathetic | no |
| 4 | 我倾向于寻找各方都能接受的方案。 | collaborative | no |
| 5 | 即使意见不同，我也能清楚说明立场。 | direct | no |
| 6 | 信息不足时，我愿意暂缓判断。 | analytical | no |
| 7 | 别人倾诉时，我会先理解感受再给建议。 | empathetic | no |
| 8 | 讨论陷入僵局时，我会主动总结共同点。 | collaborative | no |
| 9 | 为了避免尴尬，我常把真正想法藏起来。 | direct | yes |
| 10 | 我容易在没有证据时凭第一印象下结论。 | analytical | yes |
| 11 | 我很少留意语气和表情带来的信息。 | empathetic | yes |
| 12 | 只要我认为自己正确，就不太在意共识。 | collaborative | yes |
| 13 | 我能用简洁语言提出具体请求。 | direct | no |
| 14 | 面对复杂问题，我会把观点分层说明。 | analytical | no |
| 15 | 我会确认自己是否准确理解了对方。 | empathetic | no |
| 16 | 我愿意调整表达方式以推动合作。 | collaborative | no |
| 17 | 在压力下，我的表达容易变得含糊。 | direct | yes |
| 18 | 我会邀请沉默的人参与讨论。 | collaborative | no |

Titles: 直接表达型、理性分析型、共情倾听型、协作协调型. Use tie order `['direct', 'analytical', 'empathetic', 'collaborative']`.

- [ ] **Step 2: Add emotional intelligence**

Dimensions: `awareness`, `regulation`, `empathy`, `relationship`. Use 18 statements distributed `5/5/4/4`; include at least two reverse statements per dimension. Cover naming emotions, noticing bodily cues, separating emotion from action, recovery after stress, impulse pause, perspective-taking, listening, conflict repair and asking for support. Use `mode: 'dimensions'`; add one result profile per dimension with 3–5 keywords so the result page can explain the highest two dimensions without presenting a fixed personality label.

- [ ] **Step 3: Add core values**

Dimensions/results: `autonomy`, `stability`, `achievement`, `connection`, `exploration`, `contribution`. Use 18 forced-choice scenarios with four options for job choice, relocation, free time, difficult decisions, success, money, uncertainty, friendship, learning, recognition, routines, risk, community, leadership, setbacks, future planning, meaningful work and life satisfaction. Every dimension must be primary in exactly 12 of the 72 options. Titles: 自主驱动、稳定驱动、成就驱动、联结驱动、探索驱动、贡献驱动. Use the same ID order as the tie-break order.

- [ ] **Step 4: Add thin components and definition registry entries**

Follow the explicit component shape in Task 4, using the correct definition import and component name. Add all three exact IDs to `ASSESSMENT_DEFINITIONS`.

- [ ] **Step 5: Run focused validation and commit**

Run: `npm.cmd run lint`

Expected: PASS.

```powershell
git add -- SD/components/tools/test/assessment/definitions SD/components/tools/test/CommunicationStyleTest.tsx SD/components/tools/test/EmotionalIntelligenceTest.tsx SD/components/tools/test/CoreValuesTest.tsx
git commit -m "feat: add personality assessments"
```

---

### Task 6: Three orientation and intimacy explorations

**Files:**

- Create: `SD/components/tools/test/assessment/definitions/orientationSpectrum.ts`
- Create: `SD/components/tools/test/assessment/definitions/romanticOrientation.ts`
- Create: `SD/components/tools/test/assessment/definitions/intimacyBoundaries.ts`
- Create: `SD/components/tools/test/OrientationSpectrumTest.tsx`
- Create: `SD/components/tools/test/RomanticOrientationTest.tsx`
- Create: `SD/components/tools/test/IntimacyBoundariesTest.tsx`
- Modify: `SD/components/tools/test/assessment/definitions/index.ts`

- [ ] **Step 1: Add the sexual-orientation spectrum exploration**

Set `sensitive: true`, `mode: 'dimensions'`, `minAnsweredRatio: 0.5`. Use dimensions `sameGender`, `differentGender`, `multiGender`, `lowAttraction`, `fluidExploring`. Use these 18 original, non-behavioral statements:

1. 我曾对与自己性别相同的人产生过性吸引。
2. 我曾对与自己性别不同的人产生过性吸引。
3. 对我而言，吸引力不一定取决于对方的性别。
4. 我很少或几乎不会体验到性吸引。
5. 我对自己的吸引模式仍保持开放和探索。
6. 想象亲密关系时，我能自然地想到与自己性别相同的人。
7. 想象亲密关系时，我能自然地想到与自己性别不同的人。
8. 我可能被不止一种性别的人吸引。
9. 即使欣赏一个人，我也不一定会体验到性吸引。
10. 我的吸引体验可能随时间或情境发生变化。
11. 我对某些人的亲近感主要是情感或审美，并不包含性吸引。
12. 对方的个性和联结感常比性别更影响我的吸引。
13. 我对同性别对象产生吸引的可能性是真实存在的。
14. 我对不同性别对象产生吸引的可能性是真实存在的。
15. 我不需要频繁体验性吸引，也能认可自己的感受。
16. 现有的身份词汇未必能完整描述我的体验。
17. 我愿意允许自己的理解随着经验逐渐清晰。
18. 相比选择固定标签，我目前更重视观察真实感受。

Map each statement only to its relevant dimension; statement 11 contributes to `lowAttraction`, while the other statements contribute `4` to one or two named dimensions. Add one descriptive result profile with 3–5 keywords per dimension for use in the ranked dimension summary. Intro must say answers cannot determine identity and self-identification takes priority.

- [ ] **Step 2: Add romantic-orientation exploration**

Set the same privacy fields. Dimensions are `frequentRomantic`, `bondFirst`, `lowRomantic`, `fluidExploring`. Use 18 statements covering crush frequency, desire for romantic partnership, attraction after deep trust, distinction between friendship and romance, comfort without romance, changing patterns, uncertainty, social expectations and self-acceptance. Add one descriptive result profile with 3–5 keywords per dimension. Do not use relationship status or dating history as evidence. Result descriptions may explain terms such as romantic, demiromantic and aromantic-spectrum as optional vocabulary, never as assigned diagnoses.

- [ ] **Step 3: Add intimacy-boundaries assessment**

Set `sensitive: true`, `mode: 'dominant'`, `minAnsweredRatio: 0.5`. Dimensions/results: `autonomy`, `closeness`, `transparent`, `slowPace`. Use 18 statements covering alone time, message frequency, conflict, privacy, affection, decision-making, pacing, sharing feelings, personal space, reassurance, social circles, boundaries, recovery after tension, asking consent, plans, dependency, change and mutual expectations. Titles: 自主空间型、亲密联结型、透明沟通型、慢热节奏型. Use the listed ID order as `tieBreakOrder`. Explicitly state that no result is healthier or more mature than another.

- [ ] **Step 4: Add thin components and registry entries**

Follow the Task 4 component contract. Add all three definitions to the explicit registry and ensure their disclaimers contain `仅供自我探索` and `不用于确认或诊断身份` where applicable.

- [ ] **Step 5: Run focused validation and commit**

Run: `npm.cmd run lint`

Expected: PASS.

```powershell
git add -- SD/components/tools/test/assessment/definitions SD/components/tools/test/OrientationSpectrumTest.tsx SD/components/tools/test/RomanticOrientationTest.tsx SD/components/tools/test/IntimacyBoundariesTest.tsx
git commit -m "feat: add orientation exploration assessments"
```

---

### Task 7: Migrate MBTI to a 40-question definition

**Files:**

- Create: `SD/components/tools/test/assessment/definitions/mbti.ts`
- Modify: `SD/components/tools/test/MbtiTest.tsx`
- Modify: `SD/components/tools/test/assessment/definitions/index.ts`

- [ ] **Step 1: Define dimensions, pairs and result profiles**

Use dimensions `E`, `I`, `S`, `N`, `T`, `F`, `J`, `P`. Use four pairs with tie questions `ei-10`, `sn-10`, `tf-10`, `jp-10`. Preserve all 16 existing result types and rewrite any claim implying official or diagnostic status. Set title `MBTI 40 题扩展版`, subtitle `从四个偏好维度了解你的性格倾向`, `mode: 'mbti'`, `questionCount: 40`, `estimatedMinutes: 8`, and `sensitive: false`.

- [ ] **Step 2: Add the exact 40 paired statements**

Each row becomes one five-option paired-tendency question using `pairedTendencyOptions(left, right)`. Alternate which side appears first in the Chinese prompt while keeping score keys correct.

| ID | Left statement | Right statement |
|---|---|---|
| `ei-01` | 与很多人互动让我更有精神 | 独处让我更快恢复精神 |
| `ei-02` | 我常边说边整理想法 | 我常想清楚后再表达 |
| `ei-03` | 我容易主动认识新朋友 | 我更愿意等待自然熟悉 |
| `ei-04` | 热闹环境能激发我的状态 | 安静环境更能让我专注 |
| `ei-05` | 我乐于成为讨论的推动者 | 我更常做深入的观察者 |
| `ei-06` | 新团队里我会尽快参与交流 | 新团队里我会先了解氛围 |
| `ei-07` | 我倾向通过外部互动获得灵感 | 我倾向通过内部思考获得灵感 |
| `ei-08` | 长时间独处会让我想找人交流 | 长时间社交会让我需要独处 |
| `ei-09` | 我更喜欢广泛连接不同的人 | 我更喜欢经营少数深度关系 |
| `ei-10` | 遇到新机会我愿意先参与看看 | 遇到新机会我愿意先独立评估 |
| `sn-01` | 我先关注可观察的事实 | 我先关注事实背后的可能性 |
| `sn-02` | 我信任经过验证的方法 | 我喜欢尝试尚未验证的思路 |
| `sn-03` | 我容易记住具体细节 | 我容易记住整体含义 |
| `sn-04` | 学习时实例最能帮助我 | 学习时原理最能帮助我 |
| `sn-05` | 我更关注当下能做什么 | 我更关注未来可能发生什么 |
| `sn-06` | 清晰步骤让我更安心 | 开放空间让我更有创造力 |
| `sn-07` | 我偏好准确直接的表达 | 我偏好隐喻和联想的表达 |
| `sn-08` | 解决问题时我从经验出发 | 解决问题时我从新模型出发 |
| `sn-09` | 我更容易发现实际差错 | 我更容易发现潜在机会 |
| `sn-10` | 我会先确认现实条件 | 我会先构想理想图景 |
| `tf-01` | 决策时一致的标准最重要 | 决策时人的具体处境最重要 |
| `tf-02` | 我更容易指出逻辑漏洞 | 我更容易察觉情感影响 |
| `tf-03` | 反馈应当直接说明问题 | 反馈应当照顾接受方式 |
| `tf-04` | 公平意味着规则一致 | 公平意味着考虑差异 |
| `tf-05` | 争论时我先检验观点 | 争论时我先维护理解 |
| `tf-06` | 我欣赏冷静客观的判断 | 我欣赏温暖体贴的判断 |
| `tf-07` | 团队决策应优先效率 | 团队决策应优先认同感 |
| `tf-08` | 面对困扰我会先找解决方案 | 面对困扰我会先给予情绪支持 |
| `tf-09` | 即使不受欢迎也要坚持合理结论 | 即使结论合理也要考虑关系影响 |
| `tf-10` | 两难时我依靠原则排序 | 两难时我依靠价值感受排序 |
| `jp-01` | 提前安排让我更轻松 | 保留选择让我更轻松 |
| `jp-02` | 我喜欢先完成再休息 | 我常在状态合适时集中完成 |
| `jp-03` | 明确截止时间能帮助我规划 | 临近截止时间能激发我行动 |
| `jp-04` | 旅行前我会准备清晰行程 | 旅行时我喜欢随兴探索 |
| `jp-05` | 我倾向尽早做出决定 | 我倾向继续收集可能性 |
| `jp-06` | 整齐有序让我更专注 | 灵活可变让我更自在 |
| `jp-07` | 计划变化会明显打乱我 | 计划变化通常不会困扰我 |
| `jp-08` | 我喜欢一次处理完一件事 | 我喜欢在多个任务间切换 |
| `jp-09` | 确定性会带给我安全感 | 开放性会带给我活力 |
| `jp-10` | 我更满足于事情已经定下来 | 我更满足于仍有调整空间 |

- [ ] **Step 3: Replace the old MBTI component with a thin runner**

Delete the local `QUESTIONS`, `RESULTS`, score state and duplicated JSX from `MbtiTest.tsx`. Export the same default component signature and render `AssessmentRunner` with `mbtiDefinition`.

- [ ] **Step 4: Run scoring, TypeScript and commit**

Run: `npm.cmd test -- components/tools/test/assessment/scoring.test.ts`

Run: `npm.cmd run lint`

Expected: both PASS.

```powershell
git add -- SD/components/tools/test/MbtiTest.tsx SD/components/tools/test/assessment/definitions/mbti.ts SD/components/tools/test/assessment/definitions/index.ts
git commit -m "feat: expand mbti assessment to forty questions"
```

---

### Task 8: Final definition integrity contract

**Files:**

- Create: `SD/components/tools/test/assessment/definitions/definitions.test.ts`

- [ ] **Step 1: Write the complete registry assertions**

```ts
const expectedIds = [
  'animal-personality-test', 'color-personality-test', 'life-energy-test',
  'communication-style-test', 'emotional-intelligence-test', 'core-values-test',
  'orientation-spectrum-test', 'romantic-orientation-test', 'intimacy-boundaries-test',
  'mbti-test',
];

expect(Object.keys(ASSESSMENT_DEFINITIONS).sort()).toEqual(expectedIds.sort());
for (const definition of Object.values(ASSESSMENT_DEFINITIONS)) {
  expect(validateAssessmentDefinition(definition)).toEqual([]);
  expect(definition.questions).toHaveLength(definition.id === 'mbti-test' ? 40 : 18);
}
```

Also assert question IDs are unique within each definition, all orientation definitions are sensitive, every sensitive disclaimer contains `仅供自我探索`, and all result profiles have 3–5 keywords.

- [ ] **Step 2: Add reachability tests**

For every dominant definition, generate one answer map per dimension by selecting the option with the highest score for that dimension and assert the corresponding result can become primary. For MBTI, build all-left and all-right answer maps and expect `ESTJ` and `INFP` according to the actual prompt/score orientation. For dimensions definitions, assert all dimension scores are non-null when every question is answered.

- [ ] **Step 3: Run all assessment tests and fix only contract failures**

Run: `npm.cmd test -- components/tools/test/assessment`

Expected: PASS.

- [ ] **Step 4: Commit the content contract**

```powershell
git add -- SD/components/tools/test/assessment/definitions/definitions.test.ts SD/components/tools/test/assessment/definitions
git commit -m "test: validate assessment content completeness"
```

---

### Task 9: Tool registry metadata and nine entries

**Files:**

- Modify: `SD/tools/registry.tsx` at `ToolDef`, test lazy imports and the `// ── 测评中心` entries.
- Modify: `SD/tools/registryMetadata.test.ts`

- [ ] **Step 1: Write failing registry assertions**

Change the expected total to `184`. Assert `getToolsByCategory('test')` has length `20`, the nine new IDs exist, and each new entry has `privacy === 'local'`, `status === 'stable'`, `questionCount === 18`, `estimatedMinutes` from 3 to 5, and a valid `assessmentGroup`. Assert MBTI has `questionCount === 40`, `estimatedMinutes === 8`, and group `personality`.

- [ ] **Step 2: Run the registry test and verify RED**

Run: `npm.cmd test -- tools/registryMetadata.test.ts`

Expected: FAIL with total 175 and missing IDs.

- [ ] **Step 3: Extend `ToolDef` and lazy imports**

Add:

```ts
assessmentGroup?: 'fun' | 'personality' | 'orientation';
questionCount?: number;
estimatedMinutes?: number;
sensitive?: boolean;
```

Add nine explicit `React.lazy` imports for the thin entry components. Do not use a computed import path.

- [ ] **Step 4: Register the nine tools and update MBTI metadata**

All entries use `category: 'test'`, `privacy: 'local'`, `status: 'stable'`. Use `pink` for fun, `violet` for personality, and `indigo` for orientation. Add Chinese and pinyin search tags. Use matching Lucide names already present in `ICON_MAP`; verify with `npm.cmd run validate` and choose an existing icon if validation rejects one.

- [ ] **Step 5: Run registry tests and validation**

Run: `npm.cmd test -- tools/registryMetadata.test.ts`

Run: `npm.cmd run validate`

Expected: PASS and output `工具总数: 184`.

- [ ] **Step 6: Commit registry integration**

```powershell
git add -- SD/tools/registry.tsx SD/tools/registryMetadata.test.ts
git commit -m "feat: register expanded assessment catalog"
```

---

### Task 10: URL-backed assessment filters and card metadata

**Files:**

- Create: `SD/pages/assessmentToolbox.ts`
- Test: `SD/pages/assessmentToolbox.test.ts`
- Modify: `SD/pages/ToolboxPage.tsx`

- [ ] **Step 1: Write failing pure filter tests**

Export and test:

```ts
export const ASSESSMENT_GROUPS = [
  { id: 'fun', label: '趣味' },
  { id: 'personality', label: '人格' },
  { id: 'orientation', label: '性向探索' },
] as const;

export function isAssessmentGroup(value: string | null): value is AssessmentGroup;
export function filterAssessmentTools(tools: ToolDef[], group: AssessmentGroup | null): ToolDef[];
export function syncAssessmentParam(params: URLSearchParams, activeCategory: string | null, search: string, group: AssessmentGroup | null): URLSearchParams;
```

Assert invalid values are rejected, grouped filtering excludes ungrouped existing tests, and `assessment` is removed whenever category is not `test` or search is non-empty.

- [ ] **Step 2: Run the filter test and verify RED**

Run: `npm.cmd test -- pages/assessmentToolbox.test.ts`

Expected: FAIL because the helper module does not exist.

- [ ] **Step 3: Implement the pure helpers and pass tests**

Clone input `URLSearchParams` before modifying it. Never mutate the caller's instance. Run the focused test until PASS.

- [ ] **Step 4: Integrate filter state into `ToolboxPage`**

Add `activeAssessmentGroup` state. Parse `assessment` only when `category=test` and no search. In `displayTools`, apply category first and group second. Add an “全部 / 趣味 / 人格 / 性向探索” chip row immediately above the grid only when the test category is active and search is blank. Use `setSearchParams` for every group change so refresh preserves the view.

- [ ] **Step 5: Add card metadata without affecting other cards**

When `tool.category === 'test'` and fields exist, render compact badges for group label, `${questionCount} 题`, `约 ${estimatedMinutes} 分钟`, and `本地处理`. Keep the existing privacy/status badges and favorite button structure valid; do not nest buttons.

- [ ] **Step 6: Run page, registry and TypeScript tests**

Run: `npm.cmd test -- pages/assessmentToolbox.test.ts tools/registryMetadata.test.ts`

Run: `npm.cmd run lint`

Expected: PASS.

- [ ] **Step 7: Commit discovery UI**

```powershell
git add -- SD/pages/assessmentToolbox.ts SD/pages/assessmentToolbox.test.ts SD/pages/ToolboxPage.tsx
git commit -m "feat: add assessment discovery filters"
```

---

### Task 11: Documentation and full verification

**Files:**

- Modify: `SD/README.md`

- [ ] **Step 1: Update documented totals and behavior**

Change the header to 184 tools, change the assessment row to 20, mention the three assessment groups, 18-question new tests, MBTI 40-question expansion, and state that answers are held only in current-page memory and disappear on close or refresh.

- [ ] **Step 2: Run the complete automated suite**

Run in order:

```powershell
npm.cmd run validate
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Expected: registry validation reports 184 tools; all Vitest tests pass; TypeScript exits 0; Vite creates `dist/` successfully.

- [ ] **Step 3: Run a source-level privacy audit**

Run:

```powershell
rg -n -g '*.ts' -g '*.tsx' "localStorage|sessionStorage|document\.cookie|fetch\(|axios|XMLHttpRequest" components/tools/test/assessment components/tools/test
```

Expected: no matches in the new assessment engine, definitions or thin components.

- [ ] **Step 4: Perform desktop and mobile smoke tests**

Start `npm.cmd run dev -- --host 127.0.0.1`. At desktop width and a mobile width near 390 px:

1. Open `/gj?category=test&assessment=fun` and verify three new fun cards.
2. Complete Animal Personality, go back once, change an answer, view dimensions, restart and close.
3. Complete MBTI and verify 40 questions, four-letter output, four pair bars and boundary copy.
4. Open Orientation Spectrum, verify the 16+ intro, skip at least half the questions, and confirm insufficient-information handling.
5. Refresh during an assessment and verify answers are gone.
6. Open an existing assessment and a non-assessment tool to check regressions.

- [ ] **Step 5: Inspect the final diff for scope**

Run: `git status --short` and `git diff --check`.

Expected: no whitespace errors; only the files listed in this plan are part of the assessment implementation. Preserve all unrelated pre-existing working-tree changes.

- [ ] **Step 6: Commit documentation and any verification-only fixes**

```powershell
git add -- SD/README.md
git commit -m "docs: document expanded assessment center"
```

If verification required code fixes, stage only the named assessment files and commit them separately with `fix: correct assessment verification issues` before the documentation commit.

## Acceptance checklist

- [ ] Nine new tools appear under the existing `test` category.
- [ ] Every new assessment has exactly 18 original questions.
- [ ] MBTI has exactly 40 original paired-tendency questions.
- [ ] The shared runner supports intro, previous, next, skip where sensitive, result, restart and close.
- [ ] Sexual-orientation content is optional, inclusive, non-behavioral and non-diagnostic.
- [ ] Answers never leave component memory and disappear on close or refresh.
- [ ] The test category supports URL-backed fun/personality/orientation filtering.
- [ ] Cards show group, question count, estimated time and local processing.
- [ ] The registry reports 184 tools and 20 assessments.
- [ ] Registry validation, all tests, TypeScript and production build pass.
- [ ] Existing assessments and non-assessment tools continue to open.
