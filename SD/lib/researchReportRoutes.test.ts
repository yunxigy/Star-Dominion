import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';


const source = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8');


describe('research report module integration', () => {
  it('registers independent routes and proxy', () => {
    expect(source('../App.tsx')).toContain('path="/reports"');
    expect(source('../App.tsx')).toContain('path="/reports/github"');
    expect(source('../vite.config.ts')).toContain("'/reports-api':");
    expect(source('../pages/HomePage.tsx')).toContain('to="/reports"');
  });
});
