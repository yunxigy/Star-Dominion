import { getNativeToolById, NativeToolDefinition } from '../../data/toolRegistry';
import { getFavoriteToolIds, getRecentToolIds, recordRecentTool } from '../../services/history';
import { removeStorage } from '../../services/storage';

function resolveTools(ids: string[]): NativeToolDefinition[] {
  return ids
    .map((id) => getNativeToolById(id))
    .filter((tool): tool is NativeToolDefinition => Boolean(tool));
}

Page({
  data: {
    recentTools: [] as NativeToolDefinition[],
    favoriteTools: [] as NativeToolDefinition[],
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    this.setData({
      recentTools: resolveTools(getRecentToolIds()),
      favoriteTools: resolveTools(getFavoriteToolIds()),
    });
  },

  clearRecent() {
    wx.showModal({
      title: '清空最近使用',
      content: '确定要清空所有最近使用记录吗？',
      confirmColor: '#9a5a28',
      success: (result) => {
        if (!result.confirm) return;
        removeStorage('recent-tools');
        this.refresh();
      },
    });
  },

  goHome() {
    wx.switchTab({ url: '/pages/home/index' });
  },

  browseTools() {
    wx.switchTab({ url: '/pages/home/index' });
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