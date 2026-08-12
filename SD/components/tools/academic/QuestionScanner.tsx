import React, { useState, useRef, useCallback } from 'react';
import { Btn, copyToClipboard, formatFileSize } from '../shared';
import { UploadZone } from '../shared';
import { Scan, Download, Plus, Trash2, Edit3, ListOrdered, Tag } from 'lucide-react';

interface Question {
  id: string;
  number: string;
  type: 'choice' | 'fill' | 'short' | 'essay' | 'judge' | 'calc' | 'other';
  content: string;
  options: string[];
  answer: string;
  tags: string[];
  page?: number;
}

const TYPE_LABELS: Record<Question['type'], { label: string; icon: string }> = {
  choice: { label: '选择题', icon: '🔘' },
  fill: { label: '填空题', icon: '✏️' },
  short: { label: '简答题', icon: '📝' },
  essay: { label: '论述题', icon: '📄' },
  judge: { label: '判断题', icon: '✅' },
  calc: { label: '计算题', icon: '🔢' },
  other: { label: '其他', icon: '📌' },
};

const generateId = () => Math.random().toString(36).slice(2, 9);

const parseQuestions = (text: string): Question[] => {
  const questions: Question[] = [];
  const lines = text.split('\n');
  let currentQ: Question | null = null;
  let collectingOptions = false;
  const options: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Match question number patterns
    const numMatch = trimmed.match(/^(\d+)[.、．)\s]/) || trimmed.match(/^[(（](\d+)[)）]/);
    if (numMatch) {
      // Save previous question
      if (currentQ) {
        if (options.length > 0) {
          currentQ.options = [...options];
          if (options.length >= 2 && !currentQ.type || currentQ.type === 'other') {
            currentQ.type = 'choice';
          }
        }
        questions.push(currentQ);
      }
      options.length = 0;
      collectingOptions = false;

      const content = trimmed.replace(/^(\d+)[.、．)\s]+/, '').replace(/^[(（](\d+)[)）]\s*/, '');
      let type: Question['type'] = 'other';
      if (/^[A-D][.、．)]\s/i.test(content) || content.includes('____') || content.includes('____')) {
        type = 'fill';
      } else if (content.includes('（  ）') || content.includes('(___') || content.includes('（___')) {
        type = 'fill';
      }

      currentQ = {
        id: generateId(),
        number: numMatch[1],
        type,
        content,
        options: [],
        answer: '',
        tags: [],
      };
      collectingOptions = true;
      continue;
    }

    // Match options (A. B. C. D.)
    const optMatch = trimmed.match(/^([A-Da-d])[.、．)]\s*(.+)/);
    if (optMatch && collectingOptions) {
      options.push(`${optMatch[1].toUpperCase()}. ${optMatch[2]}`);
      if (currentQ) currentQ.type = 'choice';
      continue;
    }

    // Match answer lines
    const ansMatch = trimmed.match(/^(答案|参考答案|Answer)[:：]\s*(.+)/i);
    if (ansMatch && currentQ) {
      currentQ.answer = ansMatch[2].trim();
      continue;
    }

    // Append to current question content
    if (currentQ) {
      currentQ.content += ' ' + trimmed;
    }
  }

  // Save last question
  if (currentQ) {
    if (options.length > 0) {
      currentQ.options = [...options];
      if (currentQ.type === 'other') currentQ.type = 'choice';
    }
    questions.push(currentQ);
  }

  return questions;
};

const QuestionScanner: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [filterType, setFilterType] = useState<Question['type'] | 'all'>('all');
  const [newTag, setNewTag] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (fl: FileList | null) => {
    if (!fl?.[0]) return;
    const text = await fl[0].text();
    const parsed = parseQuestions(text);
    if (parsed.length > 0) {
      setQuestions(prev => [...prev, ...parsed]);
    }
  }, []);

  const parseText = () => {
    if (!inputText.trim()) return;
    const parsed = parseQuestions(inputText);
    if (parsed.length > 0) {
      setQuestions(prev => [...prev, ...parsed]);
    }
    setInputText('');
  };

  const addQuestion = () => {
    setQuestions(prev => [...prev, {
      id: generateId(),
      number: String(prev.length + 1),
      type: 'choice',
      content: '',
      options: [],
      answer: '',
      tags: [],
    }]);
  };

  const updateQuestion = (id: string, field: keyof Question, value: any) => {
    setQuestions(prev => prev.map(q => q.id === id ? { ...q, [field]: value } : q));
  };

  const removeQuestion = (id: string) => {
    setQuestions(prev => prev.filter(q => q.id !== id));
  };

  const addTagToQuestion = (id: string, tag: string) => {
    if (!tag.trim()) return;
    const q = questions.find(q => q.id === id);
    if (q && !q.tags.includes(tag.trim())) {
      updateQuestion(id, 'tags', [...q.tags, tag.trim()]);
    }
  };

  const filteredQuestions = questions.filter(q => filterType === 'all' || q.type === filterType);
  const typeStats = Object.entries(TYPE_LABELS).map(([type, { label, icon }]) => ({
    type, label, icon,
    count: questions.filter(q => q.type === type).length,
  })).filter(s => s.count > 0);

  const renumber = () => {
    setQuestions(prev => prev.map((q, i) => ({ ...q, number: String(i + 1) })));
  };

  const exportQuestions = () => {
    const lines = filteredQuestions.map(q => {
      const typeLabel = TYPE_LABELS[q.type]?.label || '其他';
      let line = `${q.number}. [${typeLabel}] ${q.content}`;
      if (q.options.length > 0) {
        line += '\n' + q.options.map(o => `   ${o}`).join('\n');
      }
      if (q.answer) line += `\n   答案: ${q.answer}`;
      if (q.tags.length > 0) line += `\n   标签: ${q.tags.join(', ')}`;
      return line;
    });
    copyToClipboard(`题目整理（${filteredQuestions.length} 题）\n${'='.repeat(40)}\n\n` + lines.join('\n\n'));
  };

  const exportAnki = () => {
    const lines = filteredQuestions.map(q => {
      const front = q.content + (q.options.length > 0 ? '\n' + q.options.join('\n') : '');
      const back = q.answer || '';
      return `${front}\t${back}`;
    });
    copyToClipboard(lines.join('\n'));
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b735c]">从试卷/文档中提取题目，自动识别题型，整理编号，支持导出为题库或Anki格式</p>

      <div className="flex gap-2 flex-wrap">
        <Btn onClick={addQuestion}><Plus className="w-4 h-4 mr-1" />手动添加</Btn>
        <UploadZone onUpload={() => inputRef.current?.click()} onDropFiles={handleFile} accept=".txt,.md" label="导入文件" sublabel=".txt" compact />
        <input ref={inputRef} type="file" className="hidden" accept=".txt,.md" onChange={e => handleFile(e.target.files)} />
        <Btn onClick={renumber} variant="secondary"><ListOrdered className="w-4 h-4 mr-1" />重新编号</Btn>
      </div>

      {/* Text input for batch import */}
      <div>
        <label className="text-xs text-[#6d5a47] font-medium">批量导入（粘贴题目文本）</label>
        <textarea value={inputText} onChange={e => setInputText(e.target.value)}
          className="w-full mt-1 p-2 border border-[#ead0ad] rounded-lg text-xs bg-white resize-y min-h-[80px]"
          placeholder="粘贴题目文本，如：&#10;1. 以下哪个是正确的？&#10;A. 选项1  B. 选项2  C. 选项3  D. 选项4&#10;答案：C" />
        <Btn onClick={parseText} disabled={!inputText.trim()} className="mt-1">解析导入</Btn>
      </div>

      {/* Stats and filters */}
      {questions.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-[#6d5a47]">题型筛选：</span>
          <button onClick={() => setFilterType('all')}
            className={`text-[10px] px-2 py-0.5 rounded ${filterType === 'all' ? 'bg-[#7a421b] text-[#fff8ef]' : 'bg-[#f1dcc2] text-[#6f3714]'}`}>
            全部 ({questions.length})
          </button>
          {typeStats.map(s => (
            <button key={s.type} onClick={() => setFilterType(s.type as Question['type'])}
              className={`text-[10px] px-2 py-0.5 rounded ${filterType === s.type ? 'bg-[#7a421b] text-[#fff8ef]' : 'bg-[#f1dcc2] text-[#6f3714]'}`}>
              {s.icon} {s.label} ({s.count})
            </button>
          ))}
        </div>
      )}

      {/* Questions list */}
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {filteredQuestions.map(q => (
          <div key={q.id} className={`bg-[#fff4e6] border rounded-lg p-2 ${editingId === q.id ? 'border-[#7a421b]' : 'border-[#ead0ad]'}`}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-[#6f3714]">第 {q.number} 题</span>
                <span className="text-[10px]">{TYPE_LABELS[q.type]?.icon} {TYPE_LABELS[q.type]?.label}</span>
                {q.tags.map(tag => (
                  <span key={tag} className="text-[10px] px-1 py-0.5 bg-[#f1dcc2] rounded text-[#6f3714]">{tag}</span>
                ))}
              </div>
              <div className="flex gap-1">
                <button onClick={() => setEditingId(editingId === q.id ? null : q.id)} className="text-xs text-[#7a421b] hover:underline">编辑</button>
                <button onClick={() => removeQuestion(q.id)} className="text-xs text-red-500 hover:underline"><Trash2 className="w-3 h-3" /></button>
              </div>
            </div>

            {editingId === q.id ? (
              <div className="space-y-2 mt-2">
                <div className="flex gap-2">
                  <input value={q.number} onChange={e => updateQuestion(q.id, 'number', e.target.value)}
                    className="text-xs border border-[#ead0ad] rounded px-2 py-1 w-16 bg-white" placeholder="题号" />
                  <select value={q.type} onChange={e => updateQuestion(q.id, 'type', e.target.value)}
                    className="text-xs border border-[#ead0ad] rounded px-2 py-1 bg-white">
                    {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                  </select>
                </div>
                <textarea value={q.content} onChange={e => updateQuestion(q.id, 'content', e.target.value)}
                  className="text-xs border border-[#ead0ad] rounded px-2 py-1 w-full bg-white resize-y min-h-[40px]" placeholder="题目内容" />
                {q.type === 'choice' && (
                  <div className="space-y-1">
                    {q.options.map((opt, i) => (
                      <div key={i} className="flex gap-1">
                        <input value={opt} onChange={e => {
                          const newOpts = [...q.options];
                          newOpts[i] = e.target.value;
                          updateQuestion(q.id, 'options', newOpts);
                        }} className="text-xs border border-[#ead0ad] rounded px-2 py-1 flex-1 bg-white" />
                        <button onClick={() => {
                          updateQuestion(q.id, 'options', q.options.filter((_, j) => j !== i));
                        }} className="text-xs text-red-400">×</button>
                      </div>
                    ))}
                    <button onClick={() => updateQuestion(q.id, 'options', [...q.options, `${String.fromCharCode(65 + q.options.length)}. `])}
                      className="text-xs text-[#7a421b] hover:underline">+ 添加选项</button>
                  </div>
                )}
                <input value={q.answer} onChange={e => updateQuestion(q.id, 'answer', e.target.value)}
                  className="text-xs border border-[#ead0ad] rounded px-2 py-1 w-full bg-white" placeholder="答案" />
                <div className="flex gap-1">
                  <input value={newTag} onChange={e => setNewTag(e.target.value)} placeholder="添加标签"
                    className="text-xs border border-[#ead0ad] rounded px-2 py-1 flex-1 bg-white"
                    onKeyDown={e => { if (e.key === 'Enter') { addTagToQuestion(q.id, newTag); setNewTag(''); } }} />
                  <button onClick={() => { addTagToQuestion(q.id, newTag); setNewTag(''); }} className="text-xs text-[#7a421b] hover:underline">添加</button>
                </div>
              </div>
            ) : (
              <div className="text-xs text-[#8b735c]">
                <div className="line-clamp-3">{q.content || '未填写题目内容'}</div>
                {q.options.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {q.options.map((opt, i) => (
                      <div key={i} className="text-[#6d5a47] pl-2">{opt}</div>
                    ))}
                  </div>
                )}
                {q.answer && <div className="mt-1 text-[#7a421b] font-medium">答案: {q.answer}</div>}
              </div>
            )}
          </div>
        ))}
        {filteredQuestions.length === 0 && questions.length === 0 && (
          <div className="text-center text-sm text-[#c79f72] py-4">暂无题目，手动添加或导入文件</div>
        )}
      </div>

      {questions.length > 0 && (
        <div className="flex gap-2">
          <Btn onClick={exportQuestions}><Download className="w-4 h-4 mr-1" />导出题库</Btn>
          <Btn onClick={exportAnki} variant="secondary">导出 Anki</Btn>
        </div>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
        <p className="text-xs text-amber-700">
          提示：自动解析支持常见题目格式（编号+题干+选项+答案）。复杂格式可能需要手动调整。图片中的题目请使用OCR工具先转为文本。
        </p>
      </div>

      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    </div>
  );
};

export default QuestionScanner;