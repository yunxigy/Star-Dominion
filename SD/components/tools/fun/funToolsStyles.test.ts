import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(new URL('../../../index.css', import.meta.url), 'utf8');

describe('fun tool styles', () => {
  it('provides the visual primitives used by the lottery and dice workbenches', () => {
    for (const selector of ['.lottery-tool', '.lottery-wheel', '.lottery-mode-card', '.dice-tool', '.dice-face']) {
      expect(stylesheet).toContain(selector);
    }
  });

  it('includes motion-safe fallbacks for the new animated workbenches', () => {
    expect(stylesheet).toContain('.lottery-wheel.is-spinning');
    expect(stylesheet).toContain('.dice-result-card.is-rolling');
    expect(stylesheet).toMatch(/prefers-reduced-motion:\s*reduce/);
  });
});
