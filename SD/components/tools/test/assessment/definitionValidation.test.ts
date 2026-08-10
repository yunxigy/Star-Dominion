import { describe, expect, it } from 'vitest';

import { validateAssessmentDefinition } from './definitionValidation';
import type { AssessmentDefinition } from './types';

const validFixture: AssessmentDefinition = {
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
    { id: 'a', label: 'A', color: '#111111', description: 'A' },
    { id: 'b', label: 'B', color: '#222222', description: 'B' },
  ],
  questions: [
    {
      id: 'q1',
      prompt: 'Q1',
      options: [
        { id: 'a', label: 'A', scores: { a: 2 } },
        { id: 'b', label: 'B', scores: { b: 2 } },
      ],
    },
    {
      id: 'q2',
      prompt: 'Q2',
      options: [
        { id: 'a', label: 'A', scores: { a: 2 } },
        { id: 'b', label: 'B', scores: { b: 2 } },
      ],
    },
  ],
  results: [
    { id: 'a', title: 'A', description: 'A', keywords: ['A'] },
    { id: 'b', title: 'B', description: 'B', keywords: ['B'] },
  ],
  tieBreakOrder: ['a', 'b'],
};

const validate = (changes: Partial<AssessmentDefinition>) =>
  validateAssessmentDefinition({ ...validFixture, ...changes });

describe('validateAssessmentDefinition', () => {
  it('accepts a complete definition', () => {
    expect(validateAssessmentDefinition(validFixture)).toEqual([]);
  });

  it('reports question count, duplicate IDs, and too few options', () => {
    const errors = validate({
      questionCount: 9,
      questions: [
        validFixture.questions[0],
        { ...validFixture.questions[1], id: 'q1', options: [validFixture.questions[1].options[0]] },
      ],
    });

    expect(errors).toContain('fixture: questionCount 9 does not match 2 questions');
    expect(errors).toContain('fixture: duplicate question id q1');
    expect(errors).toContain('fixture/q1: expected at least 2 options');
  });

  it('reports unknown score dimensions and duplicate result IDs', () => {
    const errors = validate({
      questions: [
        {
          ...validFixture.questions[0],
          options: [
            { id: 'a', label: 'A', scores: { missing: 2 } },
            validFixture.questions[0].options[1],
          ],
        },
        validFixture.questions[1],
      ],
      results: [validFixture.results[0], { ...validFixture.results[1], id: 'a' }],
    });

    expect(errors).toContain('fixture/q1/a: unknown score dimension missing');
    expect(errors).toContain('fixture: duplicate result id a');
  });

  it('requires complete dominant results and tie order', () => {
    const errors = validate({
      results: [validFixture.results[0]],
      tieBreakOrder: ['a', 'missing'],
    });

    expect(errors).toContain('fixture: dominant dimension b has no matching result');
    expect(errors).toContain('fixture: tieBreakOrder contains unknown dimension missing');
    expect(errors).toContain('fixture: tieBreakOrder must contain each dimension exactly once');
  });

  it('requires valid MBTI pairs and a pair-linked tie question', () => {
    const noPairs = validate({ mode: 'mbti', tieBreakOrder: undefined });
    expect(noPairs).toContain('fixture: mbti mode requires at least one pair');

    const invalidPair = validate({
      mode: 'mbti',
      tieBreakOrder: undefined,
      mbtiPairs: [{ id: 'AB', left: 'a', right: 'b', tieQuestionId: 'missing' }],
    });
    expect(invalidPair).toContain('fixture/AB: tie question missing does not exist');

    const unrelatedTie = validate({
      mode: 'mbti',
      tieBreakOrder: undefined,
      mbtiPairs: [{ id: 'AB', left: 'a', right: 'b', tieQuestionId: 'q1' }],
      questions: [
        {
          ...validFixture.questions[0],
          options: [
            { id: 'a', label: 'A', scores: { a: 2 } },
            { id: 'b', label: 'B', scores: { a: 0 } },
          ],
        },
        validFixture.questions[1],
      ],
    });
    expect(unrelatedTie).toContain('fixture/AB: tie question q1 must score both a and b');
  });
});
