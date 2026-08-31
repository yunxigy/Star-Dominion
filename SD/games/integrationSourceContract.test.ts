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

  it('exposes the game lobby from the sidebar and project gallery', () => {
    expect(source('../layouts/AppLayout.tsx')).toContain('to="/games"');
    expect(source('../layouts/AppLayout.tsx')).toContain('趣味游戏');
    expect(source('../lib/projectLinks.ts')).toContain("path: '/games'");
  });
});
