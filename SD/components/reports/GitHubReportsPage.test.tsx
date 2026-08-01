import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';


const source = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8');


describe('GitHub reports page contracts', () => {
  it('renders every approved category and real-data states', () => {
    const page = source('../../pages/GitHubReportsPage.tsx');
    const viewModel = source('./reportViewModel.ts');
    for (const label of ['综合榜', 'Python', 'JavaScript', 'TypeScript', 'Go', 'Rust']) {
      expect(viewModel).toContain(label);
    }
    expect(page).toContain('数据延迟');
    expect(page).not.toContain('example/repository');
  });

  it('keeps rankings accessible and responsive', () => {
    const rankings = source('./RankingList.tsx');
    const filters = source('./ReportFilters.tsx');
    expect(rankings).toContain('rel="noopener noreferrer"');
    expect(rankings).toContain('md:hidden');
    expect(rankings).toContain('role="list"');
    expect(filters).toContain('role="tablist"');
    expect(filters).toContain('aria-selected');
  });

  it('shows collection controls only to administrators', () => {
    const panel = source('./AdminCollectionPanel.tsx');
    expect(panel).toContain("user?.role !== 'admin'");
    expect(panel).toContain('手动刷新');
  });
});
