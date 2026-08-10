import type { AnswerMap } from './types';

export interface AssessmentState {
  phase: 'intro' | 'questions' | 'result';
  currentIndex: number;
  answers: AnswerMap;
}

export type AssessmentAction =
  | { type: 'start' }
  | { type: 'answer'; questionId: string; optionId: string }
  | { type: 'skip'; questionId: string }
  | { type: 'previous' }
  | { type: 'next'; lastIndex: number }
  | { type: 'finish' }
  | { type: 'restart' };

export const createAssessmentState = (): AssessmentState => ({
  phase: 'intro',
  currentIndex: 0,
  answers: {},
});

export function assessmentReducer(
  state: AssessmentState,
  action: AssessmentAction,
): AssessmentState {
  switch (action.type) {
    case 'start':
      return { ...state, phase: 'questions' };
    case 'answer':
      return {
        ...state,
        answers: { ...state.answers, [action.questionId]: action.optionId },
      };
    case 'skip':
      return {
        ...state,
        answers: { ...state.answers, [action.questionId]: null },
      };
    case 'previous':
      return { ...state, currentIndex: Math.max(0, state.currentIndex - 1) };
    case 'next':
      return { ...state, currentIndex: Math.min(action.lastIndex, state.currentIndex + 1) };
    case 'finish':
      return { ...state, phase: 'result' };
    case 'restart':
      return createAssessmentState();
    default:
      return state;
  }
}

export function canAdvance(
  state: AssessmentState,
  questionId: string,
  sensitive: boolean,
): boolean {
  if (!Object.prototype.hasOwnProperty.call(state.answers, questionId)) return false;
  return state.answers[questionId] !== null || sensitive;
}
