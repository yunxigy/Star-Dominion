import { getNativeToolById } from '../../../data/toolRegistry';

Page({
  data: {
    id: '',
    title: '媒体工具',
    description: '',
    status: 'adapting',
    workbench: '',
  },

  onLoad(options: Record<string, string | undefined>) {
    const id = options.id ?? '';
    const tool = getNativeToolById(id);
    this.setData({
      id,
      title: tool?.name ?? '媒体工具',
      description: tool?.description ?? '请选择一个图片或格式转换工具。',
      status: tool?.status ?? 'desktop-only',
      workbench: tool?.workbench ?? '',
    });
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  },
});
