export type SuggestibleTool = {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
};

const normalize = (value: string) => value.trim().toLocaleLowerCase('zh-CN');

export function getToolSuggestions<T extends SuggestibleTool>(tools: T[], query: string, limit = 6): T[] {
  const needle = normalize(query);
  if (!needle) return tools.slice(0, limit);

  return tools
    .map((tool, index) => {
      const name = normalize(tool.name);
      const description = normalize(tool.description ?? '');
      const tags = (tool.tags ?? []).map(normalize);
      let score = 0;

      if (name === needle) score += 100;
      if (name.startsWith(needle)) score += 20;
      if (name.includes(needle)) score += 12;
      if (description.includes(needle)) score += 4;
      tags.forEach(tag => {
        if (tag === needle) score += 18;
        else if (tag.includes(needle)) score += 8;
      });

      return { tool, score, index };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({ tool }) => tool);
}
