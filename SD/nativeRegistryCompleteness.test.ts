import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NATIVE_TOOLS } from '../xiaochengxu/miniprogram/data/toolRegistry';
import type { NativeToolStatus } from '../xiaochengxu/miniprogram/types/tool';

type WebsiteTool = { id: string; category: string };

function readWebsiteTools(): WebsiteTool[] {
  const source = readFileSync(new URL('./tools/registry.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('const TOOL_DEFINITIONS');
  const end = source.indexOf('export const TOOLS');
  return [...source.slice(start, end).matchAll(/\{ id: '([^']+)'[^\n]*category: '([^']+)'/g)].map((match) => ({
    id: match[1],
    category: match[2],
  }));
}

describe('native registry completeness', () => {
  it('accounts for every non-mouse website tool with an explicit native status', () => {
    const excluded = new Set(readWebsiteTools().filter((tool) => tool.category === 'mouse').map((tool) => tool.id));
    const native = new Map(NATIVE_TOOLS.map((tool) => [tool.id, tool]));
    const allowedStatuses = new Set<NativeToolStatus>(['ready', 'adapting', 'desktop-only']);

    for (const websiteTool of readWebsiteTools()) {
      if (excluded.has(websiteTool.id)) continue;
      const tool = native.get(websiteTool.id);
      expect(tool, `${websiteTool.id} missing from native registry`).toBeDefined();
      expect(allowedStatuses.has(tool!.status), `${websiteTool.id} has invalid status`).toBe(true);
      if (tool!.status !== 'ready') expect(tool!.limitation?.trim(), `${websiteTool.id} needs a limitation`).toBeTruthy();
    }
  });

  it('keeps mouse tools discoverable only as desktop capabilities', () => {
    const mouseIds = readWebsiteTools().filter((tool) => tool.category === 'mouse').map((tool) => tool.id);
    expect(mouseIds.every((id) => NATIVE_TOOLS.find((tool) => tool.id === id)?.status === 'desktop-only' || !NATIVE_TOOLS.some((tool) => tool.id === id))).toBe(true);
  });
});
