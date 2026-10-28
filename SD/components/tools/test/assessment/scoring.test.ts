import { describe, expect, it } from 'vitest';

import { scoreAssessment } from './scoring';
import type { AssessmentDefinition } from './types';

const dominantFixture: AssessmentDefinition = {
  id: 'fixture',
  title: 'Fixture',
  subtitle: 'Fixture',
  group: 'personality',
  questionCount: 2,
  estimatedMinutes: 1,
  mode: 'dominant',
  sensitive: false,
  intro: 'Fixture',
  disclaimer: 'Fixture',
  minAnsweredRatio: 0,
  dimensions: [
    { id: 'direct', label: '直接', color: '#ef4444', description: '直接表达' },
    { id: 'empathy', label: '共情', color: '#14b8a6', description: '共情倾听' },
  ],
  questions: [
    {
      id: 'q1',
      prompt: 'Q1',
      options: [
        { id: 'a', label: 'A', scores: { direct: 4, empathy: 0 } },
        { id: 'b', label: 'B', scores: { direct: 0, empathy: 4 } },
      ],
    },
    {
      id: 'q2',
      prompt: 'Q2',
      options: [
        { id: 'a', label: 'A', scores: { direct: 4, empathy: 0 } },
        { id: 'b', label: 'B', scores: { direct: 0, empathy: 4 } },
      ],
    },
  ],
  results: [
    { id: 'direct', title: '直接型', description: '直接', keywords: ['清晰'] },
    { id: 'empathy', title: '共情型', description: '共情', keywords: ['倾听'] },
  ],
  tieBreakOrder: ['direct', 'empathy'],
};

const mbtiFixture: AssessmentDefinition = {
  id: 'mbti-fixture',
  title: 'MBTI Fixture',
  subtitle: 'Fixture',
  group: 'personality',
  questionCount: 4,
  estimatedMinutes: 1,
  mode: 'mbti',
  sensitive: false,
  intro: 'Fixture',
  disclaimer: 'Fixture',
  minAnsweredRatio: 0,
  dimensions: [
    { id: 'E', label: '外向', color: '#ef4444', description: 'E' },
    { id: 'I', label: '内向', color: '#3b82f6', description: 'I' },
    { id: 'S', label: '实感', color: '#f59e0b', description: 'S' },
    { id: 'N', label: '直觉', color: '#8b5cf6', description: 'N' },
  ],
  questions: [
    {
      id: 'ei-01',
      prompt: 'E or I',
      options: [
        { id: 'left', label: 'E', scores: { E: 4, I: 0 } },
        { id: 'neutral', label: '中立', scores: { E: 2, I: 2 } },
        { id: 'right', label: 'I', scores: { E: 0, I: 4 } },
      ],
    },
    {
      id: 'ei-02',
      prompt: 'E or I tie breaker',
      options: [
        { id: 'left', label: 'E', scores: { E: 4, I: 0 } },
        { id: 'neutral', label: '中立', scores: { E: 2, I: 2 } },
        { id: 'right', label: 'I', scores: { E: 0, I: 4 } },
      ],
    },
    {
      id: 'sn-01',
      prompt: 'S or N',
      options: [
        { id: 'left', label: 'S', scores: { S: 4, N: 0 } },
        { id: 'neutral', label: '中立', scores: { S: 2, N: 2 } },
        { id: 'right', label: 'N', scores: { S: 0, N: 4 } },
      ],
    },
    {
      id: 'sn-02',
      prompt: 'S or N tie breaker',
      options: [
        { id: 'left', label: 'S', scores: { S: 4, N: 0 } },
        { id: 'neutral', label: '中立', scores: { S: 2, N: 2 } },
        { id: 'right', label: 'N', scores: { S: 0, N: 4 } },
      ],
    },
  ],
  results: [],
  mbtiPairs: [
    { id: 'EI', left: 'E', right: 'I', tieQuestionId: 'ei-02' },
    { id: 'SN', left: 'S', right: 'N', tieQuestionId: 'sn-02' },
  ],
};

const sensitiveFixture: AssessmentDefinition = {
  id: 'sensitive-fixture',
  title: 'Sensitive Fixture',
  subtitle: 'Fixture',
  group: 'orientation',
  questionCount: 3,
  estimatedMinutes: 1,
  mode: 'dimensions',
  sensitive: true,
  intro: 'Fixture',
  disclaimer: '仅供自我探索',
  minAnsweredRatio: 0.5,
  dimensions: [
    { id: 'insight', label: '探索', color: '#14b8a6', description: '探索' },
  ],
  questions: ['q1', 'q2', 'q3'].map((id) => ({
    id,
    prompt: id,
    options: [
      { id: 'low', label: '低', scores: { insight: 0 } },
      { id: 'high', label: '高', scores: { insight: 4 } },
    ],
  })),
  results: [
    { id: 'insight', title: '探索', description: '探索', keywords: ['开放'] },
  ],
};

const quizFixture: AssessmentDefinition = {
  id: 'quiz-fixture',
  title: 'Quiz Fixture',
  subtitle: 'Fixture',
  group: 'fun',
  questionCount: 3,
  estimatedMinutes: 1,
  mode: 'dimensions',
  scoreType: 'quiz',
  sensitive: false,
  intro: 'Fixture',
  disclaimer: 'Fixture',
  minAnsweredRatio: 1,
  dimensions: [
    { id: 'memory', label: '记忆', color: '#ef4444', description: '记忆' },
    { id: 'logic', label: '逻辑', color: '#14b8a6', description: '逻辑' },
  ],
  questions: [
    {
      id: 'q1',
      prompt: 'Q1',
      options: [
        { id: 'correct', label: '正确', scores: { memory: 1 } },
        { id: 'wrong', label: '错误', scores: { memory: 0 } },
      ],
    },
    {
      id: 'q2',
      prompt: 'Q2',
      options: [
        { id: 'correct', label: '正确', scores: { logic: 1 } },
        { id: 'wrong', label: '错误', scores: { logic: 0 } },
      ],
    },
    {
      id: 'q3',
      prompt: 'Q3',
      options: [
        { id: 'correct', label: '正确', scores: { memory: 1 } },
        { id: 'wrong', label: '错误', scores: { memory: 0 } },
      ],
    },
  ],
  results: [],
};

describe('scoreAssessment', () => {
  it('normalizes answered questions and applies stable dominant tie order', () => {
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

  it('uses the configured MBTI tie question and reports close pairs', () => {
    const result = scoreAssessment(mbtiFixture, {
      'ei-01': 'left',
      'ei-02': 'right',
      'sn-01': 'left',
      'sn-02': 'left',
    });

    expect(result.mbtiType).toBe('IS');
    expect(result.closeDimensionIds).toContain('EI');
    expect(result.closeDimensionIds).not.toContain('SN');
  });

  it('uses the left MBTI letter when totals and tie question are neutral', () => {
    const result = scoreAssessment(mbtiFixture, {
      'ei-01': 'neutral',
      'ei-02': 'neutral',
      'sn-01': 'neutral',
      'sn-02': 'neutral',
    });

    expect(result.mbtiType).toBe('ES');
    expect(result.closeDimensionIds).toEqual(['EI', 'SN']);
  });

  it('marks a dimension insufficient when fewer than half its questions are answered', () => {
    const result = scoreAssessment(sensitiveFixture, { q1: 'high', q2: null });

    expect(result.dimensionScores.insight).toBeNull();
    expect(result.insufficientDimensionIds).toEqual(['insight']);
  });

  it('scores only the selected quiz variant and exposes an overall percentage', () => {
    const result = scoreAssessment(
      quizFixture,
      { q1: 'correct', q2: 'wrong' },
      quizFixture.questions.slice(0, 2),
    );

    expect(result.overallPercentage).toBe(50);
    expect(result.dimensionScores.memory).toBe(100);
    expect(result.dimensionScores.logic).toBe(0);
  });
});
