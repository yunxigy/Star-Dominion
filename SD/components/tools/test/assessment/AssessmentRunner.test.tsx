import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AssessmentRunner } from './AssessmentRunner';
import type { AssessmentDefinition } from './types';

const definition: AssessmentDefinition = {
  id: 'runner-fixture',
  title: '沟通风格测试',
  subtitle: '看看你如何与人交换想法',
  group: 'personality',
  questionCount: 1,
  estimatedMinutes: 2,
  mode: 'dominant',
  sensitive: false,
  intro: '这是一段介绍。',
  disclaimer: '仅供自我探索和娱乐。',
  minAnsweredRatio: 0,
  dimensions: [
    { id: 'direct', label: '直接', color: '#9a5a28', description: '直接表达' },
  ],
  questions: [
    {
      id: 'q1',
      prompt: '你会直接表达吗？',
      options: [
        { id: 'yes', label: '会', scores: { direct: 4 } },
        { id: 'no', label: '不会', scores: { direct: 0 } },
      ],
    },
  ],
  results: [
    { id: 'direct', title: '直接表达型', description: '表达清晰。', keywords: ['清晰', '坦率', '高效'] },
  ],
  tieBreakOrder: ['direct'],
};

describe('AssessmentRunner', () => {
  it('renders the local-only introduction before answering', () => {
    const html = renderToStaticMarkup(<AssessmentRunner definition={definition} onClose={() => {}} />);

    expect(html).toContain('沟通风格测试');
    expect(html).toContain('1 题');
    expect(html).toContain('约 2 分钟');
    expect(html).toContain('答案仅在当前页面处理');
    expect(html).toContain('开始测评');
  });

  it('renders a recoverable message when the definition is missing', () => {
    const html = renderToStaticMarkup(<AssessmentRunner onClose={() => {}} />);

    expect(html).toContain('测评配置加载失败');
    expect(html).toContain('关闭');
  });
});
