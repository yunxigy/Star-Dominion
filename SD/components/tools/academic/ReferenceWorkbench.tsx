import React, { useState, useRef, useCallback } from 'react';
import { Btn, ResultBox, copyToClipboard } from '../shared';
import { UploadZone } from '../shared';
import { BookOpen, Plus, Trash2, Download, Shuffle, CheckCircle, AlertTriangle } from 'lucide-react';

interface RefEntry {
  id: string;
  type: 'journal' | 'conference' | 'book' | 'thesis' | 'web' | 'other';
  authors: string;
  title: string;
  year: string;
  journal?: string;
  publisher?: string;
  volume?: string;
  pages?: string;
  url?: string;
  doi?: string;
  school?: string;
}

const TYPE_LABELS: Record<RefEntry['type'], string> = {
  journal: '期刊论文',
  conference: '会议论文',
  book: '书籍',
  thesis: '学位论文',
  web: '网络资源',
  other: '其他',
};

const generateId = () => Math.random().toString(36).slice(2, 9);

const toGB7714 = (ref: RefEntry): string => {
  const authors = ref.authors || '佚名';
  switch (ref.type) {
    case 'journal':
      return `${authors}. ${ref.title}[J]. ${ref.journal || ''}${ref.year ? ', ' + ref.year : ''}${ref.volume ? ', ' + ref.volume : ''}${ref.pages ? ': ' + ref.pages : ''}.`;
    case 'conference':
      return `${authors}. ${ref.title}[C]//${ref.journal || '会议论文集'}. ${ref.publisher || ''}${ref.year ? ', ' + ref.year : ''}${ref.pages ? ': ' + ref.pages : ''}.`;
    case 'book':
      return `${authors}. ${ref.title}[M]. ${ref.publisher || ''}${ref.year ? ', ' + ref.year : ''}.`;
    case 'thesis':
      return `${authors}. ${ref.title}[D]. ${ref.school || ''}${ref.year ? ', ' + ref.year : ''}.`;
    case 'web':
      return `${authors}. ${ref.title}[EB/OL]. ${ref.url || ''}${ref.year ? ', ' + ref.year : ''}.`;
    default:
      return `${authors}. ${ref.title}. ${ref.year || ''}.`;
  }
};

const toAPA = (ref: RefEntry): string => {
  const authors = ref.authors || '佚名';
  switch (ref.type) {
    case 'journal':
      return `${authors} (${ref.year}). ${ref.title}. ${ref.journal || ''}${ref.volume ? ', ' + ref.volume : ''}${ref.pages ? ', ' + ref.pages : ''}.`;
    case 'book':
      return `${authors} (${ref.year}). ${ref.title}. ${ref.publisher || ''}.`;
    case 'thesis':
      return `${authors} (${ref.year}). ${ref.title} [Doctoral dissertation, ${ref.school || ''}].`;
    default:
      return `${authors} (${ref.year}). ${ref.title}.`;
  }
};

const toMLA = (ref: RefEntry): string => {
  const authors = ref.authors || '佚名';
  switch (ref.type) {
    case 'journal':
      return `${authors}. "${ref.title}." ${ref.journal || ''}${ref.volume ? ' ' + ref.volume : ''} (${ref.year || ''})${ref.pages ? ': ' + ref.pages : ''}.`;
    case 'book':
      return `${authors}. ${ref.title}. ${ref.publisher || ''}, ${ref.year || ''}.`;
    default:
      return `${authors}. "${ref.title}." ${ref.year || ''}.`;
  }
};

const parseReference = (text: string): RefEntry[] => {
  const refs: RefEntry[] = [];
  const lines = text.split('\n').filter(l => l.trim());
  for (const line of lines) {
    const typeMatch = line.match(/\[(J|C|M|D|EB\/OL|N|R|S|P)\]/i);
    let type: RefEntry['type'] = 'other';
    if (typeMatch) {
      const t = typeMatch[1].toUpperCase();
      if (t === 'J') type = 'journal';
      else if (t === 'C') type = 'conference';
      else if (t === 'M') type = 'book';
      else if (t === 'D') type = 'thesis';
      else if (t === 'EB/OL') type = 'web';
    }
    const authorMatch = line.match(/^([^.]+)/);
    const titleMatch = line.match(/\]\s*([^.]+)/);
    const yearMatch = line.match(/(\d{4})/);
    refs.push({
      id: generateId(),
      type,
      authors: authorMatch ? authorMatch[1].trim() : '',
      title: titleMatch ? titleMatch[1].trim() : line.slice(0, 50),
      year: yearMatch ? yearMatch[1] : '',
    });
  }
  return refs;
};

const ReferenceWorkbench: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [refs, setRefs] = useState<RefEntry[]>([]);
  const [format, setFormat] = useState<'gb7714' | 'apa' | 'mla'>('gb7714');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const addRef = () => {
    setRefs(prev => [...prev, {
      id: generateId(),
      type: 'journal',
      authors: '',
      title: '',
      year: new Date().getFullYear().toString(),
    }]);
  };

  const updateRef = (id: string, field: keyof RefEntry, value: string) => {
    setRefs(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const removeRef = (id: string) => {
    setRefs(prev => prev.filter(r => r.id !== id));
  };

  const importText = () => {
    if (!inputText.trim()) return;
    const parsed = parseReference(inputText);
    setRefs(prev => [...prev, ...parsed]);
    setInputText('');
  };

  const handleFile = useCallback(async (fl: FileList | null) => {
    if (!fl?.[0]) return;
    const text = await fl[0].text();
    const parsed = parseReference(text);
    setRefs(prev => [...prev, ...parsed]);
  }, []);

  const sortRefs = () => {
    setRefs(prev => [...prev].sort((a, b) => {
      const aAuth = a.authors.localeCompare(b.authors, 'zh-CN');
      if (aAuth !== 0) return aAuth;
      return (a.year || '').localeCompare(b.year || '');
    }));
  };

  const exportRefs = () => {
    const formatter = format === 'gb7714' ? toGB7714 : format === 'apa' ? toAPA : toMLA;
    const output = refs.map((r, i) => `[${i + 1}] ${formatter(r)}`).join('\n');
    copyToClipboard(output);
  };

  const checkDuplicates = () => {
    const seen = new Map<string, number>();
    const dupes: number[] = [];
    refs.forEach((r, i) => {
      const key = (r.title + r.authors + r.year).toLowerCase().replace(/\s/g, '');
      if (seen.has(key)) {
        dupes.push(i + 1);
      } else {
        seen.set(key, i + 1);
      }
    });
    return dupes;
  };

  const duplicates = checkDuplicates();

  const formatLabel = format === 'gb7714' ? 'GB/T 7714' : format === 'apa' ? 'APA' : 'MLA';

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b735c]">管理参考文献：添加/导入/排序/去重，一键生成 GB/T 7714、APA、MLA 格式</p>

      <div className="flex gap-2 flex-wrap">
        <Btn onClick={addRef}><Plus className="w-4 h-4 mr-1" />手动添加</Btn>
        <Btn onClick={sortRefs} variant="secondary"><Shuffle className="w-4 h-4 mr-1" />按作者排序</Btn>
        <UploadZone onUpload={() => inputRef.current?.click()} onDropFiles={handleFile} accept=".txt,.bib" label="导入文件" sublabel=".txt / .bib" compact />
        <input ref={inputRef} type="file" className="hidden" accept=".txt,.bib" onChange={e => handleFile(e.target.files)} />
      </div>

      {duplicates.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          <span className="text-xs text-amber-700">检测到 {duplicates.length} 条可能重复的参考文献（序号: {duplicates.join(', ')}）</span>
        </div>
      )}

      <div className="space-y-2 max-h-60 overflow-y-auto">
        {refs.map((ref, i) => (
          <div key={ref.id} className="bg-[#fff4e6] border border-[#ead0ad] rounded-lg p-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-[#6f3714]">[{i + 1}] {TYPE_LABELS[ref.type]}</span>
              <div className="flex gap-1">
                <button onClick={() => setEditingId(editingId === ref.id ? null : ref.id)} className="text-xs text-[#7a421b] hover:underline">编辑</button>
                <button onClick={() => removeRef(ref.id)} className="text-xs text-red-500 hover:underline"><Trash2 className="w-3 h-3" /></button>
              </div>
            </div>
            {editingId === ref.id ? (
              <div className="space-y-1">
                <div className="flex gap-2">
                  <select value={ref.type} onChange={e => updateRef(ref.id, 'type', e.target.value)}
                    className="text-xs border border-[#ead0ad] rounded px-1 py-0.5 bg-white">
                    {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <input value={ref.year} onChange={e => updateRef(ref.id, 'year', e.target.value)} placeholder="年份"
                    className="text-xs border border-[#ead0ad] rounded px-1 py-0.5 flex-1 bg-white" />
                </div>
                <input value={ref.authors} onChange={e => updateRef(ref.id, 'authors', e.target.value)} placeholder="作者（用逗号分隔）"
                  className="text-xs border border-[#ead0ad] rounded px-1 py-0.5 w-full bg-white" />
                <input value={ref.title} onChange={e => updateRef(ref.id, 'title', e.target.value)} placeholder="标题"
                  className="text-xs border border-[#ead0ad] rounded px-1 py-0.5 w-full bg-white" />
                {ref.type === 'journal' && <input value={ref.journal || ''} onChange={e => updateRef(ref.id, 'journal', e.target.value)} placeholder="期刊名" className="text-xs border border-[#ead0ad] rounded px-1 py-0.5 w-full bg-white" />}
                {ref.type === 'book' && <input value={ref.publisher || ''} onChange={e => updateRef(ref.id, 'publisher', e.target.value)} placeholder="出版社" className="text-xs border border-[#ead0ad] rounded px-1 py-0.5 w-full bg-white" />}
                {ref.type === 'thesis' && <input value={ref.school || ''} onChange={e => updateRef(ref.id, 'school', e.target.value)} placeholder="学校" className="text-xs border border-[#ead0ad] rounded px-1 py-0.5 w-full bg-white" />}
                <input value={ref.volume || ''} onChange={e => updateRef(ref.id, 'volume', e.target.value)} placeholder="卷号/期号"
                  className="text-xs border border-[#ead0ad] rounded px-1 py-0.5 w-full bg-white" />
                <input value={ref.pages || ''} onChange={e => updateRef(ref.id, 'pages', e.target.value)} placeholder="页码"
                  className="text-xs border border-[#ead0ad] rounded px-1 py-0.5 w-full bg-white" />
              </div>
            ) : (
              <div className="text-xs text-[#8b735c]">
                <span className="font-medium">{ref.authors || '未填写作者'}</span>. {ref.title || '未填写标题'}
                {ref.journal && <span className="text-[#6d5a47]"> - {ref.journal}</span>}
                {ref.year && <span> ({ref.year})</span>}
              </div>
            )}
          </div>
        ))}
        {refs.length === 0 && (
          <div className="text-center text-sm text-[#c79f72] py-4">暂无参考文献，点击"手动添加"或导入文件</div>
        )}
      </div>

      <div>
        <label className="text-xs text-[#6d5a47] font-medium">批量导入（每行一条参考文献）</label>
        <textarea value={inputText} onChange={e => setInputText(e.target.value)}
          className="w-full mt-1 p-2 border border-[#ead0ad] rounded-lg text-xs bg-white resize-y min-h-[60px]"
          placeholder="粘贴参考文献列表，每行一条...&#10;例如：张三, 李四. 基于深度学习的图像识别研究[J]. 计算机学报, 2023, 45(3): 123-135." />
        <Btn onClick={importText} disabled={!inputText.trim()} className="mt-1">导入文本</Btn>
      </div>

      {refs.length > 0 && (
        <div className="bg-[#fff4e6] border border-[#ead0ad] rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-[#6f3714]">格式化输出（{formatLabel}）</span>
            <div className="flex gap-1">
              {(['gb7714', 'apa', 'mla'] as const).map(f => (
                <button key={f} onClick={() => setFormat(f)}
                  className={`text-[10px] px-2 py-0.5 rounded ${format === f ? 'bg-[#7a421b] text-[#fff8ef]' : 'bg-[#f1dcc2] text-[#6f3714]'}`}>
                  {f === 'gb7714' ? 'GB/T 7714' : f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-40 overflow-y-auto text-xs text-[#8b735c] space-y-1">
            {refs.map((r, i) => (
              <div key={r.id}>[{i + 1}] {format === 'gb7714' ? toGB7714(r) : format === 'apa' ? toAPA(r) : toMLA(r)}</div>
            ))}
          </div>
          <Btn onClick={exportRefs} className="mt-2"><Download className="w-4 h-4 mr-1" />复制全部</Btn>
        </div>
      )}

      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    </div>
  );
};

export default ReferenceWorkbench;