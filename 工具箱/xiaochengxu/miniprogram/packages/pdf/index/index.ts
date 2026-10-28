import { getNativeToolById } from '../../../data/toolRegistry';

Page({
  data: { id: '', title: 'PDF 工具', description: '', status: 'adapting', workbench: '' },
  onLoad(options: Record<string, string | undefined>) {
    const id = options.id ?? '';
    const tool = getNativeToolById(id);
    this.setData({ id, title: tool?.name ?? 'PDF 工具', description: tool?.description ?? '', status: tool?.status ?? 'desktop-only', workbench: tool?.workbench ?? '' });
  },
  goBack() { wx.navigateBack({ delta: 1 }); },
});
