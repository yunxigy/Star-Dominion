import { getNativeCategorySummaries, getNativeToolById, NATIVE_TOOLS, NativeToolDefinition, searchNativeTools } from '../../data/toolRegistry';
import { addSearchHistory, clearSearchHistory, getRecentToolIds, getSearchHistory, recordRecentTool } from '../../services/history';
import { iconEmoji } from '../../utils/icons';

const HOT_TOOL_IDS = [
  'json-format',
  'bmi-calculator',
  'url-encode',
  'percentage-calculator',
  'age-calculator',
  'date-diff',
];

const SEARCH_DEBOUNCE_MS = 300;

type CategoryCard = {
  id: string;
  name: string;
  description: string;
  count: number;
  icon: string;
};

type HistoryTag = {
  text: string;
};

Page({
  data: {
    query: '',
    categories: [] as CategoryCard[],
    hotTools: [] as NativeToolDefinition[],
    recentTools: [] as NativeToolDefinition[],
    searchResults: [] as NativeToolDefinition[],
    searchHistory: [] as HistoryTag[],
  },

  searchTimer: 0 as ReturnType<typeof setTimeout> | 0,

  onLoad() {
    const categories: CategoryCard[] = getNativeCategorySummaries().map((category) => ({
      id: category.id,
      name: category.name,
      description: category.description,
      count: category.count,
      icon: iconEmoji(category.icon),
    }));
    this.setData({ categories });
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const hotTools = HOT_TOOL_IDS.map((id) => NATIVE_TOOLS.find((tool) => tool.id === id))
      .filter((tool): tool is NativeToolDefinition => Boolean(tool) && tool!.status === 'ready');
    const recentTools = getRecentToolIds()
      .map((id) => getNativeToolById(id))
      .filter((tool): tool is NativeToolDefinition => Boolean(tool));
    this.setData({ hotTools, recentTools });
  },

  onSearchInput(event: WechatMiniprogram.Input) {
    const query = event.detail.value;
    this.setData({ query });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.searchTimer = 0;
      this.setData({ searchResults: searchNativeTools(query) });
    }, SEARCH_DEBOUNCE_MS);
  },

  onSearchFocus() {
    this.setData({ searchHistory: getSearchHistory().map((text) => ({ text })) });
  },

  onSearchConfirm(event: WechatMiniprogram.Input) {
    const query = String(event.detail.value ?? this.data.query ?? '');
    addSearchHistory(query);
    this.setData({
      searchResults: searchNativeTools(query),
      searchHistory: getSearchHistory().map((text) => ({ text })),
    });
  },

  onSearchClear() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = 0;
    this.setData({ query: '', searchResults: [], searchHistory: getSearchHistory().map((text) => ({ text })) });
  },

  clearSearchHistory() {
    clearSearchHistory();
    this.setData({ searchHistory: [] });
  },

  onUnload() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  },

  tapHistoryTag(event: WechatMiniprogram.CustomEvent<WechatMiniprogram.IAnyObject>) {
    const text = String(event.currentTarget.dataset.text ?? '');
    if (!text) return;
    addSearchHistory(text);
    this.setData({
      query: text,
      searchResults: searchNativeTools(text),
      searchHistory: getSearchHistory().map((item) => ({ text: item })),
    });
  },

  openCategory(event: WechatMiniprogram.CustomEvent<WechatMiniprogram.IAnyObject>) {
    const category = String(event.currentTarget.dataset.category ?? '');
    wx.navigateTo({ url: `/pages/category/index?category=${encodeURIComponent(category)}` });
  },

  openTool(event: WechatMiniprogram.CustomEvent<WechatMiniprogram.IAnyObject>) {
    const id = String(event.detail.id ?? event.currentTarget.dataset.id ?? '');
    const tool = getNativeToolById(id);
    const route = tool?.route ?? '/pages/tool/index';
    recordRecentTool(id);
    wx.navigateTo({ url: `${route}?id=${encodeURIComponent(id)}` });
  },

  onShareAppMessage() {
    return {
      title: '逐梦工具箱｜常用在线工具',
      path: '/pages/home/index',
    };
  },
});