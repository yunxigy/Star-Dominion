import { describe, expect, it } from 'vitest';
import { filterSidebarTools } from './filterSidebarTools';

const tools = [
  { id: 'json-format', name: 'JSON 格式化', description: '整理 JSON 文本', tags: ['json', '格式化'] },
  { id: 'merge-pdf', name: 'PDF 合并', description: '合并多个 PDF 文件', tags: ['pdf'] },
] as never[];

describe('filterSidebarTools', () => {
  it('matches tool names and aliases', () => {
    expect(filterSidebarTools(tools, '格式化').map(tool => tool.id)).toEqual(['json-format']);
    expect(filterSidebarTools(tools, 'pdf').map(tool => tool.id)).toEqual(['merge-pdf']);
  });

  it('returns no matches for a blank query', () => {
    expect(filterSidebarTools(tools, '   ')).toEqual([]);
  });
});
