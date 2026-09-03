import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AssessmentResult } from './AssessmentResult';
import { communicationStyleDefinition } from './definitions/communicationStyle';
import { brainPowerDefinition } from './definitions/cognitiveDefinitions';
import { mbtiDefinition } from './definitions/mbti';
import type { AssessmentScoreResult } from './types';

const baseResult = {
  rankedDimensionIds: [],
  closeDimensionIds: [],
  insufficientDimensionIds: [],
};

describe('AssessmentResult visualization', () => {
  it('shows the radar chart and relative-score explanation for non-MBTI results', () => {
    const score: AssessmentScoreResult = {
      ...baseResult,
      dimensionScores: {
        direct: 80,
        analytical: 60,
        empathetic: 40,
        collaborative: 20,
      },
      rankedDimensionIds: ['direct', 'analytical', 'empathetic', 'collaborative'],
      primaryResultId: 'direct',
      secondaryResultId: 'analytical',
    };
    const html = renderToStaticMarkup(
      <AssessmentResult
        definition={communicationStyleDefinition}
        score={score}
        onRestart={() => {}}
        onClose={() => {}}
      />,
    );

    expect(html).toContain('沟通风格测试维度雷达图');
    expect(html).toContain('本次回答中的相对倾向');
  });

  it('keeps MBTI pair bars without a radar chart', () => {
    const score: AssessmentScoreResult = {
      ...baseResult,
      dimensionScores: {
        E: 60,
        I: 40,
        S: 55,
        N: 45,
        T: 70,
        F: 30,
        J: 65,
        P: 35,
      },
      mbtiType: 'ESTJ',
    };
    const html = renderToStaticMarkup(
      <AssessmentResult
        definition={mbtiDefinition}
        score={score}
        onRestart={() => {}}
        onClose={() => {}}
      />,
    );

    expect(html).not.toContain('维度雷达图');
    expect(html).toContain('E · 60');
    expect(html).toContain('I · 40');
  });

  it('shows accuracy for cognitive challenges without presenting an IQ score', () => {
    const html = renderToStaticMarkup(
      <AssessmentResult
        definition={brainPowerDefinition}
        score={{
          ...baseResult,
          dimensionScores: { memory: 100, attention: 80, logic: 60, flexibility: 40 },
          overallPercentage: 70,
          rankedDimensionIds: ['memory', 'attention', 'logic', 'flexibility'],
        }}
        onRestart={() => {}}
        onClose={() => {}}
      />,
    );

    expect(html).toContain('综合正确率');
    expect(html).toContain('70%');
    expect(html).not.toContain('IQ 分数');
    expect(html).toContain('复制结果分享');
  });

  it('keeps the selected test length visible on the result screen', () => {
    const html = renderToStaticMarkup(
      <AssessmentResult
        definition={communicationStyleDefinition}
        variant={{
          id: 'quick',
          label: '简易测试',
          description: '快速',
          estimatedMinutes: 3,
          questions: communicationStyleDefinition.questions.slice(0, 12),
        }}
        score={{
          ...baseResult,
          dimensionScores: { direct: 70, analytical: 60, empathetic: 50, collaborative: 40 },
          rankedDimensionIds: ['direct', 'analytical', 'empathetic', 'collaborative'],
          primaryResultId: 'direct',
          secondaryResultId: 'analytical',
        }}
        onRestart={() => {}}
        onClose={() => {}}
      />,
    );

    expect(html).toContain('本次完成：简易测试');
    expect(html).toContain('12 题');
  });
});
