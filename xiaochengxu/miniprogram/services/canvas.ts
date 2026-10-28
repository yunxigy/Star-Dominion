/// <reference path="../types/wechat-globals.ts" />

import { ToolResult } from '../utils/result';

export interface ImageSize {
  width: number;
  height: number;
}

export interface CropRect {
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
}

export function calculateContainSize(
  sourceWidth: number,
  sourceHeight: number,
  maxWidth: number,
  maxHeight: number,
): ImageSize {
  if (sourceWidth <= 0 || sourceHeight <= 0 || maxWidth <= 0 || maxHeight <= 0) {
    throw new RangeError('图片尺寸必须大于 0');
  }
  const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight);
  return { width: Math.max(1, Math.round(sourceWidth * scale)), height: Math.max(1, Math.round(sourceHeight * scale)) };
}

export function calculateCoverCrop(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): CropRect {
  if (sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) {
    throw new RangeError('图片尺寸必须大于 0');
  }
  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const cropWidth = targetWidth / scale;
  const cropHeight = targetHeight / scale;
  return {
    sourceX: Math.max(0, Math.round((sourceWidth - cropWidth) / 2)),
    sourceY: Math.max(0, Math.round((sourceHeight - cropHeight) / 2)),
    sourceWidth: Math.round(cropWidth),
    sourceHeight: Math.round(cropHeight),
  };
}

export interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

export function parseHexColor(input: string): ToolResult<RgbColor> {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(input.trim());
  if (!match) return { ok: false, error: '颜色应为六位十六进制，例如 #336699' };
  return {
    ok: true,
    value: {
      red: Number.parseInt(match[1], 16),
      green: Number.parseInt(match[2], 16),
      blue: Number.parseInt(match[3], 16),
    },
  };
}

export interface ImageOutputFormat {
  extension: string;
  mime: string;
  supported: boolean;
}

export function getImageOutputFormat(input: string): ImageOutputFormat {
  const normalized = input.replace(/^\./, '').toLocaleLowerCase();
  if (normalized === 'jpeg') return { extension: 'jpg', mime: 'image/jpeg', supported: true };
  if (normalized === 'jpg') return { extension: 'jpg', mime: 'image/jpeg', supported: true };
  if (normalized === 'png') return { extension: 'png', mime: 'image/png', supported: true };
  return { extension: normalized || 'png', mime: normalized ? `image/${normalized}` : 'image/png', supported: false };
}

export function getImageInfo(filePath: string): Promise<ImageSize> {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src: filePath,
      success: (result) => resolve({ width: result.width, height: result.height }),
      fail: (result) => reject(new Error(result.errMsg || '读取图片尺寸失败')),
    });
  });
}

export interface CanvasExportOptions {
  canvasId: string;
  fileType: 'jpg' | 'png';
  width?: number;
  height?: number;
  destWidth?: number;
  destHeight?: number;
  quality?: number;
}

export function exportCanvasToFile(options: CanvasExportOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvasId: options.canvasId,
      fileType: options.fileType,
      width: options.width,
      height: options.height,
      destWidth: options.destWidth,
      destHeight: options.destHeight,
      quality: options.quality,
      success: (result) => resolve(result.tempFilePath),
      fail: (result) => reject(new Error(result.errMsg || '导出图片失败')),
    });
  });
}
