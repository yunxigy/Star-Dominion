import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AssessmentRadarChart } from './AssessmentRadarChart';

const dimensions = [
  { id: 'a', label: '直接表达', color: '#b7583e', description: '清晰表达' },
  { id: 'b', label: '理性分析', color: '#537b98', description: '分析结构' },
  { id: 'c', label: '共情倾听', color: '#8c6179', description: '理解感受' },
  { id: 'd', label: '协作协调', color: '#6f9364', description: '推动合作' },
];

describe('AssessmentRadarChart', () => {
  it('renders an accessible SVG with labels and percentages', () => {
    const html = renderToStaticMarkup(
      <AssessmentRadarChart
        title="沟通风格"
        dimensions={dimensions}
        scores={{ a: 80, b: 60, c: 40, d: 20 }}
        accentColor="#6d4c8d"
      />,
    );

    expect(html).toContain('role="img"');
    expect(html).toContain('沟通风格维度雷达图');
    expect(html).toContain('直接表达：80%');
    expect(html).toContain('viewBox="0 0 320 340"');
  });

  it('describes null dimensions as information insufficient', () => {
    const html = renderToStaticMarkup(
      <AssessmentRadarChart
        title="沟通风格"
        dimensions={dimensions}
        scores={{ a: null, b: 60, c: 40, d: 20 }}
        accentColor="#6d4c8d"
      />,
    );

    expect(html).toContain('直接表达：信息不足');
    expect(html).toContain('stroke-dasharray="4 4"');
  });
});
