import { describe, expect, it } from 'vitest';
import {
  detectVideoPlatform,
  formatVideoBytes,
  formatVideoDuration,
  stageLabel,
  videoDownloadFilePath,
} from '../xiaochengxu/miniprogram/services/video';

describe('native video tool helpers', () => {
  it('detects only supported public video platforms', () => {
    expect(detectVideoPlatform('https://www.bilibili.com/video/BV1xx')).toBe('bilibili');
    expect(detectVideoPlatform('https://v.douyin.com/abc/')).toBe('douyin');
    expect(detectVideoPlatform('https://youtube.com/watch?v=1')).toBeNull();
  });

  it('formats video metadata and protects download paths', () => {
    expect(formatVideoBytes(1536)).toBe('1.5 KB');
    expect(formatVideoDuration(65)).toBe('01:05');
    expect(stageLabel('downloading')).toBe('正在下载视频');
    expect(videoDownloadFilePath('a'.repeat(32))).toBe('/video-api/api/v1/downloads/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/file');
    expect(() => videoDownloadFilePath('../bad')).toThrow('任务编号无效');
  });
});
