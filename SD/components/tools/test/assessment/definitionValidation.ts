import type { AssessmentDefinition } from './types';

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

export function validateAssessmentDefinition(definition: AssessmentDefinition): string[] {
  const errors: string[] = [];
  const dimensionIds = definition.dimensions.map((dimension) => dimension.id);
  const dimensionSet = new Set(dimensionIds);

  if (definition.questionCount !== definition.questions.length) {
    errors.push(`${definition.id}: questionCount ${definition.questionCount} does not match ${definition.questions.length} questions`);
  }
  if (definition.minAnsweredRatio < 0 || definition.minAnsweredRatio > 1) {
    errors.push(`${definition.id}: minAnsweredRatio must be between 0 and 1`);
  }

  for (const dimensionId of duplicates(dimensionIds)) {
    errors.push(`${definition.id}: duplicate dimension id ${dimensionId}`);
  }
  for (const questionId of duplicates(definition.questions.map((question) => question.id))) {
    errors.push(`${definition.id}: duplicate question id ${questionId}`);
  }

  for (const question of definition.questions) {
    if (question.options.length < 2) {
      errors.push(`${definition.id}/${question.id}: expected at least 2 options`);
    }
    for (const optionId of duplicates(question.options.map((option) => option.id))) {
      errors.push(`${definition.id}/${question.id}: duplicate option id ${optionId}`);
    }
    for (const option of question.options) {
      for (const scoreDimension of Object.keys(option.scores)) {
        if (!dimensionSet.has(scoreDimension)) {
          errors.push(`${definition.id}/${question.id}/${option.id}: unknown score dimension ${scoreDimension}`);
        }
      }
    }
  }

  for (const resultId of duplicates(definition.results.map((result) => result.id))) {
    errors.push(`${definition.id}: duplicate result id ${resultId}`);
  }

  if (definition.mode === 'dominant') {
    const resultSet = new Set(definition.results.map((result) => result.id));
    for (const dimensionId of dimensionIds) {
      if (!resultSet.has(dimensionId)) {
        errors.push(`${definition.id}: dominant dimension ${dimensionId} has no matching result`);
      }
    }

    const tieBreakOrder = definition.tieBreakOrder ?? [];
    for (const dimensionId of tieBreakOrder) {
      if (!dimensionSet.has(dimensionId)) {
        errors.push(`${definition.id}: tieBreakOrder contains unknown dimension ${dimensionId}`);
      }
    }
    const uniqueTieBreakIds = new Set(tieBreakOrder);
    if (
      tieBreakOrder.length !== dimensionIds.length
      || uniqueTieBreakIds.size !== dimensionIds.length
      || dimensionIds.some((dimensionId) => !uniqueTieBreakIds.has(dimensionId))
    ) {
      errors.push(`${definition.id}: tieBreakOrder must contain each dimension exactly once`);
    }
  }

  if (definition.mode === 'mbti') {
    const pairs = definition.mbtiPairs ?? [];
    if (pairs.length === 0) {
      errors.push(`${definition.id}: mbti mode requires at least one pair`);
    }
    for (const pair of pairs) {
      if (!dimensionSet.has(pair.left)) {
        errors.push(`${definition.id}/${pair.id}: unknown left dimension ${pair.left}`);
      }
      if (!dimensionSet.has(pair.right)) {
        errors.push(`${definition.id}/${pair.id}: unknown right dimension ${pair.right}`);
      }
      const tieQuestion = definition.questions.find((question) => question.id === pair.tieQuestionId);
      if (!tieQuestion) {
        errors.push(`${definition.id}/${pair.id}: tie question ${pair.tieQuestionId} does not exist`);
        continue;
      }
      const everyOptionScoresPair = tieQuestion.options.every((option) => (
        Object.prototype.hasOwnProperty.call(option.scores, pair.left)
        && Object.prototype.hasOwnProperty.call(option.scores, pair.right)
      ));
      if (!everyOptionScoresPair) {
        errors.push(`${definition.id}/${pair.id}: tie question ${pair.tieQuestionId} must score both ${pair.left} and ${pair.right}`);
      }
    }
  }

  return errors;
}
