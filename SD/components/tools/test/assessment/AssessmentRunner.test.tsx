// @vitest-environment jsdom

import React from 'react';
import { render } from '@testing-library/react';
import { screen, fireEvent } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import { AssessmentRunner } from './AssessmentRunner';
import { saveAssessmentProgress } from './assessmentHistory';
import { withAssessmentModes } from './modes';
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
  afterEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
  });

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

  it('lets users choose a quick or complete question set before starting', () => {
    const definitionWithModes = withAssessmentModes(definition, ['q1'], 1);
    render(<AssessmentRunner definition={definitionWithModes} onClose={() => {}} />);

    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.getByText('简易测试')).toBeTruthy();
    expect(screen.getByText('完整测试')).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: /简易测试/ }));

    expect(screen.getByRole('radio', { name: /简易测试/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /开始简易测试/ }));

    expect(screen.getByText('1 / 1')).toBeTruthy();
    expect(screen.getByText('你会直接表达吗？')).toBeTruthy();
  });

  it('offers to resume an unfinished local assessment', () => {
    saveAssessmentProgress({
      definitionId: definition.id,
      variantId: 'complete',
      currentIndex: 0,
      totalQuestions: 1,
      answers: {},
    });

    render(<AssessmentRunner definition={definition} onClose={() => {}} />);

    expect(screen.getByRole('button', { name: /继续上次进度/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /继续上次进度/ }));
    expect(screen.getByText('1 / 1')).toBeTruthy();
  });
});
