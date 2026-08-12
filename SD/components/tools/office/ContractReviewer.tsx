import React, { useState, useRef, useCallback } from 'react';
import { Btn, ResultBox, copyToClipboard } from '../shared';
import { UploadZone } from '../shared';
import { Scale, AlertTriangle, CheckCircle, Shield, FileText, Download } from 'lucide-react';
import { extractContractText } from '../featureSupport';

interface ReviewItem {
  category: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  suggestion: string;
  found: boolean;
}

const ContractReviewer: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [content, setContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [reviewResults, setReviewResults] = useState<ReviewItem[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (fl: FileList | null) => {
    if (!fl?.[0]) return;
    const file = fl[0];
    try {
      const text = await extractContractText(file.name, await file.arrayBuffer());
      if (!text) throw new Error('文档中没有可读取的文本');
      setFileName(file.name);
      setContent(text);
      setReviewed(false);
      setReviewResults([]);
      setError('');
    } catch (uploadError) {
      setFileName('');
      setContent('');
      setReviewed(false);
      setReviewResults([]);
      setError((uploadError as Error).message);
    }
  }, []);

  const reviewContract = () => {
    if (!content) return;
    const results: ReviewItem[] = [];

    // Key clause checks
    const checks: Omit<ReviewItem, 'found'>[] = [
      // Payment terms
      { category: '付款条款', severity: 'high', title: '付款金额与方式', description: '检查是否明确约定付款金额、付款方式和付款时间', suggestion: '确保合同明确约定：总金额、分期付款节点、付款方式（银行转账等）、逾期付款违约金' },
      { category: '付款条款', severity: 'medium', title: '发票条款', description: '检查是否约定发票开具时间与类型', suggestion: '明确约定先票后款或先款后票，发票类型（增值税专用/普通）' },

      // Duration & termination
      { category: '期限与解除', severity: 'high', title: '合同期限', description: '检查是否明确约定合同起止日期', suggestion: '明确约定生效日期和终止日期，或约定有效期及续签条件' },
      { category: '期限与解除', severity: 'high', title: '解除条件', description: '检查是否约定单方解除权和解除程序', suggestion: '约定解除通知方式、解除后的清算条款、宽限期等' },
      { category: '期限与解除', severity: 'medium', title: '不可抗力', description: '检查是否包含不可抗力条款', suggestion: '约定不可抗力范围、通知义务、减损措施和后果' },

      // Liability
      { category: '违约责任', severity: 'high', title: '违约金', description: '检查是否约定违约金或赔偿计算方式', suggestion: '约定具体违约金数额或计算方式，避免"依法赔偿"等模糊表述' },
      { category: '违约责任', severity: 'medium', title: '损害赔偿范围', description: '检查是否限定损害赔偿范围', suggestion: '约定间接损失是否赔偿、赔偿上限等' },

      // IP & Confidentiality
      { category: '知识产权', severity: 'high', title: '知识产权归属', description: '检查是否约定合作成果的知识产权归属', suggestion: '明确约定背景知识产权和前景知识产权的归属与许可' },
      { category: '知识产权', severity: 'medium', title: '保密条款', description: '检查是否包含保密条款', suggestion: '约定保密信息范围、保密期限、泄密责任和除外情形' },

      // Dispute resolution
      { category: '争议解决', severity: 'high', title: '管辖法院/仲裁', description: '检查是否约定争议解决方式', suggestion: '选择诉讼或仲裁，约定管辖法院或仲裁机构，注意仲裁条款需明确具体仲裁委员会' },
      { category: '争议解决', severity: 'low', title: '适用法律', description: '检查是否约定适用法律', suggestion: '涉外合同需明确约定适用法律' },

      // Miscellaneous
      { category: '其他条款', severity: 'medium', title: '通知条款', description: '检查是否约定通知送达方式和地址', suggestion: '约定通知方式（邮件/书面）、送达地址和变更通知义务' },
      { category: '其他条款', severity: 'medium', title: '完整协议条款', description: '检查是否约定合同完整性', suggestion: '加入"本合同构成双方完整协议，取代此前所有口头或书面沟通"条款' },
      { category: '其他条款', severity: 'low', title: '可分割性', description: '检查是否约定部分无效不影响其他条款', suggestion: '加入可分割性条款，确保某条款无效不影响合同整体效力' },
    ];

    // Keyword-based detection
    const keywordMap: Record<string, string[]> = {
      '付款金额与方式': ['金额', '价款', '报酬', '付款', '支付', '结算', '万元', '元'],
      '发票条款': ['发票', '增值税', '开票'],
      '合同期限': ['期限', '有效期', '生效', '终止', '届满', '起至'],
      '解除条件': ['解除', '终止', '撤销', '退出', '解约'],
      '不可抗力': ['不可抗力', 'force majeure', '不可预见'],
      '违约金': ['违约金', '违约', '罚金', '赔偿金', '滞纳金'],
      '损害赔偿范围': ['赔偿', '损失', '损害', '间接损失'],
      '知识产权归属': ['知识产权', '著作权', '专利', '商标', '归属', '所有权'],
      '保密条款': ['保密', '商业秘密', '机密', 'NDA', '不披露'],
      '管辖法院/仲裁': ['管辖', '法院', '仲裁', '诉讼', '争议解决'],
      '适用法律': ['适用法律', '法律适用', '管辖法律'],
      '通知条款': ['通知', '送达', '告知'],
      '完整协议条款': ['完整协议', '全部协议', '取代', '替代'],
      '可分割性': ['可分割', '部分无效', '不影响'],
    };

    for (const check of checks) {
      const keywords = keywordMap[check.title] || [];
      const found = keywords.some(kw => content.includes(kw));
      results.push({ ...check, found });
    }

    // Additional risk checks
    // Check for vague language
    const vaguePatterns = [
      { pattern: /协商解决|协商确定/g, desc: '模糊表述"协商解决/确定"' },
      { pattern: /合理/g, desc: '模糊表述"合理"' },
      { pattern: /适当/g, desc: '模糊表述"适当"' },
      { pattern: /另行约定/g, desc: '模糊表述"另行约定"' },
    ];

    let vagueCount = 0;
    for (const vp of vaguePatterns) {
      const matches = content.match(vp.pattern);
      if (matches && matches.length > 0) {
        vagueCount += matches.length;
      }
    }
    if (vagueCount > 0) {
      results.push({
        category: '风险提示',
        severity: 'medium',
        title: '模糊表述',
        description: `检测到 ${vagueCount} 处模糊表述（如"协商解决"、"合理"、"适当"、"另行约定"）`,
        suggestion: '模糊表述可能导致争议，建议尽量明确具体标准或条件',
        found: true,
      });
    }

    // Check for standard protective clauses
    const hasSeal = content.includes('盖章') || content.includes('签字') || content.includes('签署');
    if (!hasSeal) {
      results.push({
        category: '签署条款',
        severity: 'high',
        title: '签署条款',
        description: '未检测到签署/盖章相关条款',
        suggestion: '合同应包含签署条款，约定签字盖章生效条件',
        found: false,
      });
    }

    setReviewResults(results);
    setReviewed(true);
  };

  const stats = reviewed ? {
    high: reviewResults.filter(r => r.severity === 'high' && !r.found).length,
    medium: reviewResults.filter(r => r.severity === 'medium' && !r.found).length,
    low: reviewResults.filter(r => r.severity === 'low' && !r.found).length,
    found: reviewResults.filter(r => r.found).length,
    total: reviewResults.length,
  } : null;

  const exportReport = () => {
    const lines = reviewResults.map(r =>
      `[${r.severity === 'high' ? '高' : r.severity === 'medium' ? '中' : '低'}][${r.found ? '已包含' : '缺失'}] ${r.category} - ${r.title}\n  ${r.description}\n  建议: ${r.suggestion}`
    );
    copyToClipboard(`合同审阅报告 - ${fileName}\n${'='.repeat(40)}\n\n` + lines.join('\n\n'));
  };

  const categories = [...new Set(reviewResults.map(r => r.category))];

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b735c]">上传合同文本，自动检查关键条款完整性和潜在风险点</p>

      <div className="flex items-center gap-2 px-3 py-2 bg-yellow-50 border border-yellow-300 rounded-lg">
        <span className="px-1.5 py-0.5 text-[10px] font-bold bg-yellow-400 text-yellow-900 rounded">BETA</span>
        <span className="text-xs text-yellow-700">基础版：基于关键词规则检测，非 AI 语义分析，不构成法律意见</span>
      </div>

      <UploadZone onUpload={() => inputRef.current?.click()} onDropFiles={handleFile} accept=".txt,.md,.docx" label="上传合同文本" sublabel="支持 TXT、Markdown、DOCX" />
      <input ref={inputRef} type="file" className="hidden" accept=".txt,.md,.docx" onChange={e => handleFile(e.target.files)} />
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-600">{error}</div>}

      {content && (
        <div className="text-sm text-[#6d5a47]">已加载 <span className="font-medium">{fileName}</span>（{content.length} 字符）</div>
      )}

      <Btn onClick={reviewContract} disabled={!content}>
        <Scale className="w-4 h-4 mr-1" />开始审阅
      </Btn>

      {stats && (
        <div className="grid grid-cols-4 gap-2">
          <div className="bg-green-50 border border-green-200 rounded-lg p-2 text-center">
            <div className="text-lg font-bold text-green-600">{stats.found}</div>
            <div className="text-xs text-green-700">已包含</div>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-center">
            <div className="text-lg font-bold text-red-600">{stats.high}</div>
            <div className="text-xs text-red-700">高风险缺失</div>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-center">
            <div className="text-lg font-bold text-amber-600">{stats.medium}</div>
            <div className="text-xs text-amber-700">中风险缺失</div>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-2 text-center">
            <div className="text-lg font-bold text-blue-600">{stats.low}</div>
            <div className="text-xs text-blue-700">低风险缺失</div>
          </div>
        </div>
      )}

      {reviewed && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-[#6d5a47]">审阅结果</span>
            <button onClick={exportReport} className="text-xs text-[#7a421b] hover:underline flex items-center gap-1">
              <Download className="w-3 h-3" />复制报告
            </button>
          </div>

          {categories.map(cat => (
            <div key={cat} className="border border-[#ead0ad] rounded-lg overflow-hidden">
              <div className="bg-[#f1dcc2] px-3 py-2 text-sm font-medium text-[#6f3714]">{cat}</div>
              <div className="divide-y divide-[#ead0ad]">
                {reviewResults.filter(r => r.category === cat).map((item, i) => (
                  <div key={i} className={`px-3 py-2 ${item.found ? 'bg-green-50/50' : item.severity === 'high' ? 'bg-red-50/50' : item.severity === 'medium' ? 'bg-amber-50/50' : 'bg-blue-50/50'}`}>
                    <div className="flex items-center gap-2 mb-1">
                      {item.found ? <CheckCircle className="w-3 h-3 text-green-500" /> : <AlertTriangle className={`w-3 h-3 ${item.severity === 'high' ? 'text-red-500' : item.severity === 'medium' ? 'text-amber-500' : 'text-blue-500'}`} />}
                      <span className="text-xs font-medium text-[#6d5a47]">{item.title}</span>
                      <span className={`text-[10px] px-1 rounded ${item.found ? 'bg-green-100 text-green-600' : item.severity === 'high' ? 'bg-red-100 text-red-600' : item.severity === 'medium' ? 'bg-amber-100 text-amber-600' : 'bg-blue-100 text-blue-600'}`}>
                        {item.found ? '已包含' : item.severity === 'high' ? '高风险' : item.severity === 'medium' ? '中风险' : '低风险'}
                      </span>
                    </div>
                    <div className="text-xs text-[#8b735c]">{item.description}</div>
                    {!item.found && <div className="text-xs text-[#7a421b] mt-1">→ {item.suggestion}</div>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
        <p className="text-xs text-amber-700">
          提示：此工具基于关键词匹配进行初步审阅，不构成法律意见。重要合同请务必咨询专业律师。
        </p>
      </div>

      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    </div>
  );
};

export default ContractReviewer;
