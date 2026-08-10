import type { AssessmentOption, AssessmentQuestion } from '../types';

export const AGREEMENT_LABELS = [
  '非常不同意',
  '比较不同意',
  '不确定',
  '比较同意',
  '非常同意',
] as const;

export const TENDENCY_LABELS = [
  '明显偏向前者',
  '比较偏向前者',
  '两边都可能',
  '比较偏向后者',
  '明显偏向后者',
] as const;

export function option(
  id: string,
  label: string,
  scores: Record<string, number>,
): AssessmentOption {
  return { id, label, scores: { ...scores } };
}

export function agreementOptions(
  dimensionId: string,
  reverse = false,
): AssessmentOption[] {
  const values = reverse ? [4, 3, 2, 1, 0] : [0, 1, 2, 3, 4];
  const ids = ['strongly-disagree', 'disagree', 'neutral', 'agree', 'strongly-agree'];
  return AGREEMENT_LABELS.map((label, index) => option(
    ids[index],
    label,
    { [dimensionId]: values[index] },
  ));
}

export function pairedTendencyOptions(
  leftId: string,
  rightId: string,
): AssessmentOption[] {
  const leftScores = [4, 3, 2, 1, 0];
  const rightScores = [0, 1, 2, 3, 4];
  const ids = ['left-strong', 'left', 'neutral', 'right', 'right-strong'];
  return TENDENCY_LABELS.map((label, index) => option(
    ids[index],
    label,
    { [leftId]: leftScores[index], [rightId]: rightScores[index] },
  ));
}

export type ScenarioChoice = readonly [
  label: string,
  primaryDimensionId: string,
  secondaryDimensionId: string,
];

export function scenarioQuestion(
  id: string,
  prompt: string,
  choices: readonly ScenarioChoice[],
): AssessmentQuestion {
  return {
    id,
    prompt,
    options: choices.map(([label, primaryDimensionId, secondaryDimensionId], index) => option(
      `choice-${index + 1}`,
      label,
      { [primaryDimensionId]: 2, [secondaryDimensionId]: 1 },
    )),
  };
}
