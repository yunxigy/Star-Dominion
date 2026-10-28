/// <reference path="../types/wechat-globals.ts" />

import { ToolResult } from '../utils/result';

export interface SelectedFile {
  name: string;
  path: string;
  size: number;
  type: string;
}

export interface FileValidationOptions {
  extensions?: readonly string[];
  mimeTypes?: readonly string[];
  maxBytes?: number;
}

export function getFileExtension(name: string): string {
  const cleanName = name.trim().split(/[?#]/)[0];
  const lastDot = cleanName.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === cleanName.length - 1) return '';
  return cleanName.slice(lastDot + 1).toLocaleLowerCase();
}

export function validateSelectedFile(
  file: SelectedFile,
  options: FileValidationOptions = {},
): ToolResult<SelectedFile> {
  if (!file.name || !file.path || !Number.isFinite(file.size) || file.size < 0) {
    return { ok: false, error: '文件信息无效' };
  }
  const extension = getFileExtension(file.name);
  const extensions = options.extensions?.map((item) => item.replace(/^\./, '').toLocaleLowerCase());
  if (extensions && !extensions.includes(extension)) {
    return { ok: false, error: `暂不支持 .${extension || 'unknown'} 文件` };
  }
  if (options.mimeTypes && file.type && !options.mimeTypes.includes(file.type)) {
    return { ok: false, error: '文件类型不符合要求' };
  }
  if (options.maxBytes !== undefined && file.size > options.maxBytes) {
    return { ok: false, error: `文件不能超过 ${formatBytes(options.maxBytes)}` };
  }
  return { ok: true, value: file };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface ChooseFileOptions {
  count?: number;
  type?: 'all' | 'video' | 'image' | 'file';
  extensions?: string[];
}

export function chooseFile(options: ChooseFileOptions = {}): Promise<SelectedFile[]> {
  return new Promise((resolve, reject) => {
    wx.chooseMessageFile({
      count: options.count ?? 1,
      type: options.type ?? 'file',
      extension: options.extensions,
      success: (result) => resolve(result.tempFiles.map((file) => ({
        name: file.name,
        path: file.path,
        size: file.size,
        type: file.type,
      }))),
      fail: (result) => reject(new Error(result.errMsg || '选择文件失败')),
    });
  });
}

export function readText(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'utf8',
      success: (result) => {
        if (typeof result.data === 'string') resolve(result.data);
        else reject(new Error('读取结果不是文本'));
      },
      fail: (result) => reject(new Error(result.errMsg || '读取文本失败')),
    });
  });
}

export function readBinary(filePath: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      success: (result) => {
        if (result.data instanceof ArrayBuffer) resolve(result.data);
        else reject(new Error('读取结果不是二进制内容'));
      },
      fail: (result) => reject(new Error(result.errMsg || '读取文件失败')),
    });
  });
}

export function saveTempFile(tempFilePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().saveFile({
      tempFilePath,
      success: (result) => resolve(result.savedFilePath),
      fail: (result) => reject(new Error(result.errMsg || '保存文件失败')),
    });
  });
}

export function openDocument(filePath: string, fileType?: 'doc' | 'docx' | 'xls' | 'xlsx' | 'ppt' | 'pptx' | 'pdf'): Promise<void> {
  return new Promise((resolve, reject) => {
    wx.openDocument({
      filePath,
      fileType,
      showMenu: true,
      success: () => resolve(),
      fail: (result) => reject(new Error(result.errMsg || '打开文件失败')),
    });
  });
}
