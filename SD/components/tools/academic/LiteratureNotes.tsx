import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Btn, copyToClipboard } from '../shared';
import { UploadZone } from '../shared';
import { BookOpen, Plus, Trash2, Download, Search, Tag, Star } from 'lucide-react';

interface Note {
  id: string;
  paperTitle: string;
  authors: string;
  year: string;
  journal: string;
  tags: string[];
  rating: number; // 1-5
  summary: string;
  methodology: string;
  findings: string;
  limitations: string;
  myNotes: string;
  createdAt: string;
}

const STORAGE_KEY = 'literature-notes';

const generateId = () => Math.random().toString(36).slice(2, 9);

const loadNotes = (): Note[] => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
};

const saveNotes = (notes: Note[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  } catch { /* ignore */ }
};

const LiteratureNotes: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [notes, setNotes] = useState<Note[]>(loadNotes);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [newTag, setNewTag] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { saveNotes(notes); }, [notes]);

  const allTags = [...new Set(notes.flatMap(n => n.tags))].sort();

  const filteredNotes = notes.filter(n => {
    const matchSearch = !searchQuery ||
      n.paperTitle.toLowerCase().includes(searchQuery.toLowerCase()) ||
      n.authors.toLowerCase().includes(searchQuery.toLowerCase()) ||
      n.summary.toLowerCase().includes(searchQuery.toLowerCase()) ||
      n.myNotes.toLowerCase().includes(searchQuery.toLowerCase());
    const matchTag = !filterTag || n.tags.includes(filterTag);
    return matchSearch && matchTag;
  });

  const addNote = () => {
    const newNote: Note = {
      id: generateId(),
      paperTitle: '',
      authors: '',
      year: new Date().getFullYear().toString(),
      journal: '',
      tags: [],
      rating: 0,
      summary: '',
      methodology: '',
      findings: '',
      limitations: '',
      myNotes: '',
      createdAt: new Date().toISOString(),
    };
    setNotes(prev => [newNote, ...prev]);
    setEditingId(newNote.id);
  };

  const updateNote = (id: string, field: keyof Note, value: any) => {
    setNotes(prev => prev.map(n => n.id === id ? { ...n, [field]: value } : n));
  };

  const removeNote = (id: string) => {
    setNotes(prev => prev.filter(n => n.id !== id));
    if (editingId === id) setEditingId(null);
  };

  const addTagToNote = (id: string) => {
    if (!newTag.trim()) return;
    const note = notes.find(n => n.id === id);
    if (note && !note.tags.includes(newTag.trim())) {
      updateNote(id, 'tags', [...note.tags, newTag.trim()]);
    }
    setNewTag('');
  };

  const removeTagFromNote = (id: string, tag: string) => {
    const note = notes.find(n => n.id === id);
    if (note) {
      updateNote(id, 'tags', note.tags.filter(t => t !== tag));
    }
  };

  const exportNotes = () => {
    const lines = filteredNotes.map((n, i) => {
      const stars = '★'.repeat(n.rating) + '☆'.repeat(5 - n.rating);
      return `[${i + 1}] ${n.paperTitle || '未命名'}\n` +
        `作者: ${n.authors || '-'} | 年份: ${n.year} | 期刊: ${n.journal || '-'}\n` +
        `评分: ${stars} | 标签: ${n.tags.join(', ') || '无'}\n` +
        `摘要: ${n.summary || '-'}\n` +
        `方法: ${n.methodology || '-'}\n` +
        `发现: ${n.findings || '-'}\n` +
        `局限: ${n.limitations || '-'}\n` +
        `笔记: ${n.myNotes || '-'}\n`;
    });
    copyToClipboard(`文献阅读笔记（${filteredNotes.length} 篇）\n${'='.repeat(50)}\n\n` + lines.join('\n---\n\n'));
  };

  const exportMarkdown = () => {
    const md = filteredNotes.map(n => {
      const stars = '⭐'.repeat(n.rating);
      return `## ${n.paperTitle || '未命名'}\n` +
        `- **作者**: ${n.authors || '-'}\n` +
        `- **年份**: ${n.year}\n` +
        `- **期刊**: ${n.journal || '-'}\n` +
        `- **评分**: ${stars}\n` +
        `- **标签**: ${n.tags.map(t => `\`${t}\``).join(' ') || '无'}\n\n` +
        `### 摘要\n${n.summary || '-'}\n\n` +
        `### 方法\n${n.methodology || '-'}\n\n` +
        `### 发现\n${n.findings || '-'}\n\n` +
        `### 局限性\n${n.limitations || '-'}\n\n` +
        `### 我的笔记\n${n.myNotes || '-'}\n`;
    });
    copyToClipboard(`# 文献阅读笔记\n\n` + md.join('\n---\n\n'));
  };

  const handleImport = useCallback(async (fl: FileList | null) => {
    if (!fl?.[0]) return;
    const text = await fl[0].text();
    // Simple text import: each line as a paper title
    const lines = text.split('\n').filter(l => l.trim());
    const imported: Note[] = lines.map(line => ({
      id: generateId(),
      paperTitle: line.trim(),
      authors: '',
      year: new Date().getFullYear().toString(),
      journal: '',
      tags: [],
      rating: 0,
      summary: '',
      methodology: '',
      findings: '',
      limitations: '',
      myNotes: '',
      createdAt: new Date().toISOString(),
    }));
    setNotes(prev => [...imported, ...prev]);
  }, []);

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b735c]">文献阅读笔记管理：记录论文摘要、方法、发现、局限性，支持标签分类和全文搜索</p>

      <div className="flex gap-2 flex-wrap">
        <Btn onClick={addNote}><Plus className="w-4 h-4 mr-1" />新建笔记</Btn>
        <UploadZone onUpload={() => inputRef.current?.click()} onDropFiles={handleImport} accept=".txt,.csv" label="导入" sublabel=".txt" compact />
        <input ref={inputRef} type="file" className="hidden" accept=".txt,.csv" onChange={e => handleImport(e.target.files)} />
      </div>

      {/* Search and filter */}
      <div className="flex gap-2 items-center">
        <div className="flex-1 relative">
          <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-[#c79f72]" />
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-2 py-1.5 border border-[#ead0ad] rounded-lg text-xs bg-white"
            placeholder="搜索标题、作者、笔记..." />
        </div>
      </div>

      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          <button onClick={() => setFilterTag(null)}
            className={`text-[10px] px-2 py-0.5 rounded ${!filterTag ? 'bg-[#7a421b] text-[#fff8ef]' : 'bg-[#f1dcc2] text-[#6f3714]'}`}>
            全部
          </button>
          {allTags.map(tag => (
            <button key={tag} onClick={() => setFilterTag(filterTag === tag ? null : tag)}
              className={`text-[10px] px-2 py-0.5 rounded ${filterTag === tag ? 'bg-[#7a421b] text-[#fff8ef]' : 'bg-[#f1dcc2] text-[#6f3714]'}`}>
              {tag}
            </button>
          ))}
        </div>
      )}

      <div className="text-xs text-[#8b735c]">共 {filteredNotes.length} 篇笔记</div>

      {/* Notes list */}
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {filteredNotes.map(note => (
          <div key={note.id} className={`bg-[#fff4e6] border rounded-lg p-2 ${editingId === note.id ? 'border-[#7a421b]' : 'border-[#ead0ad]'}`}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2 flex-1">
                <span className="text-xs font-medium text-[#6f3714] truncate">{note.paperTitle || '未命名论文'}</span>
                {note.rating > 0 && <span className="text-[10px] text-amber-500">{'★'.repeat(note.rating)}</span>}
              </div>
              <div className="flex gap-1">
                <button onClick={() => setEditingId(editingId === note.id ? null : note.id)} className="text-xs text-[#7a421b] hover:underline">编辑</button>
                <button onClick={() => removeNote(note.id)} className="text-xs text-red-500 hover:underline"><Trash2 className="w-3 h-3" /></button>
              </div>
            </div>

            {note.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1">
                {note.tags.map(tag => (
                  <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-[#f1dcc2] rounded text-[#6f3714]">{tag}</span>
                ))}
              </div>
            )}

            {editingId === note.id ? (
              <div className="space-y-2 mt-2">
                <input value={note.paperTitle} onChange={e => updateNote(note.id, 'paperTitle', e.target.value)} placeholder="论文标题"
                  className="text-xs border border-[#ead0ad] rounded px-2 py-1 w-full bg-white" />
                <div className="flex gap-2">
                  <input value={note.authors} onChange={e => updateNote(note.id, 'authors', e.target.value)} placeholder="作者"
                    className="text-xs border border-[#ead0ad] rounded px-2 py-1 flex-1 bg-white" />
                  <input value={note.year} onChange={e => updateNote(note.id, 'year', e.target.value)} placeholder="年份"
                    className="text-xs border border-[#ead0ad] rounded px-2 py-1 w-20 bg-white" />
                </div>
                <input value={note.journal} onChange={e => updateNote(note.id, 'journal', e.target.value)} placeholder="期刊/会议"
                  className="text-xs border border-[#ead0ad] rounded px-2 py-1 w-full bg-white" />

                {/* Rating */}
                <div className="flex items-center gap-1">
                  <span className="text-xs text-[#6d5a47]">评分：</span>
                  {[1, 2, 3, 4, 5].map(s => (
                    <button key={s} onClick={() => updateNote(note.id, 'rating', note.rating === s ? 0 : s)}
                      className={`text-sm ${s <= note.rating ? 'text-amber-500' : 'text-[#ead0ad]'}`}>★</button>
                  ))}
                </div>

                {/* Tags */}
                <div className="flex items-center gap-1">
                  <input value={newTag} onChange={e => setNewTag(e.target.value)} placeholder="添加标签"
                    className="text-xs border border-[#ead0ad] rounded px-2 py-1 flex-1 bg-white"
                    onKeyDown={e => { if (e.key === 'Enter') addTagToNote(note.id); }} />
                  <button onClick={() => addTagToNote(note.id)} className="text-xs text-[#7a421b] hover:underline">添加</button>
                </div>
                {note.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {note.tags.map(tag => (
                      <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-[#f1dcc2] rounded flex items-center gap-1">
                        {tag}
                        <button onClick={() => removeTagFromNote(note.id, tag)} className="text-red-400 hover:text-red-600">×</button>
                      </span>
                    ))}
                  </div>
                )}

                <textarea value={note.summary} onChange={e => updateNote(note.id, 'summary', e.target.value)} placeholder="摘要..."
                  className="text-xs border border-[#ead0ad] rounded px-2 py-1 w-full bg-white resize-y min-h-[40px]" />
                <textarea value={note.methodology} onChange={e => updateNote(note.id, 'methodology', e.target.value)} placeholder="研究方法..."
                  className="text-xs border border-[#ead0ad] rounded px-2 py-1 w-full bg-white resize-y min-h-[40px]" />
                <textarea value={note.findings} onChange={e => updateNote(note.id, 'findings', e.target.value)} placeholder="主要发现..."
                  className="text-xs border border-[#ead0ad] rounded px-2 py-1 w-full bg-white resize-y min-h-[40px]" />
                <textarea value={note.limitations} onChange={e => updateNote(note.id, 'limitations', e.target.value)} placeholder="局限性..."
                  className="text-xs border border-[#ead0ad] rounded px-2 py-1 w-full bg-white resize-y min-h-[40px]" />
                <textarea value={note.myNotes} onChange={e => updateNote(note.id, 'myNotes', e.target.value)} placeholder="我的笔记..."
                  className="text-xs border border-[#ead0ad] rounded px-2 py-1 w-full bg-white resize-y min-h-[60px]" />
              </div>
            ) : (
              <div className="text-xs text-[#8b735c] space-y-1">
                {note.authors && <div>作者: {note.authors} ({note.year})</div>}
                {note.summary && <div className="line-clamp-2">摘要: {note.summary}</div>}
                {note.myNotes && <div className="text-[#7a421b] font-medium line-clamp-2">笔记: {note.myNotes}</div>}
              </div>
            )}
          </div>
        ))}
        {filteredNotes.length === 0 && (
          <div className="text-center text-sm text-[#c79f72] py-4">
            {notes.length === 0 ? '暂无笔记，点击"新建笔记"开始' : '没有匹配的笔记'}
          </div>
        )}
      </div>

      {notes.length > 0 && (
        <div className="flex gap-2">
          <Btn onClick={exportNotes}><Download className="w-4 h-4 mr-1" />导出文本</Btn>
          <Btn onClick={exportMarkdown} variant="secondary">导出 Markdown</Btn>
        </div>
      )}

      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    </div>
  );
};

export default LiteratureNotes;