import { describe, expect, it } from 'vitest';
import { getToolSuggestions, type SuggestibleTool } from './toolSuggestions';

const tools = [
  { id: 'json-format', name: 'JSON 格式化', description: '整理 JSON 文本', tags: ['json', '格式化'] },
  { id: 'json-viewer', name: 'JSON 查看器', description: '查看 JSON 数据', tags: ['json'] },
  { id: 'merge-pdf', name: 'PDF 合并', description: '合并 PDF 文件', tags: ['pdf'] },
] satisfies SuggestibleTool[];

describe('getToolSuggestions', () => {
  it('ranks shared tags and characters before unrelated tools', () => {
    expect(getToolSuggestions(tools, 'JSON').map(tool => tool.id)).toEqual([
      'json-format',
      'json-viewer',
    ]);
  });

  it('limits the number of suggestions', () => {
    expect(getToolSuggestions(tools, 'JSON', 1).map(tool => tool.id)).toEqual(['json-format']);
  });
});
