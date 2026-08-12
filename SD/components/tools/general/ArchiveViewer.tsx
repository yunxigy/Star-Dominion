import React, { useState, useRef } from 'react';
import { Btn, copyToClipboard, UploadZone, formatFileSize } from '../shared';
import { FileArchive, Download, Copy, CheckCircle, Folder, File } from 'lucide-react';

interface ArchiveEntry {
  name: string;
  size: number;
  compressedSize?: number;
  isDirectory: boolean;
  path: string;
  date?: string;
}

const ArchiveViewer: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [entries, setEntries] = useState<ArchiveEntry[]>([]);
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState(0);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'path'>('path');
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(['']));
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setFileName(file.name);
    setFileSize(file.size);
    setError('');
    setEntries([]);

    try {
      // Try using JSZip for zip files
      if (file.name.endsWith('.zip')) {
        const JSZip = await import('jszip');
        const zip = await JSZip.default.loadAsync(file);
        const items: ArchiveEntry[] = [];

        zip.forEach((relativePath, zipEntry) => {
          items.push({
            name: zipEntry.name.split('/').pop() || zipEntry.name,
            size: (zipEntry as any)._data ? ((zipEntry as any)._data.uncompressedSize || 0) : 0,
            compressedSize: (zipEntry as any)._data ? ((zipEntry as any)._data.compressedSize || 0) : 0,
            isDirectory: zipEntry.dir,
            path: relativePath,
            date: zipEntry.date ? zipEntry.date.toISOString().split('T')[0] : undefined,
          });
        });

        setEntries(items);
        setExpandedDirs(new Set(['']));
      } else {
        // For other archive formats, show file info only
        setError(`当前仅支持 .zip 格式预览。${file.name} 为 ${file.name.split('.').pop()?.toUpperCase()} 格式，暂不支持在线解压。`);
      }
    } catch (e) {
      setError(`解析失败: ${e instanceof Error ? e.message : '未知错误'}`);
    }
  };

  const filteredEntries = entries
    .filter(e => !searchText || e.path.toLowerCase().includes(searchText.toLowerCase()) || e.name.toLowerCase().includes(searchText.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'size') return b.size - a.size;
      return a.path.localeCompare(b.path);
    });

  // Build tree structure
  const buildTree = () => {
    const tree: Map<string, ArchiveEntry[]> = new Map();
    for (const entry of filteredEntries) {
      const dir = entry.path.substring(0, entry.path.lastIndexOf('/') + 1) || '/';
      if (!tree.has(dir)) tree.set(dir, []);
      tree.get(dir)!.push(entry);
    }
    return tree;
  };

  const tree = buildTree();
  const allDirs = [...new Set(entries.map(e => {
    const parts = e.path.split('/');
    const dirs: string[] = [];
    for (let i = 1; i < parts.length; i++) {
      dirs.push(parts.slice(0, i).join('/') + '/');
    }
    return dirs;
  }).flat())].sort();

  const toggleDir = (dir: string) => {
    const next = new Set(expandedDirs);
    if (next.has(dir)) next.delete(dir); else next.add(dir);
    setExpandedDirs(next);
  };

  const isDirVisible = (entryPath: string): boolean => {
    const dir = entryPath.substring(0, entryPath.lastIndexOf('/') + 1);
    if (!dir || dir === '/') return true;
    // Check all parent dirs are expanded
    const parts = dir.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current += part + '/';
      if (!expandedDirs.has(current)) return false;
    }
    return true;
  };

  const totalSize = entries.reduce((sum, e) => sum + (e.isDirectory ? 0 : e.size), 0);
  const totalCompressed = entries.reduce((sum, e) => sum + (e.compressedSize || 0), 0);
  const fileCount = entries.filter(e => !e.isDirectory).length;
  const dirCount = entries.filter(e => e.isDirectory).length;

  const handleCopyList = async () => {
    const text = entries.map(e => `${e.isDirectory ? '📁' : '📄'} ${e.path} ${e.size > 0 ? formatFileSize(e.size) : ''}`).join('\n');
    await copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b735c]">压缩包预览与处理 — 查看 .zip 文件内容列表</p>

      <UploadZone onUpload={() => fileInputRef.current?.click()} accept=".zip,.rar,.7z,.tar,.gz,.bz2,.xz" />
      <input ref={fileInputRef} type="file" accept=".zip,.rar,.7z,.tar,.gz,.bz2,.xz" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFile(file); }} />

      {error && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">{error}</div>
      )}

      {entries.length > 0 && (
        <>
          {/* File info */}
          <div className="bg-[#fff4e6] border border-[#ead0ad] rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <FileArchive className="w-4 h-4 text-[#7a421b]" />
              <span className="text-xs font-medium text-[#6f3714]">{fileName}</span>
              <span className="text-[10px] text-[#8b735c]">{formatFileSize(fileSize)}</span>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="bg-white rounded border border-[#ead0ad] p-1.5">
                <div className="text-lg font-bold text-[#7a421b]">{fileCount}</div>
                <div className="text-[10px] text-[#8b735c]">文件</div>
              </div>
              <div className="bg-white rounded border border-[#ead0ad] p-1.5">
                <div className="text-lg font-bold text-[#7a421b]">{dirCount}</div>
                <div className="text-[10px] text-[#8b735c]">文件夹</div>
              </div>
              <div className="bg-white rounded border border-[#ead0ad] p-1.5">
                <div className="text-sm font-bold text-[#7a421b]">{formatFileSize(totalSize)}</div>
                <div className="text-[10px] text-[#8b735c]">原始大小</div>
              </div>
              <div className="bg-white rounded border border-[#ead0ad] p-1.5">
                <div className="text-sm font-bold text-[#7a421b]">{totalCompressed > 0 ? `${Math.round((1 - totalCompressed / totalSize) * 100)}%` : '-'}</div>
                <div className="text-[10px] text-[#8b735c]">压缩率</div>
              </div>
            </div>
          </div>

          {/* Search & sort */}
          <div className="flex gap-2">
            <input value={searchText} onChange={e => setSearchText(e.target.value)}
              className="flex-1 text-xs border border-[#ead0ad] rounded-lg px-3 py-1.5 bg-white focus:border-[#7a421b] focus:outline-none"
              placeholder="搜索文件名..." />
            <select value={sortBy} onChange={e => setSortBy(e.target.value as 'name' | 'size' | 'path')}
              className="text-xs border border-[#ead0ad] rounded px-2 py-1 bg-white">
              <option value="path">按路径</option>
              <option value="name">按名称</option>
              <option value="size">按大小</option>
            </select>
            <button onClick={handleCopyList} className="p-1 text-[#7a421b] hover:text-[#6f3714]">
              {copied ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>

          {/* File list */}
          <div className="border border-[#ead0ad] rounded-lg max-h-64 overflow-y-auto bg-white">
            {filteredEntries.filter(e => isDirVisible(e.path)).map((entry, i) => (
              <div key={i}
                className={`flex items-center gap-2 px-3 py-1.5 text-xs border-b border-[#ead0ad] last:border-0 hover:bg-[#fff4e6]
                  ${entry.isDirectory ? 'font-medium text-[#6f3714]' : 'text-[#6d5a47]'}`}>
                {entry.isDirectory ? (
                  <button onClick={() => toggleDir(entry.path)}
                    className="flex items-center gap-1 flex-1">
                    <Folder className="w-3 h-3 text-[#c79f72]" />
                    <span>{expandedDirs.has(entry.path) ? '📂' : '📁'} {entry.name}</span>
                  </button>
                ) : (
                  <>
                    <File className="w-3 h-3 text-[#c79f72] shrink-0" />
                    <span className="flex-1 truncate font-mono">{entry.name}</span>
                    <span className="text-[10px] text-[#8b735c] shrink-0">{entry.size > 0 ? formatFileSize(entry.size) : '-'}</span>
                    {entry.date && <span className="text-[10px] text-[#c79f72] shrink-0">{entry.date}</span>}
                  </>
                )}
              </div>
            ))}
            {filteredEntries.length === 0 && (
              <div className="text-center text-xs text-[#8b735c] py-4">无匹配文件</div>
            )}
          </div>

          <div className="text-[10px] text-[#8b735c]">
            显示 {filteredEntries.length} / {entries.length} 项
          </div>
        </>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-[10px] text-amber-700">
        提示：当前仅支持 .zip 格式的在线预览。RAR、7z 等格式需要后端解压服务支持。
      </div>

      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    </div>
  );
};

export default ArchiveViewer;