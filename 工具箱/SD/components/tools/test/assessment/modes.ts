import type {
  AssessmentDefinition,
  AssessmentQuestion,
  AssessmentVariant,
  AssessmentVariantId,
} from './types';

const COMPLETE_DESCRIPTION = '题量更完整，适合想认真了解自己的人。';
const QUICK_DESCRIPTION = '少量核心题目，适合先快速了解大致倾向。';

function completeVariant(definition: AssessmentDefinition): AssessmentVariant {
  return definition.variants?.complete ?? {
    id: 'complete',
    label: '完整测试',
    description: COMPLETE_DESCRIPTION,
    estimatedMinutes: definition.estimatedMinutes,
    questions: definition.questions,
  };
}

export function withAssessmentModes(
  definition: AssessmentDefinition,
  quickQuestionIds: readonly string[],
  quickEstimatedMinutes: number,
): AssessmentDefinition {
  const questionById = new Map(definition.questions.map((question) => [question.id, question]));
  if (new Set(quickQuestionIds).size !== quickQuestionIds.length) {
    throw new Error(`${definition.id}: quick question IDs must be unique`);
  }

  const quickQuestions = quickQuestionIds.map((id) => {
    const question = questionById.get(id);
    if (!question) throw new Error(`${definition.id}: quick question ${id} does not exist`);
    return question;
  });

  return {
    ...definition,
    variants: {
      quick: {
        id: 'quick',
        label: '简易测试',
        description: QUICK_DESCRIPTION,
        estimatedMinutes: quickEstimatedMinutes,
        questions: quickQuestions,
      },
      complete: {
        id: 'complete',
        label: '完整测试',
        description: COMPLETE_DESCRIPTION,
        estimatedMinutes: definition.estimatedMinutes,
        questions: definition.questions,
      },
    },
  };
}

export function getAssessmentVariant(
  definition: AssessmentDefinition,
  variantId: AssessmentVariantId,
): AssessmentVariant {
  if (variantId === 'quick' && definition.variants?.quick) return definition.variants.quick;
  return completeVariant(definition);
}

export function getAssessmentVariants(definition: AssessmentDefinition): AssessmentVariant[] {
  const variants: AssessmentVariant[] = [];
  if (definition.variants?.quick) variants.push(definition.variants.quick);
  variants.push(completeVariant(definition));
  return variants;
}

export function getQuickQuestionIds(
  questions: readonly AssessmentQuestion[],
  dimensionIds: readonly string[],
  perDimension: number,
): string[] {
  const selected = new Set<string>();
  for (const dimensionId of dimensionIds) {
    questions
      .filter((question) => question.options.some((option) => dimensionId in option.scores))
      .slice(0, perDimension)
      .forEach((question) => selected.add(question.id));
  }
  return questions.filter((question) => selected.has(question.id)).map((question) => question.id);
}
