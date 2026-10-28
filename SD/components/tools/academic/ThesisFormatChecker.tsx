import React, { useState, useRef, useCallback } from 'react';
import { Btn, ResultBox, copyToClipboard } from '../shared';
import { UploadZone } from '../shared';
import { readSupportedDocumentText } from '../featureSupport';
import { GraduationCap, AlertTriangle, CheckCircle, Info, Download, FileCheck } from 'lucide-react';

interface ThesisIssue {
  category: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  line?: number;
  suggestion?: string;
}

const ThesisFormatChecker: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [content, setContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [issues, setIssues] = useState<ThesisIssue[]>([]);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState('');
  const [thesisType, setThesisType] = useState<'undergrad' | 'master' | 'phd'>('master');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (fl: FileList | null) => {
    if (!fl?.[0]) return;
    const file = fl[0];
    try {
      const text = await readSupportedDocumentText(file);
      if (!text) throw new Error('文档中没有可读取的文本');
      setFileName(file.name);
      setContent(text);
      setChecked(false);
      setIssues([]);
      setError('');
    } catch (uploadError) {
      setContent('');
      setChecked(false);
      setIssues([]);
      setError(`读取失败：${(uploadError as Error).message}`);
    }
  }, []);

  const check = () => {
    if (!content) return;
    const result: ThesisIssue[] = [];
    const lines = content.split('\n');
    const charCount = content.length;
    const cnChars = (content.match(/[\u4e00-\u9fff]/g) || []).length;

    // Word count requirements
    const wordLimits: Record<string, { min: number; label: string }> = {
      undergrad: { min: 8000, label: '本科' },
      master: { min: 20000, label: '硕士' },
      phd: { min: 50000, label: '博士' },
    };
    const limit = wordLimits[thesisType];
    if (cnChars < limit.min) {
      result.push({
        category: '字数要求',
        severity: 'error',
        message: `正文字数约 ${cnChars} 字，${limit.label}论文要求不少于 ${limit.min} 字`,
        suggestion: '请补充正文内容',
      });
    } else {
      result.push({
        category: '字数要求',
        severity: 'info',
        message: `正文字数约 ${cnChars} 字，满足${limit.label}论文要求（≥${limit.min} 字）`,
      });
    }

    // Structure checks
    const hasAbstract = lines.some(l => /^摘\s*要|^Abstract/i.test(l.trim()));
    if (!hasAbstract) {
      result.push({ category: '论文结构', severity: 'error', message: '未检测到摘要（Abstract）', suggestion: '论文必须包含中英文摘要' });
    }

    const hasKeywords = lines.some(l => /^关键词|^Keywords/i.test(l.trim()));
    if (!hasKeywords) {
      result.push({ category: '论文结构', severity: 'error', message: '未检测到关键词', suggestion: '摘要后应列出3-5个关键词' });
    }

    const hasIntro = lines.some(l => /^1\s*引言|^1\s*绪论|^1\s*研究背景|^第一章|^1\.\s*引言/i.test(l.trim()));
    if (!hasIntro) {
      result.push({ category: '论文结构', severity: 'warning', message: '未检测到引言/绪论章节', suggestion: '论文第一章通常为引言或绪论' });
    }

    const hasConclusion = lines.some(l => /^结论|^总结|^结语|^Conclusions?/i.test(l.trim()));
    if (!hasConclusion) {
      result.push({ category: '论文结构', severity: 'error', message: '未检测到结论章节', suggestion: '论文必须包含结论' });
    }

    const hasReferences = lines.some(l => /^参考文献|^References/i.test(l.trim()));
    if (!hasReferences) {
      result.push({ category: '论文结构', severity: 'error', message: '未检测到参考文献', suggestion: '论文必须包含参考文献列表' });
    }

    const hasAcknowledgment = lines.some(l => /^致谢|^Acknowledge/i.test(l.trim()));
    if (!hasAcknowledgment) {
      result.push({ category: '论文结构', severity: 'warning', message: '未检测到致谢', suggestion: '学位论文通常需要致谢' });
    }

    // Heading level check
    let maxLevel = 0;
    let headingCount = 0;
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      const numMatch = trimmed.match(/^(\d+(\.\d+)*)\s/);
      if (numMatch) {
        const level = numMatch[1].split('.').length;
        if (level > maxLevel) maxLevel = level;
        headingCount++;
      }
    });
    if (maxLevel > 4) {
      result.push({ category: '标题层级', severity: 'warning', message: `标题层级最深到 ${maxLevel} 级，建议不超过 4 级`, suggestion: '简化章节结构，避免过深的子标题' });
    }
    if (headingCount < 3) {
      result.push({ category: '标题层级', severity: 'warning', message: `仅检测到 ${headingCount} 个编号标题`, suggestion: '论文应有清晰的章节结构' });
    }

    // Citation format check
    const citations = content.match(/\[\d+\]/g) || [];
    const citationSet = new Set(citations);
    if (citations.length > 0 && citationSet.size < citations.length * 0.3) {
      result.push({ category: '引用格式', severity: 'info', message: `检测到 ${citations.length} 处引用，但引用编号重复率较高`, suggestion: '检查是否有重复引用' });
    }

    // Figure/table numbering check
    const figures = content.match(/图\s*\d+[\-\.]\d+|Figure\s*\d+[\-\.]\d+/gi) || [];
    const tables = content.match(/表\s*\d+[\-\.]\d+|Table\s*\d+[\-\.]\d+/gi) || [];
    if (figures.length > 0 || tables.length > 0) {
      result.push({ category: '图表编号', severity: 'info', message: `检测到 ${figures.length} 个图、${tables.length} 个表的编号` });
    } else {
      result.push({ category: '图表编号', severity: 'info', message: '未检测到标准图表编号格式（如"图1-1"）', suggestion: '如论文包含图表，请确保使用标准编号格式' });
    }

    // Punctuation check (same as WordFormatChecker but thesis-specific)
    const enPunctInCn = /[\u4e00-\u9fff][,;:!?()<>]|[,;:!?()<>][\u4e00-\u9fff]/;
    let punctIssues = 0;
    lines.forEach((line, i) => {
      if (enPunctInCn.test(line)) punctIssues++;
    });
    if (punctIssues > 0) {
      result.push({ category: '标点规范', severity: 'error', message: `${punctIssues} 行存在中英文标点混用`, suggestion: '中文内容使用中文标点' });
    }

    // Spacing between Chinese and English
    let spacingIssues = 0;
    lines.forEach(line => {
      if (/[\u4e00-\u9fff][a-zA-Z]|[a-zA-Z][\u4e00-\u9fff]/.test(line)) spacingIssues++;
    });
    if (spacingIssues > 5) {
      result.push({ category: '排版规范', severity: 'info', message: `${spacingIssues} 行中英文之间缺少空格`, suggestion: '中英文之间加一个空格更规范（部分学校不要求）' });
    }

    // Abstract length check
    const abstractStart = lines.findIndex(l => /^摘\s*要|^Abstract/i.test(l.trim()));
    if (abstractStart >= 0) {
      const abstractLines: string[] = [];
      for (let i = abstractStart + 1; i < lines.length; i++) {
        if (/^关键词|^Keywords|^1\s|^第一章/i.test(lines[i].trim())) break;
        abstractLines.push(lines[i]);
      }
      const abstractText = abstractLines.join('');
      const abstractCn = (abstractText.match(/[\u4e00-\u9fff]/g) || []).length;
      if (abstractCn > 0 && abstractCn < 200) {
        result.push({ category: '摘要规范', severity: 'warning', message: `中文摘要约 ${abstractCn} 字，建议 300-500 字`, suggestion: '摘要应包含研究目的、方法、结果和结论' });
      } else if (abstractCn >= 200) {
        result.push({ category: '摘要规范', severity: 'info', message: `中文摘要约 ${abstractCn} 字` });
      }
    }

    setIssues(result);
    setChecked(true);
  };

  const stats = checked ? {
    errors: issues.filter(i => i.severity === 'error').length,
    warnings: issues.filter(i => i.severity === 'warning').length,
    infos: issues.filter(i => i.severity === 'info').length,
  } : null;

  const exportReport = () => {
    const lines = issues.map(i =>
      `[${i.severity === 'error' ? '错误' : i.severity === 'warning' ? '警告' : '信息'}] ${i.category}: ${i.message}${i.suggestion ? `\n  → ${i.suggestion}` : ''}`
    );
    copyToClipboard(`论文格式检查报告 - ${fileName}\n类型: ${thesisType === 'undergrad' ? '本科' : thesisType === 'master' ? '硕士' : '博士'}论文\n${'='.repeat(40)}\n\n` + lines.join('\n\n'));
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b735c]">检查学位论文格式规范：字数、结构、标题层级、引用、标点等</p>

      <div className="flex gap-2">
        {([
          { key: 'undergrad' as const, label: '本科' },
          { key: 'master' as const, label: '硕士' },
          { key: 'phd' as const, label: '博士' },
        ]).map(t => (
          <button key={t.key} onClick={() => setThesisType(t.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${thesisType === t.key ? 'bg-[#7a421b] text-[#fff8ef]' : 'bg-[#f1dcc2] text-[#6f3714] hover:bg-[#ead0ad]'}`}>
            {t.label}论文
          </button>
        ))}
      </div>

      <UploadZone onUpload={() => inputRef.current?.click()} onDropFiles={handleFile} accept=".txt,.md,.docx" label="上传论文文本" sublabel="支持 TXT、Markdown、DOCX（本地解析）" />
      <input ref={inputRef} type="file" className="hidden" accept=".txt,.md,.docx" onChange={e => handleFile(e.target.files)} />
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-600">{error}</div>}

      {content && (
        <div className="text-sm text-[#6d5a47]">已加载 <span className="font-medium">{fileName}</span>（{content.length} 字符）</div>
      )}

      <Btn onClick={check} disabled={!content}>
        <FileCheck className="w-4 h-4 mr-1" />开始检查
      </Btn>

      {stats && (
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-center">
            <div className="text-lg font-bold text-red-600">{stats.errors}</div>
            <div className="text-xs text-red-700">错误</div>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-center">
            <div className="text-lg font-bold text-amber-600">{stats.warnings}</div>
            <div className="text-xs text-amber-700">警告</div>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-2 text-center">
            <div className="text-lg font-bold text-blue-600">{stats.infos}</div>
            <div className="text-xs text-blue-700">信息</div>
          </div>
        </div>
      )}

      {checked && (
        <div className="space-y-2 max-h-80 overflow-y-auto">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium text-[#6d5a47]">检查结果</span>
            <button onClick={exportReport} className="text-xs text-[#7a421b] hover:underline flex items-center gap-1">
              <Download className="w-3 h-3" />复制报告
            </button>
          </div>
          {issues.map((issue, i) => (
            <div key={i} className={`rounded-lg border p-2 ${issue.severity === 'error' ? 'border-red-200 bg-red-50' : issue.severity === 'warning' ? 'border-amber-200 bg-amber-50' : 'border-blue-200 bg-blue-50'}`}>
              <div className="flex items-center gap-1 mb-1">
                {issue.severity === 'error' ? <AlertTriangle className="w-3 h-3 text-red-500" /> : issue.severity === 'warning' ? <AlertTriangle className="w-3 h-3 text-amber-500" /> : <Info className="w-3 h-3 text-blue-500" />}
                <span className="text-xs font-medium text-[#6d5a47]">{issue.category}</span>
                <span className={`text-[10px] px-1 rounded ${issue.severity === 'error' ? 'bg-red-100 text-red-600' : issue.severity === 'warning' ? 'bg-amber-100 text-amber-600' : 'bg-blue-100 text-blue-600'}`}>
                  {issue.severity === 'error' ? '错误' : issue.severity === 'warning' ? '警告' : '信息'}
                </span>
              </div>
              <div className="text-xs text-[#8b735c]">{issue.message}</div>
              {issue.suggestion && <div className="text-xs text-[#7a421b] mt-1">→ {issue.suggestion}</div>}
            </div>
          ))}
        </div>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
        <p className="text-xs text-amber-700">
          提示：此工具基于文本分析进行初步检查，各学校格式要求可能不同。请以学校发布的论文格式规范为准。
        </p>
      </div>

      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    </div>
  );
};

export default ThesisFormatChecker;
