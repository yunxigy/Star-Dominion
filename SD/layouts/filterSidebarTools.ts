import type { ToolDef } from '../tools/registry';

const normalize = (value: string) => value.trim().toLocaleLowerCase('zh-CN');

export function filterSidebarTools(tools: ToolDef[], query: string, limit = 20): ToolDef[] {
  const needle = normalize(query);
  if (!needle) return [];

  return tools
    .filter(tool => normalize([tool.name, tool.description, ...(tool.tags ?? [])].join(' ')).includes(needle))
    .slice(0, limit);
}
