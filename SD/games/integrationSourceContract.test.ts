import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('game navigation integration', () => {
  it('registers the game lobby and detail routes inside the shared app layout', () => {
    const app = source('../App.tsx');
    const layoutStart = app.indexOf('<Route element={<AppLayout />}>');
    const layoutEnd = app.indexOf('</Route>', layoutStart);

    expect(app).toContain('<Route path="/games" element={<GamesPage />} />');
    expect(app).toContain('<Route path="/games/:gameId" element={<GamePage />} />');
    expect(app.indexOf('<Route path="/games"')).toBeGreaterThan(layoutStart);
    expect(app.indexOf('<Route path="/games/:gameId"')).toBeLessThan(layoutEnd);
  });

  it('exposes the game lobby as a normal catalog item instead of a project card', () => {
    expect(source('../layouts/SidebarCatalog.tsx')).toContain('to="/games"');
    expect(source('../layouts/SidebarCatalog.tsx')).toContain('趣味游戏');
    expect(source('../layouts/AppLayout.tsx')).not.toContain('to="/games"');
    expect(source('../lib/projectLinks.ts')).not.toContain("path: '/games'");
  });
});
