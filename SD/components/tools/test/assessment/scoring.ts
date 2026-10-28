import type {
  AnswerMap,
  AssessmentDefinition,
  AssessmentOption,
  AssessmentQuestion,
  AssessmentScoreResult,
  MbtiPair,
} from './types';

const hasOwn = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);

const optionScore = (option: AssessmentOption, dimensionId: string) =>
  option.scores[dimensionId] ?? 0;

function tieOrderIndex(definition: AssessmentDefinition, dimensionId: string): number {
  const configuredIndex = definition.tieBreakOrder?.indexOf(dimensionId) ?? -1;
  if (configuredIndex >= 0) return configuredIndex;
  const dimensionIndex = definition.dimensions.findIndex((dimension) => dimension.id === dimensionId);
  return dimensionIndex >= 0 ? dimensionIndex : Number.MAX_SAFE_INTEGER;
}

function resolveMbtiLetter(
  definition: AssessmentDefinition,
  pair: MbtiPair,
  answers: AnswerMap,
  dimensionScores: Record<string, number | null>,
  questions: readonly AssessmentQuestion[],
): string {
  const leftScore = dimensionScores[pair.left];
  const rightScore = dimensionScores[pair.right];

  if (leftScore !== null && rightScore !== null) {
    if (leftScore > rightScore) return pair.left;
    if (rightScore > leftScore) return pair.right;
  }

  const tieQuestion = questions.find((question) => question.id === pair.tieQuestionId);
  const tieAnswerId = answers[pair.tieQuestionId];
  const tieOption = tieQuestion?.options.find((option) => option.id === tieAnswerId);
  if (tieOption) {
    const leftTieScore = optionScore(tieOption, pair.left);
    const rightTieScore = optionScore(tieOption, pair.right);
    if (rightTieScore > leftTieScore) return pair.right;
    if (leftTieScore > rightTieScore) return pair.left;
  }

  return pair.left;
}

export function scoreAssessment(
  definition: AssessmentDefinition,
  answers: AnswerMap,
  questions: readonly AssessmentQuestion[] = definition.questions,
): AssessmentScoreResult {
  const dimensionScores: Record<string, number | null> = {};
  const insufficientDimensionIds: string[] = [];

  for (const dimension of definition.dimensions) {
    let rawScore = 0;
    let minimumScore = 0;
    let maximumScore = 0;
    let linkedQuestionCount = 0;
    let answeredQuestionCount = 0;

    for (const question of questions) {
      const linked = question.options.some((option) => hasOwn(option.scores, dimension.id));
      if (!linked) continue;
      linkedQuestionCount += 1;

      const answerId = answers[question.id];
      if (!hasOwn(answers, question.id) || answerId === null) continue;
      const selectedOption = question.options.find((option) => option.id === answerId);
      if (!selectedOption) continue;

      answeredQuestionCount += 1;
      rawScore += optionScore(selectedOption, dimension.id);
      const possibleScores = question.options.map((option) => optionScore(option, dimension.id));
      minimumScore += Math.min(...possibleScores);
      maximumScore += Math.max(...possibleScores);
    }

    const coverage = linkedQuestionCount === 0 ? 0 : answeredQuestionCount / linkedQuestionCount;
    if (answeredQuestionCount === 0 || coverage < definition.minAnsweredRatio) {
      dimensionScores[dimension.id] = null;
      insufficientDimensionIds.push(dimension.id);
      continue;
    }

    dimensionScores[dimension.id] = maximumScore === minimumScore
      ? 50
      : Math.round(((rawScore - minimumScore) / (maximumScore - minimumScore)) * 100);
  }

  const rankedDimensionIds = definition.dimensions
    .map((dimension) => dimension.id)
    .filter((dimensionId) => dimensionScores[dimensionId] !== null)
    .sort((leftId, rightId) => {
      const scoreDifference = (dimensionScores[rightId] ?? 0) - (dimensionScores[leftId] ?? 0);
      return scoreDifference || tieOrderIndex(definition, leftId) - tieOrderIndex(definition, rightId);
    });

  const result: AssessmentScoreResult = {
    dimensionScores,
    rankedDimensionIds,
    closeDimensionIds: [],
    insufficientDimensionIds,
  };

  if (definition.mode === 'dominant') {
    result.primaryResultId = rankedDimensionIds[0];
    result.secondaryResultId = rankedDimensionIds[1];
    if (rankedDimensionIds.length >= 2) {
      const firstScore = dimensionScores[rankedDimensionIds[0]];
      const secondScore = dimensionScores[rankedDimensionIds[1]];
      if (firstScore !== null && secondScore !== null && Math.abs(firstScore - secondScore) <= 10) {
        result.closeDimensionIds = rankedDimensionIds.slice(0, 2);
      }
    }
  }

  if (definition.mode === 'mbti') {
    const pairs = definition.mbtiPairs ?? [];
    result.mbtiType = pairs
      .map((pair) => resolveMbtiLetter(definition, pair, answers, dimensionScores, questions))
      .join('');
    result.closeDimensionIds = pairs
      .filter((pair) => {
        const leftScore = dimensionScores[pair.left];
        const rightScore = dimensionScores[pair.right];
        return leftScore !== null && rightScore !== null && Math.abs(leftScore - rightScore) <= 10;
      })
      .map((pair) => pair.id);
  }

  if (definition.scoreType === 'quiz') {
    const availableScores = definition.dimensions
      .map((dimension) => dimensionScores[dimension.id])
      .filter((value): value is number => value !== null);
    if (availableScores.length > 0) {
      result.overallPercentage = Math.round(
        availableScores.reduce((sum, value) => sum + value, 0) / availableScores.length,
      );
    }
  }

  return result;
}
