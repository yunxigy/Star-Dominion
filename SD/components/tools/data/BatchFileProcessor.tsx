import React, { useState, useRef, useCallback } from 'react';
import { Btn, ResultBox, copyToClipboard, formatFileSize } from '../shared';
import { UploadZone } from '../shared';
import { Download, Trash2, FileText, FolderOpen, RefreshCw } from 'lucide-react';

type BatchMode = 'rename' | 'number' | 'replace' | 'classify' | 'pack';

interface FileItem {
  file: File;
  newName: string;
}

const BatchFileProcessor: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [mode, setMode] = useState<BatchMode>('rename');
  const [files, setFiles] = useState<FileItem[]>([]);
  const [result, setResult] = useState('');
  const [renamePattern, setRenamePattern] = useState('{name}_{n}');
  const [startNumber, setStartNumber] = useState(1);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [classifyBy, setClassifyBy] = useState<'type' | 'date' | 'name'>('type');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback((fileList: FileList | null) => {
    if (!fileList) return;
    const newFiles = Array.from(fileList).map(f => ({ file: f, newName: f.name }));
    setFiles(prev => [...prev, ...newFiles]);
  }, []);

  const applyRename = () => {
    setFiles(prev => prev.map((item, i) => {
      const ext = item.file.name.includes('.') ? '.' + item.file.name.split('.').pop() : '';
      const baseName = item.file.name.replace(/\.[^.]+$/, '');
      const newName = renamePattern
        .replace('{name}', baseName)
        .replace('{n}', String(startNumber + i))
        .replace('{i}', String(i + 1))
        .replace('{date}', new Date().toISOString().slice(0, 10))
        .replace('{ext}', ext);
      return { ...item, newName: newName + (newName.includes('.') ? '' : ext) };
    }));
    setResult(`重命名预览已更新`);
  };

  const applyNumber = () => {
    setFiles(prev => prev.map((item, i) => {
      const ext = item.file.name.includes('.') ? '.' + item.file.name.split('.').pop() : '';
      const num = String(startNumber + i).padStart(3, '0');
      return { ...item, newName: `${num}_${item.file.name}` };
    }));
    setResult('编号预览已更新');
  };

  const applyReplace = () => {
    if (!findText) return;
    setFiles(prev => prev.map(item => ({
      ...item,
      newName: item.newName.split(findText).join(replaceText),
    })));
    setResult(`替换预览已更新: "${findText}" → "${replaceText}"`);
  };

  const applyClassify = () => {
    const groups: Record<string, string[]> = {};
    files.forEach(item => {
      let key = '';
      if (classifyBy === 'type') {
        key = item.file.name.includes('.') ? item.file.name.split('.').pop()!.toLowerCase() : '其他';
      } else if (classifyBy === 'date') {
        key = new Date(item.file.lastModified).toISOString().slice(0, 10);
      } else {
        key = item.file.name[0].toUpperCase();
      }
      if (!groups[key]) groups[key] = [];
      groups[key].push(item.newName);
    });
    setResult(`分类结果:\n${Object.entries(groups).map(([k, v]) => `[${k}] (${v.length}个文件)\n  ${v.slice(0, 5).join(', ')}${v.length > 5 ? '...' : ''}`).join('\n\n')}`);
  };

  const packDownload = async () => {
    // Create a simple zip-like download (individual files)
    setResult('正在打包下载...');
    for (const item of files) {
      const url = URL.createObjectURL(item.file);
      const a = document.createElement('a');
      a.href = url;
      a.download = item.newName;
      a.click();
      URL.revokeObjectURL(url);
      await new Promise(r => setTimeout(r, 200));
    }
    setResult(`已下载 ${files.length} 个文件`);
  };

  const executeOperation = () => {
    switch (mode) {
      case 'rename': applyRename(); break;
      case 'number': applyNumber(); break;
      case 'replace': applyReplace(); break;
      case 'classify': applyClassify(); break;
      case 'pack': packDownload(); break;
    }
  };

  const modes: { key: BatchMode; label: string }[] = [
    { key: 'rename', label: '批量重命名' },
    { key: 'number', label: '编号' },
    { key: 'replace', label: '替换字符' },
    { key: 'classify', label: '按规则分类' },
    { key: 'pack', label: '打包下载' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {modes.map(m => (
          <button key={m.key} onClick={() => setMode(m.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${mode === m.key ? 'bg-[#7a421b] text-[#fff8ef]' : 'bg-[#f1dcc2] text-[#6f3714] hover:bg-[#ead0ad]'}`}>
            {m.label}
          </button>
        ))}
      </div>

      <UploadZone onUpload={() => inputRef.current?.click()} onDropFiles={handleFiles} accept="*/*" label="上传文件" sublabel="支持批量上传任意文件" />
      <input ref={inputRef} type="file" multiple className="hidden" onChange={e => handleFiles(e.target.files)} />

      {files.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-[#6d5a47]">已选择 {files.length} 个文件</span>
            <button onClick={() => setFiles([])} className="text-red-500 text-xs hover:underline">清空</button>
          </div>

          {mode === 'rename' && (
            <div className="space-y-2">
              <input value={renamePattern} onChange={e => setRenamePattern(e.target.value)} placeholder="重命名模板: {name}_{n}" className="w-full px-3 py-2 rounded-lg border border-[#c79f72] bg-white text-sm" />
              <p className="text-xs text-[#8b735c]">可用变量: {'{name}'} 原名, {'{n}'} 起始编号, {'{i}'} 序号, {'{date}'} 日期, {'{ext}'} 扩展名</p>
              <input type="number" value={startNumber} onChange={e => setStartNumber(Number(e.target.value))} className="w-32 px-3 py-2 rounded-lg border border-[#c79f72] bg-white text-sm" />
            </div>
          )}

          {mode === 'number' && (
            <input type="number" value={startNumber} onChange={e => setStartNumber(Number(e.target.value))} placeholder="起始编号" className="w-32 px-3 py-2 rounded-lg border border-[#c79f72] bg-white text-sm" />
          )}

          {mode === 'replace' && (
            <div className="flex gap-2">
              <input value={findText} onChange={e => setFindText(e.target.value)} placeholder="查找文本" className="flex-1 px-3 py-2 rounded-lg border border-[#c79f72] bg-white text-sm" />
              <input value={replaceText} onChange={e => setReplaceText(e.target.value)} placeholder="替换为" className="flex-1 px-3 py-2 rounded-lg border border-[#c79f72] bg-white text-sm" />
            </div>
          )}

          {mode === 'classify' && (
            <select value={classifyBy} onChange={e => setClassifyBy(e.target.value as any)} className="w-full px-3 py-2 rounded-lg border border-[#c79f72] bg-white text-sm">
              <option value="type">按文件类型</option>
              <option value="date">按修改日期</option>
              <option value="name">按首字母</option>
            </select>
          )}

          <div className="max-h-60 overflow-y-auto space-y-1">
            {files.map((item, i) => (
              <div key={i} className="flex items-center gap-2 bg-[#fff4e6] rounded-lg px-3 py-2">
                <FileText className="w-4 h-4 text-[#8b735c] flex-shrink-0" />
                <span className="text-xs text-[#6d5a47] flex-1 truncate">{item.file.name}</span>
                {item.newName !== item.file.name && (
                  <>
                    <span className="text-xs text-[#8b735c]">→</span>
                    <span className="text-xs text-[#7a421b] flex-1 truncate">{item.newName}</span>
                  </>
                )}
                <span className="text-xs text-[#8b735c]">{formatFileSize(item.file.size)}</span>
                <button onClick={() => setFiles(prev => prev.filter((_, idx) => idx !== i))} className="text-red-500 hover:text-red-700"><Trash2 className="w-3 h-3" /></button>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <Btn onClick={executeOperation}>执行操作</Btn>
            <Btn onClick={onClose} variant="ghost">关闭</Btn>
          </div>
        </div>
      )}

      {result && <ResultBox label="结果" value={result} onCopy={() => copyToClipboard(result)} />}
    </div>
  );
};

export default BatchFileProcessor;