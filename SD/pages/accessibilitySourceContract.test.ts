import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('accessibility and route loading contracts', () => {
  it('lazy-loads non-home routes instead of eagerly importing page modules', () => {
    const text = source('../App.tsx');
    expect(text).toContain("import { lazy, Suspense } from 'react'");
    expect(text).toContain('Suspense');
    for (const page of ['ReportsPage', 'GitHubReportsPage', 'AIReportsPage', 'NewsEventsPage', 'AIBriefingPage', 'TranslationPage', 'Stm32Page', 'AIAgentPage', 'ShouAnRenPage']) {
      expect(text).not.toMatch(new RegExp(`import\\s+.*${page}\\s+from`));
    }
  });

  it('provides a skip link and a labelled main landmark', () => {
    const text = source('../layouts/AppLayout.tsx');
    expect(text).toContain('跳到主要内容');
    expect(text).toContain('id="main-content"');
  });
});
