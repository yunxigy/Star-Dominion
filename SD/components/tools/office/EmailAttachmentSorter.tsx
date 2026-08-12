import React, { useState, useRef, useCallback } from 'react';
import { Btn, ResultBox, copyToClipboard, formatFileSize } from '../shared';
import { UploadZone } from '../shared';
import { Mail, Download, FolderOpen, FileText, Image, FileSpreadsheet, Archive, Tag } from 'lucide-react';

interface AttachInfo {
  name: string;
  size: number;
  type: string;
  category: string;
  suggestedFolder: string;
  date?: string;
}

const EmailAttachmentSorter: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [attachments, setAttachments] = useState<AttachInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const detectCategory = (name: string): { type: string; category: string; suggestedFolder: string } => {
    const ext = name.split('.').pop()?.toLowerCase() || '';
    const lower = name.toLowerCase();

    // Document types
    if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) return { type: 'Word 文档', category: 'document', suggestedFolder: '文档/Word' };
    if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return { type: 'Excel 表格', category: 'spreadsheet', suggestedFolder: '文档/表格' };
    if (['ppt', 'pptx', 'odp'].includes(ext)) return { type: 'PPT 演示', category: 'presentation', suggestedFolder: '文档/演示' };
    if (['pdf'].includes(ext)) return { type: 'PDF 文档', category: 'document', suggestedFolder: '文档/PDF' };
    if (['txt', 'md'].includes(ext)) return { type: '文本文件', category: 'document', suggestedFolder: '文档/文本' };

    // Image types
    if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'].includes(ext)) return { type: '图片', category: 'image', suggestedFolder: '图片' };
    if (['psd', 'ai'].includes(ext)) return { type: '设计文件', category: 'design', suggestedFolder: '设计' };

    // Archive types
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return { type: '压缩包', category: 'archive', suggestedFolder: '压缩包' };

    // Audio/Video
    if (['mp3', 'wav', 'flac', 'aac'].includes(ext)) return { type: '音频', category: 'audio', suggestedFolder: '媒体/音频' };
    if (['mp4', 'avi', 'mov', 'mkv'].includes(ext)) return { type: '视频', category: 'video', suggestedFolder: '媒体/视频' };

    // Code
    if (['js', 'ts', 'py', 'java', 'cpp', 'html', 'css', 'json', 'xml'].includes(ext)) return { type: '代码文件', category: 'code', suggestedFolder: '代码' };

    // Email-specific patterns
    if (lower.includes('发票') || lower.includes('invoice')) return { type: '发票', category: 'invoice', suggestedFolder: '财务/发票' };
    if (lower.includes('合同') || lower.includes('contract')) return { type: '合同', category: 'contract', suggestedFolder: '法务/合同' };
    if (lower.includes('简历') || lower.includes('resume') || lower.includes('cv')) return { type: '简历', category: 'resume', suggestedFolder: 'HR/简历' };
    if (lower.includes('报告') || lower.includes('report')) return { type: '报告', category: 'report', suggestedFolder: '报告' };
    if (lower.includes('照片') || lower.includes('photo')) return { type: '照片', category: 'photo', suggestedFolder: '图片/照片' };

    return { type: '其他', category: 'other', suggestedFolder: '其他' };
  };

  const handleFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList) return;
    setLoading(true);
    try {
      const newAttachments: AttachInfo[] = [];
      for (const file of Array.from(fileList)) {
        const detected = detectCategory(file.name);
        newAttachments.push({
          name: file.name,
          size: file.size,
          type: detected.type,
          category: detected.category,
          suggestedFolder: detected.suggestedFolder,
          date: new Date(file.lastModified).toISOString().slice(0, 10),
        });
      }
      setAttachments(prev => [...prev, ...newAttachments]);
    } finally {
      setLoading(false);
    }
  }, []);

  const getGrouped = () => {
    const groups: Record<string, AttachInfo[]> = {};
    for (const att of attachments) {
      const folder = att.suggestedFolder;
      if (!groups[folder]) groups[folder] = [];
      groups[folder].push(att);
    }
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'document': case 'invoice': case 'contract': case 'resume': case 'report': return <FileText className="w-4 h-4" />;
      case 'spreadsheet': return <FileSpreadsheet className="w-4 h-4" />;
      case 'image': case 'photo': case 'design': return <Image className="w-4 h-4" />;
      case 'archive': return <Archive className="w-4 h-4" />;
      default: return <FileText className="w-4 h-4" />;
    }
  };

  const exportPlan = () => {
    const lines = getGrouped().map(([folder, items]) =>
      `📁 ${folder}/\n${items.map(att => `   ${att.name} (${formatFileSize(att.size)}) - ${att.type}`).join('\n')}`
    );
    copyToClipboard(`邮件附件整理方案\n${'='.repeat(40)}\n\n${lines.join('\n\n')}\n\n共 ${attachments.length} 个附件`);
  };

  const grouped = getGrouped();

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b735c]">批量上传邮件附件，自动分类并生成文件夹整理方案</p>

      <UploadZone onUpload={() => inputRef.current?.click()} onDropFiles={handleFiles} accept="*/*" label="上传附件文件" sublabel="支持所有文件类型，可批量上传" />
      <input ref={inputRef} type="file" multiple className="hidden" onChange={e => handleFiles(e.target.files)} />

      {attachments.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-[#6d5a47]">已识别 {attachments.length} 个附件</span>
            <div className="flex gap-2">
              <button onClick={exportPlan} className="text-xs text-[#7a421b] hover:underline flex items-center gap-1">
                <Download className="w-3 h-3" />复制整理方案
              </button>
              <button onClick={() => setAttachments([])} className="text-xs text-red-500 hover:underline">清空</button>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {[
              { label: '文档', count: attachments.filter(a => ['document', 'spreadsheet', 'presentation'].includes(a.category)).length, color: 'blue' },
              { label: '图片', count: attachments.filter(a => ['image', 'photo', 'design'].includes(a.category)).length, color: 'green' },
              { label: '压缩包', count: attachments.filter(a => a.category === 'archive').length, color: 'amber' },
              { label: '其他', count: attachments.filter(a => !['document', 'spreadsheet', 'presentation', 'image', 'photo', 'design', 'archive'].includes(a.category)).length, color: 'gray' },
            ].map(stat => (
              <div key={stat.label} className={`${stat.color === 'blue' ? 'bg-blue-50 border-blue-200' : stat.color === 'green' ? 'bg-green-50 border-green-200' : stat.color === 'amber' ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'} border rounded-lg p-2 text-center`}>
                <div className={`text-lg font-bold ${stat.color === 'blue' ? 'text-blue-600' : stat.color === 'green' ? 'text-green-600' : stat.color === 'amber' ? 'text-amber-600' : 'text-gray-600'}`}>{stat.count}</div>
                <div className={`text-xs ${stat.color === 'blue' ? 'text-blue-700' : stat.color === 'green' ? 'text-green-700' : stat.color === 'amber' ? 'text-amber-700' : 'text-gray-700'}`}>{stat.label}</div>
              </div>
            ))}
          </div>

          {grouped.map(([folder, items]) => (
            <div key={folder} className="border border-[#ead0ad] rounded-lg overflow-hidden">
              <div className="bg-[#f1dcc2] px-3 py-2 flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-[#7a421b]" />
                <span className="text-sm font-medium text-[#6f3714]">{folder}/</span>
                <span className="text-xs text-[#8b735c]">({items.length} 个文件)</span>
              </div>
              <div className="divide-y divide-[#ead0ad]">
                {items.map((att, i) => (
                  <div key={i} className="px-3 py-2 flex items-center gap-2">
                    <span className="text-[#8b735c]">{getCategoryIcon(att.category)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-[#6d5a47] truncate">{att.name}</div>
                      <div className="text-xs text-[#8b735c]">{att.type} · {formatFileSize(att.size)}{att.date && ` · ${att.date}`}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
        <p className="text-xs text-amber-700">
          提示：此工具根据文件扩展名和文件名关键词自动分类，生成建议的文件夹结构。
          实际移动文件需在本地文件管理器中操作。
        </p>
      </div>

      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    </div>
  );
};

export default EmailAttachmentSorter;