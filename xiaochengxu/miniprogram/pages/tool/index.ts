import { getNativeToolById } from '../../data/toolRegistry';

Page({
  data: {
    id: '',
    title: '工具详情',
    description: '',
    limitation: '',
    status: 'adapting',
    workbench: '',
  },

  onLoad(options: Record<string, string | undefined>) {
    const id = options.id ?? '';
    const tool = getNativeToolById(id);
    this.setData({
      id,
      title: tool?.name ?? '工具不存在',
      description: tool?.description ?? '请返回工具箱重新选择。',
      limitation: tool?.limitation ?? '',
      status: tool?.status ?? 'desktop-only',
      workbench: tool?.workbench ?? '',
    });
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  },
});
