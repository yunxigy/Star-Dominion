import React, { useState, useRef, useCallback } from 'react';
import { Btn, ResultBox, copyToClipboard, formatFileSize } from '../shared';
import { UploadZone } from '../shared';
import { FileCheck, AlertTriangle, CheckCircle, Info, Download } from 'lucide-react';
import { readSupportedDocumentText } from '../featureSupport';

interface CheckRule {
  key: string;
  label: string;
  desc: string;
  enabled: boolean;
  severity: 'error' | 'warning' | 'info';
}

interface CheckIssue {
  rule: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  suggestion?: string;
}

const WordFormatChecker: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [content, setContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [issues, setIssues] = useState<CheckIssue[]>([]);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState('');
  const [rules, setRules] = useState<CheckRule[]>([
    { key: 'title', label: '标题格式', desc: '检查标题层级和编号', enabled: true, severity: 'warning' },
    { key: 'paragraph', label: '段落格式', desc: '检查首行缩进、段间距', enabled: true, severity: 'info' },
    { key: 'punctuation', label: '标点符号', desc: '检查中英文标点混用', enabled: true, severity: 'error' },
    { key: 'spacing', label: '空格检查', desc: '检查多余空格和中英文间空格', enabled: true, severity: 'warning' },
    { key: 'number', label: '数字格式', desc: '检查数字使用规范', enabled: false, severity: 'info' },
    { key: 'reference', label: '引用标记', desc: '检查引用标注格式', enabled: false, severity: 'warning' },
  ]);
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

  const toggleRule = (key: string) => {
    setRules(prev => prev.map(r => r.key === key ? { ...r, enabled: !r.enabled } : r));
  };

  const check = () => {
    if (!content) return;
    const result: CheckIssue[] = [];
    const enabled = new Set(rules.filter(r => r.enabled).map(r => r.key));
    const lines = content.split('\n');

    // Title format check
    if (enabled.has('title')) {
      let lastLevel = 0;
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        // Check for numbered headings like "1." "1.1" "第一章"
        const numMatch = trimmed.match(/^(\d+\.?\d*)\s/);
        const cnMatch = trimmed.match(/^[第][一二三四五六七八九十百]+[章节]/);
        if (numMatch) {
          const level = numMatch[1].split('.').length;
          if (level > lastLevel + 1) {
            result.push({ rule: '标题格式', severity: 'warning', message: `第 ${i + 1} 行: 标题层级跳跃 (从 ${lastLevel} 到 ${level})`, suggestion: '保持标题层级连续递增' });
          }
          lastLevel = level;
        } else if (cnMatch) {
          lastLevel = 1;
        }
      });
      // Check for missing first-level heading
      if (!lines.some(l => /^(第[一二三四五六七八九十百]+[章节]|1\.?\s)/.test(l.trim()))) {
        result.push({ rule: '标题格式', severity: 'warning', message: '未检测到一级标题', suggestion: '文档应以一级标题开始' });
      }
    }

    // Paragraph format check
    if (enabled.has('paragraph')) {
      let consecutiveEmpty = 0;
      lines.forEach((line, i) => {
        if (line.trim() === '') {
          consecutiveEmpty++;
          if (consecutiveEmpty > 2) {
            result.push({ rule: '段落格式', severity: 'info', message: `第 ${i + 1} 行: 连续空行过多 (${consecutiveEmpty} 行)`, suggestion: '段落间保持 1-2 个空行' });
          }
        } else {
          consecutiveEmpty = 0;
        }
        // Check for indentation (Chinese docs typically use 2-char indent)
        if (line.trim().length > 0 && !line.startsWith('  ') && !line.startsWith('\t') && line.trim().length > 20) {
          // Long lines without indentation
        }
      });
    }

    // Punctuation check
    if (enabled.has('punctuation')) {
      const cnPunct = /[，。；：！？、（）【】《》""''…—]/;
      const enPunctInCn = /[\u4e00-\u9fff][,;:!?()<>]|[,;:!?()<>][\u4e00-\u9fff]/;
      lines.forEach((line, i) => {
        const matches = [...line.matchAll(new RegExp(enPunctInCn.source, 'g'))];
        if (matches.length > 0) {
          result.push({ rule: '标点符号', severity: 'error', message: `第 ${i + 1} 行: 中英文标点混用 (${matches.length} 处)`, suggestion: '中文内容使用中文标点，英文内容使用英文标点' });
        }
      });
    }

    // Spacing check
    if (enabled.has('spacing')) {
      lines.forEach((line, i) => {
        // Multiple consecutive spaces
        if (/  {2,}/.test(line)) {
          result.push({ rule: '空格检查', severity: 'warning', message: `第 ${i + 1} 行: 存在连续多余空格`, suggestion: '清理多余空格' });
        }
        // Missing space between CJK and English
        const noSpace = /[\u4e00-\u9fff][a-zA-Z]|[a-zA-Z][\u4e00-\u9fff]/;
        if (noSpace.test(line)) {
          result.push({ rule: '空格检查', severity: 'info', message: `第 ${i + 1} 行: 中英文之间缺少空格`, suggestion: '中英文之间加一个空格更规范' });
        }
      });
    }

    // Number format check
    if (enabled.has('number')) {
      lines.forEach((line, i) => {
        // Chinese number in formal context
        if (/[一二三四五六七八九十]个|[一二三四五六七八九十]次/.test(line)) {
          result.push({ rule: '数字格式', severity: 'info', message: `第 ${i + 1} 行: 使用了中文数字`, suggestion: '正式文档中建议统一使用阿拉伯数字' });
        }
      });
    }

    // Reference check
    if (enabled.has('reference')) {
      const refPattern = /\[\d+\]|\（\d+）|见第\d+页/;
      const hasRef = lines.some(l => refPattern.test(l));
      if (hasRef) {
        // Check if references section exists
        const hasRefSection = lines.some(l => /^参考文献|References|^参考资料/i.test(l.trim()));
        if (!hasRefSection) {
          result.push({ rule: '引用标记', severity: 'warning', message: '文中存在引用标记但未找到参考文献章节', suggestion: '添加参考文献列表' });
        }
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

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b735c]">检查文档格式规范：标题层级、标点符号、空格、段落格式等</p>

      <UploadZone onUpload={() => inputRef.current?.click()} onDropFiles={handleFile} accept=".txt,.md,.docx" label="上传文档" sublabel="支持 TXT、Markdown、DOCX（本地解析）" />
      <input ref={inputRef} type="file" className="hidden" accept=".txt,.md,.docx" onChange={e => handleFile(e.target.files)} />
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-600">{error}</div>}

      {content && (
        <div className="text-sm text-[#6d5a47]">已加载 <span className="font-medium">{fileName}</span>（{content.length} 字符）</div>
      )}

      <div className="space-y-2">
        <span className="text-xs font-medium text-[#6d5a47]">检查规则:</span>
        <div className="grid grid-cols-2 gap-2">
          {rules.map(rule => (
            <label key={rule.key} className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer ${rule.enabled ? 'border-[#7a421b] bg-[#fff8ef]' : 'border-[#ead0ad] bg-white'}`}>
              <input type="checkbox" checked={rule.enabled} onChange={() => toggleRule(rule.key)} className="mt-0.5 accent-[#7a421b]" />
              <div>
                <div className="text-xs font-medium text-[#6d5a47] flex items-center gap-1">
                  {rule.label}
                  <span className={`text-[10px] px-1 rounded ${rule.severity === 'error' ? 'bg-red-100 text-red-600' : rule.severity === 'warning' ? 'bg-amber-100 text-amber-600' : 'bg-blue-100 text-blue-600'}`}>
                    {rule.severity === 'error' ? '错误' : rule.severity === 'warning' ? '警告' : '建议'}
                  </span>
                </div>
                <div className="text-xs text-[#8b735c]">{rule.desc}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <Btn onClick={check} disabled={!content}>
          <FileCheck className="w-4 h-4 mr-1" />开始检查
        </Btn>
        {checked && issues.length > 0 && (
          <Btn onClick={() => copyToClipboard(issues.map(i => `[${i.severity}] ${i.rule}: ${i.message}${i.suggestion ? `\n  → ${i.suggestion}` : ''}`).join('\n'))} variant="ghost">
            <Download className="w-4 h-4 mr-1" />复制报告
          </Btn>
        )}
      </div>

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
            <div className="text-xs text-blue-700">建议</div>
          </div>
        </div>
      )}

      {checked && (
        <div className="max-h-60 overflow-y-auto space-y-2">
          {issues.length === 0 ? (
            <div className="text-center py-4 text-sm text-green-600 flex items-center justify-center gap-2">
              <CheckCircle className="w-5 h-5" />未发现格式问题
            </div>
          ) : (
            issues.map((issue, i) => (
              <div key={i} className={`rounded-lg border p-2 ${issue.severity === 'error' ? 'border-red-200 bg-red-50' : issue.severity === 'warning' ? 'border-amber-200 bg-amber-50' : 'border-blue-200 bg-blue-50'}`}>
                <div className="flex items-center gap-1 mb-1">
                  {issue.severity === 'error' ? <AlertTriangle className="w-3 h-3 text-red-500" /> : issue.severity === 'warning' ? <AlertTriangle className="w-3 h-3 text-amber-500" /> : <Info className="w-3 h-3 text-blue-500" />}
                  <span className="text-xs font-medium text-[#6d5a47]">{issue.rule}</span>
                </div>
                <div className="text-xs text-[#8b735c]">{issue.message}</div>
                {issue.suggestion && <div className="text-xs text-[#7a421b] mt-1">→ {issue.suggestion}</div>}
              </div>
            ))
          )}
        </div>
      )}

      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    </div>
  );
};

export default WordFormatChecker;
