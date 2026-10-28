import { getNativeToolById } from '../../../data/toolRegistry';

Page({
  data: {
    title: '视频解析下载',
    description: '解析抖音和哔哩哔哩单个公开视频并临时下载。',
  },

  onLoad(options: Record<string, string | undefined>) {
    const tool = getNativeToolById(options.id ?? 'video-parser-downloader');
    this.setData({
      title: tool?.name ?? '视频解析下载',
      description: tool?.description ?? '解析抖音和哔哩哔哩单个公开视频并临时下载。',
    });
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  },
});
