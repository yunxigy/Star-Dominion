import type { ToolDef } from '../tools/registry';
import { absoluteSiteUrl, SITE } from './siteConfig';

type ToolSeoInput = {
  tool: Pick<ToolDef, 'name' | 'description'>;
  categoryName: string;
};

export function buildToolSeoDescription({ tool, categoryName }: ToolSeoInput): string {
  const description = `逐梦工具箱提供${tool.name}在线工具，${tool.description}。这是${categoryName}中的实用工具，支持浏览器直接操作，无需安装软件，页面提供清晰的工具说明，适合学习、办公、开发、个人项目与日常创作，帮助你快速完成相关任务，减少重复操作并提高处理效率，方便快速上手并完成工作。`;

  return description.length <= 160 ? description : `${description.slice(0, 159)}…`;
}

export function buildToolSeoTitle(toolName: string): string {
  return `${toolName} - ${SITE.name}`;
}

export function buildToolSeoUrl(toolId: string): string {
  return absoluteSiteUrl(`/tool/${encodeURIComponent(toolId)}`);
}
