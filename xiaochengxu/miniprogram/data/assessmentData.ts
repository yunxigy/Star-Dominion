export interface NativeAssessmentOption {
  id: string;
  label: string;
  scores: Record<string, number>;
}

export interface NativeAssessmentQuestion {
  id: string;
  prompt: string;
  options: NativeAssessmentOption[];
}

export interface NativeAssessmentDefinition {
  id: string;
  title: string;
  description: string;
  dimensions: Array<{ id: string; label: string }>;
  questions: NativeAssessmentQuestion[];
}

export interface NativeAssessmentScore {
  answered: number;
  unanswered: string[];
  scores: Record<string, number>;
  primaryDimension: string;
  percentage: number;
}

const RESPONSE_OPTIONS: NativeAssessmentOption[] = [
  { id: 'rarely', label: '很少像我', scores: { energy: 1, focus: 1, action: 1, stability: 1 } },
  { id: 'sometimes', label: '偶尔像我', scores: { energy: 2, focus: 2, action: 2, stability: 2 } },
  { id: 'often', label: '经常像我', scores: { energy: 3, focus: 3, action: 3, stability: 3 } },
  { id: 'always', label: '非常像我', scores: { energy: 4, focus: 4, action: 4, stability: 4 } },
];

const PROMPTS = [
  '我会主动寻找新的体验和可能性。',
  '面对任务时，我能迅速进入行动状态。',
  '我会留意自己的精力变化并安排节奏。',
  '遇到分歧时，我愿意先理解对方的角度。',
  '我喜欢把复杂问题拆成可以执行的小步骤。',
  '我能在变化中保持相对稳定的判断。',
  '我会复盘自己的选择，并从中找到规律。',
  '我愿意为长期目标持续投入。',
];

function buildQuestions(prefix: string): NativeAssessmentQuestion[] {
  return PROMPTS.map((prompt, index) => ({
    id: `${prefix}-${index + 1}`,
    prompt,
    options: RESPONSE_OPTIONS.map((option) => ({ ...option, scores: { ...option.scores } })),
  }));
}

export const NATIVE_ASSESSMENTS: Record<string, NativeAssessmentDefinition> = {
  'mbti-test': {
    id: 'mbti-test',
    title: 'MBTI 性格探索',
    description: '用几道轻量问题观察你的偏好方向。结果仅供自我了解，不是诊断结论。',
    dimensions: [
      { id: 'energy', label: '探索能量' },
      { id: 'action', label: '行动倾向' },
      { id: 'focus', label: '思考方式' },
      { id: 'stability', label: '稳定节奏' },
    ],
    questions: buildQuestions('mbti'),
  },
  'big-five-test': {
    id: 'big-five-test',
    title: '大五人格探索',
    description: '从几个维度观察日常倾向，帮助你整理自己的行为线索。',
    dimensions: [
      { id: 'energy', label: '开放探索' },
      { id: 'action', label: '尽责行动' },
      { id: 'focus', label: '社交表达' },
      { id: 'stability', label: '情绪稳定' },
    ],
    questions: buildQuestions('big-five'),
  },
};

export function getAssessmentDefinition(toolId: string): NativeAssessmentDefinition {
  return NATIVE_ASSESSMENTS[toolId] ?? NATIVE_ASSESSMENTS['mbti-test'];
}

export function scoreAssessment(
  definition: NativeAssessmentDefinition,
  answers: Record<string, string | undefined>,
): NativeAssessmentScore {
  const scores: Record<string, number> = {};
  for (const dimension of definition.dimensions) scores[dimension.id] = 0;

  const unanswered: string[] = [];
  let answered = 0;
  for (const question of definition.questions) {
    const answerId = answers[question.id];
    const selected = question.options.find((option) => option.id === answerId);
    if (!selected) {
      unanswered.push(question.id);
      continue;
    }
    answered += 1;
    for (const dimension of definition.dimensions) {
      scores[dimension.id] += selected.scores[dimension.id] ?? 0;
    }
  }

  const ranked = [...definition.dimensions].sort((left, right) => scores[right.id] - scores[left.id]);
  const maximum = Math.max(1, definition.questions.length * 4 * definition.dimensions.length);
  const total = Object.values(scores).reduce((sum, value) => sum + value, 0);
  return {
    answered,
    unanswered,
    scores,
    primaryDimension: ranked[0]?.id ?? '',
    percentage: Math.round((total / maximum) * 100),
  };
}
