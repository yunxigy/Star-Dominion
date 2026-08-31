import { describe, expect, it } from 'vitest';

import { getToolById, getToolsByCategory } from './registry';

describe('fun tool registry', () => {
  it('publishes the local dice tool in the fun category', () => {
    expect(getToolById('dice-tool')).toMatchObject({
      name: '幸运骰子',
      description: '多种面数与颗数的本地随机骰子',
      category: 'fun',
      privacy: 'local',
      status: 'stable',
    });
    expect(getToolsByCategory('fun').map(tool => tool.id)).toContain('dice-tool');
  });
});
