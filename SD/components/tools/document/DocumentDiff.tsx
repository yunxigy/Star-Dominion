import React, { useState, useRef } from 'react';
import { Btn, ResultBox, copyToClipboard, formatFileSize } from '../shared';
import { UploadZone } from '../shared';
import { GitCompare, FileText, Upload } from 'lucide-react';

interface DiffItem {
  type: 'added' | 'removed' | 'modified';
  section: string;
  content: string;
  lineNum?: number;
}

const DocumentDiff: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [file1, setFile1] = useState<File | null>(null);
  const [file2, setFile2] = useState<File | null>(null);
  const [text1, setText1] = useState('');
  const [text2, setText2] = useState('');
  const [diffs, setDiffs] = useState<DiffItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'text' | 'file'>('text');
  const inputRef1 = useRef<HTMLInputElement>(null);
  const inputRef2 = useRef<HTMLInputElement>(null);

  const loadFile = async (file: File, setter: (t: string) => void) => {
    const text = await file.text();
    setter(text);
  };

  const compare = () => {
    setLoading(true);
    try {
      const lines1 = text1.split('\n');
      const lines2 = text2.split('\n');
      const result: DiffItem[] = [];

      // Extract sections (headers, paragraphs)
      const extractSections = (lines: string[]) => {
        const sections: { title: string; content: string[]; lineNum: number }[] = [];
        let currentSection = { title: '文档开头', content: [] as string[], lineNum: 1 };

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.startsWith('#') || line.startsWith('第') && line.includes('章') || line.startsWith('Chapter') || line.match(/^[一二三四五六七八九十]+[、.]/)) {
            if (currentSection.content.length > 0 || currentSection.title !== '文档开头') {
              sections.push({ ...currentSection });
            }
            currentSection = { title: line, content: [], lineNum: i + 1 };
          } else {
            currentSection.content.push(line);
          }
        }
        sections.push(currentSection);
        return sections;
      };

      const sections1 = extractSections(lines1);
      const sections2 = extractSections(lines2);

      // Compare sections
      const s2Map = new Map(sections2.map(s => [s.title, s]));
      const processedTitles = new Set<string>();

      for (const s1 of sections1) {
        processedTitles.add(s1.title);
        const s2 = s2Map.get(s1.title);
        if (!s2) {
          result.push({ type: 'removed', section: s1.title, content: s1.content.join('\n'), lineNum: s1.lineNum });
        } else {
          const content1 = s1.content.join('\n');
          const content2 = s2.content.join('\n');
          if (content1 !== content2) {
            result.push({ type: 'modified', section: s1.title, content: `原文:\n${content1}\n\n修改为:\n${content2}`, lineNum: s1.lineNum });
          }
        }
      }

      for (const s2 of sections2) {
        if (!processedTitles.has(s2.title)) {
          result.push({ type: 'added', section: s2.title, content: s2.content.join('\n'), lineNum: s2.lineNum });
        }
      }

      // Also do line-by-line diff for detailed comparison
      if (result.length === 0) {
        let i = 0, j = 0;
        while (i < lines1.length || j < lines2.length) {
          if (i >= lines1.length) {
            result.push({ type: 'added', section: `行 ${j + 1}`, content: lines2[j], lineNum: j + 1 });
            j++;
          } else if (j >= lines2.length) {
            result.push({ type: 'removed', section: `行 ${i + 1}`, content: lines1[i], lineNum: i + 1 });
            i++;
          } else if (lines1[i] !== lines2[j]) {
            result.push({ type: 'modified', section: `行 ${i + 1}`, content: `原文: ${lines1[i]}\n修改: ${lines2[j]}`, lineNum: i + 1 });
            i++; j++;
          } else {
            i++; j++;
          }
        }
      }

      setDiffs(result);
    } finally {
      setLoading(false);
    }
  };

  const typeLabel = { added: '新增', removed: '删除', modified: '修改' };
  const typeColor = { added: 'text-green-600 bg-green-50', removed: 'text-red-600 bg-red-50', modified: 'text-amber-600 bg-amber-50' };

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b735c]">按标题、段落、表格比较，标记新增、删除和修改内容</p>

      <div className="flex gap-2 mb-2">
        <button onClick={() => setMode('text')} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${mode === 'text' ? 'bg-[#7a421b] text-[#fff8ef]' : 'bg-[#f1dcc2] text-[#6f3714]'}`}>文本输入</button>
        <button onClick={() => setMode('file')} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${mode === 'file' ? 'bg-[#7a421b] text-[#fff8ef]' : 'bg-[#f1dcc2] text-[#6f3714]'}`}>文件上传</button>
      </div>

      {mode === 'file' ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-[#8b735c] mb-1">原始文档</p>
            <UploadZone onUpload={() => inputRef1.current?.click()} accept=".txt,.md,.csv" label="上传原始文件" />
            <input ref={inputRef1} type="file" className="hidden" onChange={e => { if (e.target.files?.[0]) loadFile(e.target.files[0], setText1); }} />
            {file1 && <p className="text-xs text-[#6d5a47] mt-1">{file1.name}</p>}
          </div>
          <div>
            <p className="text-xs text-[#8b735c] mb-1">修改文档</p>
            <UploadZone onUpload={() => inputRef2.current?.click()} accept=".txt,.md,.csv" label="上传修改文件" />
            <input ref={inputRef2} type="file" className="hidden" onChange={e => { if (e.target.files?.[0]) loadFile(e.target.files[0], setText2); }} />
            {file2 && <p className="text-xs text-[#6d5a47] mt-1">{file2.name}</p>}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <textarea value={text1} onChange={e => setText1(e.target.value)} placeholder="粘贴原始文档内容..." className="w-full h-40 px-3 py-2 rounded-lg border border-[#c79f72] bg-white text-sm resize-none" />
          <textarea value={text2} onChange={e => setText2(e.target.value)} placeholder="粘贴修改后文档内容..." className="w-full h-40 px-3 py-2 rounded-lg border border-[#c79f72] bg-white text-sm resize-none" />
        </div>
      )}

      <div className="flex gap-2">
        <Btn onClick={compare} disabled={loading || !text1 || !text2}>{loading ? '比较中...' : '开始对比'}</Btn>
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>

      {diffs.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-[#6d5a47]">发现 {diffs.length} 处差异</p>
          <div className="max-h-80 overflow-y-auto space-y-2">
            {diffs.map((diff, i) => (
              <div key={i} className={`rounded-lg border p-3 ${typeColor[diff.type]} border-current/20`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded ${typeColor[diff.type]}`}>{typeLabel[diff.type]}</span>
                  <span className="text-sm font-medium">{diff.section}</span>
                  {diff.lineNum && <span className="text-xs opacity-60">行 {diff.lineNum}</span>}
                </div>
                <pre className="text-xs whitespace-pre-wrap mt-1">{diff.content}</pre>
              </div>
            ))}
          </div>
        </div>
      )}
      {diffs.length === 0 && text1 && text2 && !loading && (
        <p className="text-sm text-green-600">两份文档内容一致，未发现差异</p>
      )}
    </div>
  );
};

export default DocumentDiff;