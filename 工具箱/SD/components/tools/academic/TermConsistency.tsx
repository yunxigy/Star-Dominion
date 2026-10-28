import React, { useState, useRef, useCallback } from 'react';
import { Btn, copyToClipboard } from '../shared';
import { UploadZone } from '../shared';
import { readSupportedDocumentText } from '../featureSupport';
import { Languages, AlertTriangle, CheckCircle, Download, Plus, Trash2 } from 'lucide-react';

interface TermPair {
  id: string;
  chinese: string;
  english: string;
  category: string;
}

interface Inconsistency {
  type: 'zh_variant' | 'en_variant' | 'zh_en_mismatch' | 'untranslated';
  term1: string;
  term2: string;
  line1: number;
  line2: number;
  suggestion: string;
  severity: 'error' | 'warning';
}

const COMMON_TERMS: TermPair[] = [
  { id: '1', chinese: '算法', english: 'algorithm', category: '计算机' },
  { id: '2', chinese: '数据结构', english: 'data structure', category: '计算机' },
  { id: '3', chinese: '机器学习', english: 'machine learning', category: '计算机' },
  { id: '4', chinese: '深度学习', english: 'deep learning', category: '计算机' },
  { id: '5', chinese: '神经网络', english: 'neural network', category: '计算机' },
  { id: '6', chinese: '实验', english: 'experiment', category: '通用' },
  { id: '7', chinese: '方法', english: 'method', category: '通用' },
  { id: '8', chinese: '结果', english: 'result', category: '通用' },
  { id: '9', chinese: '分析', english: 'analysis', category: '通用' },
  { id: '10', chinese: '模型', english: 'model', category: '通用' },
  { id: '11', chinese: '参数', english: 'parameter', category: '通用' },
  { id: '12', chinese: '性能', english: 'performance', category: '通用' },
  { id: '13', chinese: '准确率', english: 'accuracy', category: '计算机' },
  { id: '14', chinese: '召回率', english: 'recall', category: '计算机' },
  { id: '15', chinese: '精度', english: 'precision', category: '计算机' },
  { id: '16', chinese: '训练', english: 'training', category: '计算机' },
  { id: '17', chinese: '测试', english: 'testing', category: '计算机' },
  { id: '18', chinese: '验证', english: 'validation', category: '计算机' },
  { id: '19', chinese: '特征', english: 'feature', category: '计算机' },
  { id: '20', chinese: '样本', english: 'sample', category: '统计' },
];

const COMMON_VARIANTS: [string, string, string][] = [
  ['准确率', '准确度', '建议统一使用"准确率"'],
  ['召回率', '查全率', '建议统一使用"召回率"'],
  ['精度', '精确率', '建议统一使用"精度"'],
  ['数据集', '数据集合', '建议统一使用"数据集"'],
  ['网络', '神经网络', '请确认是否指同一概念'],
  ['训练集', '训练数据', '建议统一使用"训练集"'],
  ['测试集', '测试数据', '建议统一使用"测试集"'],
  ['验证集', '验证数据', '建议统一使用"验证集"'],
  ['超参数', '超参', '建议统一使用"超参数"'],
  ['目标函数', '损失函数', '请确认是否指同一概念'],
  ['梯度下降', '梯度下降法', '建议统一使用"梯度下降"'],
  ['反向传播', 'BP算法', '建议统一使用"反向传播"'],
  ['卷积神经网络', 'CNN', '首次出现用全称+缩写，后续可用缩写'],
  ['循环神经网络', 'RNN', '首次出现用全称+缩写，后续可用缩写'],
  ['生成对抗网络', 'GAN', '首次出现用全称+缩写，后续可用缩写'],
  ['transformer', 'Transformer', '建议统一大小写：Transformer'],
  ['attention', 'Attention', '建议统一大小写：Attention'],
  ['fine-tuning', '微调', '中英文混用，建议统一'],
  ['pre-training', '预训练', '中英文混用，建议统一'],
  ['overfitting', '过拟合', '中英文混用，建议统一'],
  ['underfitting', '欠拟合', '中英文混用，建议统一'],
  ['batch size', '批量大小', '中英文混用，建议统一'],
  ['learning rate', '学习率', '中英文混用，建议统一'],
  ['epoch', '轮次', '中英文混用，建议统一'],
  ['baseline', '基线', '中英文混用，建议统一'],
];

const generateId = () => Math.random().toString(36).slice(2, 9);

const TermConsistency: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [content, setContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [terms, setTerms] = useState<TermPair[]>(COMMON_TERMS);
  const [inconsistencies, setInconsistencies] = useState<Inconsistency[]>([]);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState('');
  const [newTerm, setNewTerm] = useState({ chinese: '', english: '', category: '自定义' });
  const [showTermEditor, setShowTermEditor] = useState(false);
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
      setInconsistencies([]);
      setError('');
    } catch (uploadError) {
      setContent('');
      setChecked(false);
      setInconsistencies([]);
      setError(`读取失败：${(uploadError as Error).message}`);
    }
  }, []);

  const addTerm = () => {
    if (!newTerm.chinese || !newTerm.english) return;
    setTerms(prev => [...prev, { id: generateId(), ...newTerm }]);
    setNewTerm({ chinese: '', english: '', category: '自定义' });
  };

  const removeTerm = (id: string) => {
    setTerms(prev => prev.filter(t => t.id !== id));
  };

  const check = () => {
    if (!content) return;
    const result: Inconsistency[] = [];
    const lines = content.split('\n');

    // Check Chinese term variants
    for (const [variant1, variant2, suggestion] of COMMON_VARIANTS) {
      const hasV1 = lines.some(l => l.includes(variant1));
      const hasV2 = lines.some(l => l.includes(variant2));
      if (hasV1 && hasV2) {
        const line1 = lines.findIndex(l => l.includes(variant1)) + 1;
        const line2 = lines.findIndex(l => l.includes(variant2)) + 1;
        result.push({
          type: 'zh_variant',
          term1: variant1,
          term2: variant2,
          line1,
          line2,
          suggestion,
          severity: 'warning',
        });
      }
    }

    // Check case consistency for English terms
    const enTerms = new Set<string>();
    terms.forEach(t => {
      if (t.english) {
        enTerms.add(t.english.toLowerCase());
      }
    });

    // Check for mixed Chinese/English usage
    for (const term of terms) {
      if (!term.chinese || !term.english) continue;
      const hasCn = lines.some(l => l.includes(term.chinese));
      const hasEn = lines.some(l => {
        const regex = new RegExp(`\\b${term.english.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        return regex.test(l);
      });
      if (hasCn && hasEn) {
        const cnLine = lines.findIndex(l => l.includes(term.chinese)) + 1;
        const enLine = lines.findIndex(l => {
          const regex = new RegExp(`\\b${term.english.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
          return regex.test(l);
        }) + 1;
        if (cnLine > 0 && enLine > 0 && cnLine !== enLine) {
          result.push({
            type: 'zh_en_mismatch',
            term1: term.chinese,
            term2: term.english,
            line1: cnLine,
            line2: enLine,
            suggestion: `"${term.chinese}"和"${term.english}"在同一文档中混用，建议统一`,
            severity: 'info' as 'warning',
          });
        }
      }
    }

    // Check for untranslated English terms (common in CS papers)
    const untranslatedPatterns = [
      /\b[a-zA-Z]{4,}\b/g, // English words 4+ chars
    ];
    const cnLines = lines.filter(l => /[\u4e00-\u9fff]/.test(l));
    const enWordCounts: Record<string, number> = {};
    cnLines.forEach(line => {
      const matches = line.match(/\b[a-zA-Z]{4,}\b/g) || [];
      matches.forEach(m => {
        const lower = m.toLowerCase();
        enWordCounts[lower] = (enWordCounts[lower] || 0) + 1;
      });
    });

    // Find frequently used English words that might need Chinese translation
    for (const [word, count] of Object.entries(enWordCounts)) {
      if (count >= 3) {
        const matchingTerm = terms.find(t => t.english.toLowerCase() === word);
        if (!matchingTerm) {
          result.push({
            type: 'untranslated',
            term1: word,
            term2: '',
            line1: 0,
            line2: 0,
            suggestion: `"${word}" 在中文段落中出现 ${count} 次，建议添加中文术语对照`,
            severity: 'info' as 'warning',
          });
        }
      }
    }

    // Sort by severity
    result.sort((a, b) => {
      const order = { error: 0, warning: 1, info: 2 };
      return (order[a.severity] || 2) - (order[b.severity] || 2);
    });

    setInconsistencies(result);
    setChecked(true);
  };

  const stats = checked ? {
    errors: inconsistencies.filter(i => i.severity === 'error').length,
    warnings: inconsistencies.filter(i => i.severity === 'warning').length,
  } : null;

  const exportReport = () => {
    const lines = inconsistencies.map(i => {
      const typeLabel = i.type === 'zh_variant' ? '中文变体' : i.type === 'zh_en_mismatch' ? '中英混用' : '未翻译';
      return `[${typeLabel}] "${i.term1}"${i.term2 ? ` / "${i.term2}"` : ''} — ${i.suggestion}${i.line1 ? ` (行${i.line1})` : ''}`;
    });
    copyToClipboard(`中英文术语一致性检查报告 - ${fileName}\n${'='.repeat(40)}\n\n` + lines.join('\n'));
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b735c]">检查论文中中英文术语的一致性：变体混用、大小写不统一、中英混用等</p>

      <UploadZone onUpload={() => inputRef.current?.click()} onDropFiles={handleFile} accept=".txt,.md,.docx" label="上传论文文本" sublabel="支持 TXT、Markdown、DOCX（本地解析）" />
      <input ref={inputRef} type="file" className="hidden" accept=".txt,.md,.docx" onChange={e => handleFile(e.target.files)} />
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-600">{error}</div>}

      {content && (
        <div className="text-sm text-[#6d5a47]">已加载 <span className="font-medium">{fileName}</span>（{content.length} 字符，{content.split('\n').length} 行）</div>
      )}

      {/* Term dictionary */}
      <div className="bg-[#fff4e6] border border-[#ead0ad] rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-[#6f3714]">术语词典（{terms.length} 条）</span>
          <button onClick={() => setShowTermEditor(!showTermEditor)} className="text-xs text-[#7a421b] hover:underline">
            {showTermEditor ? '收起' : '管理术语'}
          </button>
        </div>

        {showTermEditor && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input value={newTerm.chinese} onChange={e => setNewTerm(prev => ({ ...prev, chinese: e.target.value }))}
                className="text-xs border border-[#ead0ad] rounded px-2 py-1 flex-1 bg-white" placeholder="中文术语" />
              <input value={newTerm.english} onChange={e => setNewTerm(prev => ({ ...prev, english: e.target.value }))}
                className="text-xs border border-[#ead0ad] rounded px-2 py-1 flex-1 bg-white" placeholder="English term" />
              <input value={newTerm.category} onChange={e => setNewTerm(prev => ({ ...prev, category: e.target.value }))}
                className="text-xs border border-[#ead0ad] rounded px-2 py-1 w-20 bg-white" placeholder="分类" />
              <Btn onClick={addTerm} className="shrink-0"><Plus className="w-3 h-3" /></Btn>
            </div>
            <div className="max-h-32 overflow-y-auto space-y-0.5">
              {terms.slice(0, 30).map(t => (
                <div key={t.id} className="flex items-center gap-2 text-xs text-[#8b735c]">
                  <span className="font-medium text-[#6d5a47]">{t.chinese}</span>
                  <span>↔</span>
                  <span>{t.english}</span>
                  <span className="text-[#c79f72]">({t.category})</span>
                  <button onClick={() => removeTerm(t.id)} className="text-red-400 hover:text-red-600 ml-auto"><Trash2 className="w-3 h-3" /></button>
                </div>
              ))}
              {terms.length > 30 && <div className="text-[10px] text-[#c79f72]">... 还有 {terms.length - 30} 条</div>}
            </div>
          </div>
        )}
      </div>

      <Btn onClick={check} disabled={!content}>
        <Languages className="w-4 h-4 mr-1" />开始检查
      </Btn>

      {stats && (
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-center">
            <div className="text-lg font-bold text-red-600">{stats.errors}</div>
            <div className="text-xs text-red-700">不一致</div>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-center">
            <div className="text-lg font-bold text-amber-600">{stats.warnings}</div>
            <div className="text-xs text-amber-700">建议检查</div>
          </div>
        </div>
      )}

      {checked && (
        <div className="space-y-2 max-h-80 overflow-y-auto">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium text-[#6d5a47]">检查结果</span>
            <button onClick={exportReport} className="text-xs text-[#7a421b] hover:underline flex items-center gap-1">
              <Download className="w-3 h-3" />导出报告
            </button>
          </div>
          {inconsistencies.length === 0 ? (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <span className="text-xs text-green-700">未发现术语一致性问题</span>
            </div>
          ) : (
            inconsistencies.map((issue, i) => (
              <div key={i} className={`rounded-lg border p-2 ${issue.severity === 'error' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
                <div className="flex items-center gap-1 mb-1">
                  <AlertTriangle className={`w-3 h-3 ${issue.severity === 'error' ? 'text-red-500' : 'text-amber-500'}`} />
                  <span className="text-[10px] px-1 rounded bg-white">
                    {issue.type === 'zh_variant' ? '中文变体' : issue.type === 'zh_en_mismatch' ? '中英混用' : '未翻译'}
                  </span>
                </div>
                <div className="text-xs text-[#8b735c]">
                  <span className="font-medium">"{issue.term1}"</span>
                  {issue.term2 && <span> / <span className="font-medium">"{issue.term2}"</span></span>}
                </div>
                <div className="text-xs text-[#7a421b] mt-1">→ {issue.suggestion}</div>
                {issue.line1 > 0 && <div className="text-[10px] text-[#c79f72] mt-0.5">位置：第 {issue.line1} 行{issue.line2 > 0 && issue.line2 !== issue.line1 ? ` / 第 ${issue.line2} 行` : ''}</div>}
              </div>
            ))
          )}
        </div>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
        <p className="text-xs text-amber-700">
          提示：此工具基于术语词典和常见变体规则进行检查。建议根据学科领域自定义术语词典，首次出现的英文缩写应标注全称。
        </p>
      </div>

      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    </div>
  );
};

export default TermConsistency;
