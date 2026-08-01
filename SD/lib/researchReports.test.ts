import { describe, expect, it } from 'vitest';

import { buildRankingUrl } from './researchReports';


describe('research reports API client', () => {
  it('encodes combined ranking filters', () => {
    expect(buildRankingUrl('issue-1', {
      category: 'typescript',
      query: 'agent kit',
      status: 'new',
      license: 'MIT',
    })).toBe('/issues/issue-1/rankings?category=typescript&query=agent+kit&status=new&license=MIT');
  });

  it('omits empty filters', () => {
    expect(buildRankingUrl('issue-1', { category: 'all', query: '  ' }))
      .toBe('/issues/issue-1/rankings?category=all');
  });
});
