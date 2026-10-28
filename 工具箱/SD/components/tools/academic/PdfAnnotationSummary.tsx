import React, { useState, useRef, useCallback } from 'react';
import { Btn, copyToClipboard } from '../shared';
import { UploadZone } from '../shared';
import { FileText, Download, MessageSquare, Highlighter, Bookmark, AlertTriangle } from 'lucide-react';

interface Annotation {
  id: string;
  page: number;
  type: 'highlight' | 'note' | 'bookmark' | 'underline' | 'strikethrough';
  text: string;
  comment: string;
  color: string;
  author: string;
  date: string;
}

interface PdfAnnotationSummaryProps {
  onClose: () => void;
}

const generateId = () => Math.random().toString(36).slice(2, 9);

const TYPE_LABELS: Record<Annotation['type'], { label: string; icon: string }> = {
  highlight: { label: '高亮', icon: '🖍' },
  note: { label: '批注', icon: '📝' },
  bookmark: { label: '书签', icon: '🔖' },
  underline: { label: '下划线', icon: '✏️' },
  strikethrough: { label: '删除线', icon: '❌' },
};

const PdfAnnotationSummary: React.FC<PdfAnnotationSummaryProps> = ({ onClose }) => {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [fileName, setFileName] = useState('');
  const [filterType, setFilterType] = useState<Annotation['type'] | 'all'>('all');
  const [filterPage, setFilterPage] = useState<number | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Manual annotation form state
  const [newAnnot, setNewAnnot] = useState<Partial<Annotation>>({
    type: 'highlight',
    page: 1,
    text: '',
    comment: '',
  });

  const handleFile = useCallback(async (fl: FileList | null) => {
    if (!fl?.[0]) return;
    const file = fl[0];
    setFileName(file.name);

    try {
      // Try to use pdf-lib to extract annotations
      const { PDFDocument } = await import('pdf-lib');
      const arrayBuffer = await file.arrayBuffer();
      const pdfDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });

      const extracted: Annotation[] = [];
      const pages = pdfDoc.getPages();

      pages.forEach((page: any, pageIdx: number) => {
        try {
          const annots = page.node.Annots();
          if (!annots) return;

          for (let i = 0; i < annots.size(); i++) {
            try {
              const annot = annots.lookup(i);
              const subtype = annot.get('Subtype')?.toString();
              const contents = annot.get('Contents')?.toString() || '';
              const title = annot.get('T')?.toString() || '';
              const rect = annot.get('Rect');

              let type: Annotation['type'] = 'note';
              if (subtype === 'Highlight') type = 'highlight';
              else if (subtype === 'Underline') type = 'underline';
              else if (subtype === 'StrikeOut') type = 'strikethrough';
              else if (subtype === 'Text') type = 'note';

              extracted.push({
                id: generateId(),
                page: pageIdx + 1,
                type,
                text: '',
                comment: contents,
                color: '',
                author: title,
                date: '',
              });
            } catch {
              // Skip malformed annotation
            }
          }
        } catch {
          // Skip page with annotation errors
        }
      });

      if (extracted.length > 0) {
        setAnnotations(extracted);
      } else {
        setManualMode(true);
      }
    } catch {
      // pdf-lib failed, use manual mode
      setManualMode(true);
    }
  }, []);

  const addManualAnnotation = () => {
    if (!newAnnot.text && !newAnnot.comment) return;
    const annot: Annotation = {
      id: generateId(),
      page: newAnnot.page || 1,
      type: newAnnot.type || 'highlight',
      text: newAnnot.text || '',
      comment: newAnnot.comment || '',
      color: '',
      author: '',
      date: new Date().toISOString(),
    };
    setAnnotations(prev => [...prev, annot]);
    setNewAnnot({ type: 'highlight', page: annot.page, text: '', comment: '' });
  };

  const removeAnnotation = (id: string) => {
    setAnnotations(prev => prev.filter(a => a.id !== id));
  };

  const filteredAnnotations = annotations.filter(a => {
    if (filterType !== 'all' && a.type !== filterType) return false;
    if (filterPage !== null && a.page !== filterPage) return false;
    return true;
  });

  const pages = [...new Set(annotations.map(a => a.page))].sort((a, b) => a - b);

  const typeStats = Object.entries(TYPE_LABELS).map(([type, { label }]) => ({
    type,
    label,
    count: annotations.filter(a => a.type === type).length,
  })).filter(s => s.count > 0);

  const exportSummary = () => {
    const lines = filteredAnnotations.map(a => {
      const typeLabel = TYPE_LABELS[a.type]?.label || a.type;
      let line = `[P${a.page}] ${typeLabel}`;
      if (a.text) line += `: "${a.text}"`;
      if (a.comment) line += ` — ${a.comment}`;
      if (a.author) line += ` (${a.author})`;
      return line;
    });
    copyToClipboard(`PDF批注汇总 - ${fileName}\n共 ${filteredAnnotations.length} 条批注\n${'='.repeat(40)}\n\n` + lines.join('\n'));
  };

  const exportByPage = () => {
    const grouped: Record<number, Annotation[]> = {};
    filteredAnnotations.forEach(a => {
      if (!grouped[a.page]) grouped[a.page] = [];
      grouped[a.page].push(a);
    });
    const lines = Object.entries(grouped).sort(([a], [b]) => Number(a) - Number(b)).map(([page, annots]) => {
      const annotLines = annots.map(a => {
        const typeLabel = TYPE_LABELS[a.type]?.label || a.type;
        let line = `  ${typeLabel}`;
        if (a.text) line += `: "${a.text}"`;
        if (a.comment) line += ` — ${a.comment}`;
        return line;
      });
      return `=== 第 ${page} 页 (${annots.length} 条) ===\n` + annotLines.join('\n');
    });
    copyToClipboard(`PDF批注汇总（按页分组）- ${fileName}\n\n` + lines.join('\n\n'));
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b735c]">汇总PDF中的高亮、批注、书签等标注，按页码/类型分组展示</p>

      <div className="flex gap-2">
        <button onClick={() => setManualMode(false)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium ${!manualMode ? 'bg-[#7a421b] text-[#fff8ef]' : 'bg-[#f1dcc2] text-[#6f3714]'}`}>
          <FileText className="w-3 h-3 inline mr-1" />PDF提取
        </button>
        <button onClick={() => setManualMode(true)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium ${manualMode ? 'bg-[#7a421b] text-[#fff8ef]' : 'bg-[#f1dcc2] text-[#6f3714]'}`}>
          <MessageSquare className="w-3 h-3 inline mr-1" />手动录入
        </button>
      </div>

      {!manualMode ? (
        <>
          <UploadZone onUpload={() => inputRef.current?.click()} onDropFiles={handleFile} accept=".pdf" label="上传PDF文件" sublabel="提取批注信息" />
          <input ref={inputRef} type="file" className="hidden" accept=".pdf" onChange={e => handleFile(e.target.files)} />
          {fileName && <div className="text-sm text-[#6d5a47]">已加载: {fileName}</div>}
        </>
      ) : (
        <div className="bg-[#fff4e6] border border-[#ead0ad] rounded-lg p-3 space-y-2">
          <div className="text-xs font-medium text-[#6f3714]">手动添加批注</div>
          <div className="flex gap-2">
            <select value={newAnnot.type} onChange={e => setNewAnnot(prev => ({ ...prev, type: e.target.value as Annotation['type'] }))}
              className="text-xs border border-[#ead0ad] rounded px-2 py-1 bg-white">
              {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
            </select>
            <input type="number" value={newAnnot.page || 1} onChange={e => setNewAnnot(prev => ({ ...prev, page: parseInt(e.target.value) || 1 }))}
              className="text-xs border border-[#ead0ad] rounded px-2 py-1 w-20 bg-white" placeholder="页码" min={1} />
          </div>
          <input value={newAnnot.text || ''} onChange={e => setNewAnnot(prev => ({ ...prev, text: e.target.value }))}
            className="text-xs border border-[#ead0ad] rounded px-2 py-1 w-full bg-white" placeholder="标注文本" />
          <input value={newAnnot.comment || ''} onChange={e => setNewAnnot(prev => ({ ...prev, comment: e.target.value }))}
            className="text-xs border border-[#ead0ad] rounded px-2 py-1 w-full bg-white" placeholder="批注内容" />
          <Btn onClick={addManualAnnotation}>添加批注</Btn>
        </div>
      )}

      {/* Stats */}
      {typeStats.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {typeStats.map(s => (
            <div key={s.type} className="bg-[#fff4e6] border border-[#ead0ad] rounded-lg px-2 py-1 text-xs">
              <span className="text-[#6f3714]">{s.label}: </span>
              <span className="font-medium text-[#7a421b]">{s.count}</span>
            </div>
          ))}
          <div className="bg-[#fff4e6] border border-[#ead0ad] rounded-lg px-2 py-1 text-xs">
            <span className="text-[#6f3714]">总计: </span>
            <span className="font-medium text-[#7a421b]">{annotations.length}</span>
          </div>
        </div>
      )}

      {/* Filters */}
      {annotations.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-[#6d5a47]">筛选：</span>
          <button onClick={() => setFilterType('all')}
            className={`text-[10px] px-2 py-0.5 rounded ${filterType === 'all' ? 'bg-[#7a421b] text-[#fff8ef]' : 'bg-[#f1dcc2] text-[#6f3714]'}`}>
            全部
          </button>
          {typeStats.map(s => (
            <button key={s.type} onClick={() => setFilterType(s.type as Annotation['type'])}
              className={`text-[10px] px-2 py-0.5 rounded ${filterType === s.type ? 'bg-[#7a421b] text-[#fff8ef]' : 'bg-[#f1dcc2] text-[#6f3714]'}`}>
              {s.label} ({s.count})
            </button>
          ))}
          {pages.length > 1 && (
            <>
              <span className="text-xs text-[#6d5a47] ml-2">页码：</span>
              <button onClick={() => setFilterPage(null)}
                className={`text-[10px] px-2 py-0.5 rounded ${filterPage === null ? 'bg-[#7a421b] text-[#fff8ef]' : 'bg-[#f1dcc2] text-[#6f3714]'}`}>
                全部
              </button>
              {pages.slice(0, 20).map(p => (
                <button key={p} onClick={() => setFilterPage(filterPage === p ? null : p)}
                  className={`text-[10px] px-2 py-0.5 rounded ${filterPage === p ? 'bg-[#7a421b] text-[#fff8ef]' : 'bg-[#f1dcc2] text-[#6f3714]'}`}>
                  P{p}
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {/* Annotations list */}
      {filteredAnnotations.length > 0 && (
        <div className="space-y-1 max-h-60 overflow-y-auto">
          {filteredAnnotations.map(annot => (
            <div key={annot.id} className="bg-white border border-[#ead0ad] rounded-lg p-2 flex items-start gap-2">
              <span className="text-xs shrink-0">{TYPE_LABELS[annot.type]?.icon || '📌'}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] bg-[#f1dcc2] rounded px-1 text-[#6f3714]">P{annot.page}</span>
                  <span className="text-[10px] text-[#8b735c]">{TYPE_LABELS[annot.type]?.label}</span>
                  {annot.author && <span className="text-[10px] text-[#c79f72]">{annot.author}</span>}
                </div>
                {annot.text && <div className="text-xs text-[#6d5a47] mt-0.5 truncate">"{annot.text}"</div>}
                {annot.comment && <div className="text-xs text-[#7a421b] mt-0.5">{annot.comment}</div>}
              </div>
              <button onClick={() => removeAnnotation(annot.id)} className="text-xs text-red-400 hover:text-red-600 shrink-0">×</button>
            </div>
          ))}
        </div>
      )}

      {annotations.length === 0 && !manualMode && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-xs text-amber-700">
            提示：PDF批注提取依赖pdf-lib库。部分加密PDF或特殊批注格式可能无法提取，此时可使用手动录入模式。
          </p>
        </div>
      )}

      {annotations.length > 0 && (
        <div className="flex gap-2">
          <Btn onClick={exportSummary}><Download className="w-4 h-4 mr-1" />导出汇总</Btn>
          <Btn onClick={exportByPage} variant="secondary">按页导出</Btn>
        </div>
      )}

      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    </div>
  );
};

export default PdfAnnotationSummary;