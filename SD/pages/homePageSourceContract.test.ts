import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./HomePage.tsx', import.meta.url), 'utf8');

describe('homepage spacing and copy contract', () => {
  it('uses the 200+ online-tools headline copy', () => {
    expect(source).toContain("'200+ 免费在线工具，助力高效工作'");
    expect(source).not.toContain("'100+ 免费在线工具，助力高效工作'");
  });

  it('keeps the right rail in natural flow instead of distributing a forced gap', () => {
    expect(source).toContain('className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_420px] items-start"');
    expect(source).not.toContain('items-stretch');
    expect(source).toContain('className="glass-card rounded-[2rem] p-6 sm:p-8 flex flex-col gap-8"');
    expect(source).not.toContain('flex flex-col justify-between gap-8');
  });
});
