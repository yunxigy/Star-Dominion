import { describe, expect, it } from 'vitest';
import {
  getFileExtension,
  validateSelectedFile,
} from '../xiaochengxu/miniprogram/services/file';
import {
  calculateContainSize,
  calculateCoverCrop,
  getImageOutputFormat,
  parseHexColor,
} from '../xiaochengxu/miniprogram/services/canvas';

describe('native file and image adapters', () => {
  it('normalizes file extensions and rejects unsupported or oversized files', () => {
    expect(getFileExtension('报告.PDF')).toBe('pdf');
    expect(getFileExtension('no-extension')).toBe('');
    const valid = validateSelectedFile(
      { name: 'photo.PNG', path: '/tmp/photo.PNG', size: 1024, type: 'image' },
      { extensions: ['png', 'jpg'], maxBytes: 2048 },
    );
    expect(valid.ok).toBe(true);
    expect(validateSelectedFile(
      { name: 'report.exe', path: '/tmp/report.exe', size: 100, type: 'file' },
      { extensions: ['pdf'] },
    ).ok).toBe(false);
    expect(validateSelectedFile(
      { name: 'large.jpg', path: '/tmp/large.jpg', size: 4096, type: 'image' },
      { extensions: ['jpg'], maxBytes: 1024 },
    ).ok).toBe(false);
  });

  it('calculates contain size and centered cover crop without distortion', () => {
    expect(calculateContainSize(400, 200, 100, 100)).toEqual({ width: 100, height: 50 });
    expect(calculateCoverCrop(400, 200, 100, 100)).toEqual({
      sourceX: 100,
      sourceY: 0,
      sourceWidth: 200,
      sourceHeight: 200,
    });
  });

  it('parses colors and exposes only formats supported by mini program Canvas', () => {
    expect(parseHexColor('#336699')).toEqual({ ok: true, value: { red: 51, green: 102, blue: 153 } });
    expect(parseHexColor('#fff').ok).toBe(false);
    expect(getImageOutputFormat('jpeg')).toEqual({ extension: 'jpg', mime: 'image/jpeg', supported: true });
    expect(getImageOutputFormat('webp').supported).toBe(false);
  });
});
