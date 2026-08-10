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
