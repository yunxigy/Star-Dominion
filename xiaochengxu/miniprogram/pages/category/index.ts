import { getNativeCategoryById, getNativeToolById, getNativeToolsByCategory, searchNativeTools } from '../../data/toolRegistry';
import { recordRecentTool } from '../../services/history';

const SEARCH_DEBOUNCE_MS = 300;

Page({
  data: {
    category: '',
    title: '工具分类',
    tools: [] as Array<{ id: string; name: string; description: string }>,
    query: '',
    allTools: [] as Array<{ id: string; name: string; description: string; tags: string[] }>,
    readyCount: 0,
    migratingCount: 0,
  },

  searchTimer: 0 as ReturnType<typeof setTimeout> | 0,

  onLoad(options: Record<string, string | undefined>) {
    const category = options.category ?? '';
    const categoryInfo = getNativeCategoryById(category);
    const tools = getNativeToolsByCategory(category);
    const statuses = new Map(tools.map((tool) => [tool.id, tool.status]));
    this.setData({
      category,
      title: categoryInfo?.name ?? '全部工具',
      tools,
      allTools: tools,
      readyCount: tools.filter((tool) => statuses.get(tool.id) === 'ready').length,
      migratingCount: tools.filter((tool) => statuses.get(tool.id) === 'adapting').length,
    });
  },

  onUnload() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  },

  onSearchInput(event: WechatMiniprogram.Input) {
    const query = event.detail.value;
    this.setData({ query });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.searchTimer = 0;
      const allTools = this.data.allTools as Array<{ id: string; name: string; description: string; tags: string[] }>;
      const ids = new Set(searchNativeTools(query).map((tool) => tool.id));
      this.setData({
        tools: query ? allTools.filter((tool) => ids.has(tool.id)) : allTools,
      });
    }, SEARCH_DEBOUNCE_MS);
  },

  openTool(event: WechatMiniprogram.CustomEvent<WechatMiniprogram.IAnyObject>) {
    const id = String(event.detail.id ?? event.currentTarget.dataset.id ?? '');
    const tool = getNativeToolById(id);
    const route = tool?.route ?? '/pages/tool/index';
    recordRecentTool(id);
    wx.navigateTo({ url: `${route}?id=${encodeURIComponent(id)}` });
  },
});