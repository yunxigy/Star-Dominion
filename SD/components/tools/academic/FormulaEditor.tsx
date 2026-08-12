import React, { useState, useRef, useEffect } from 'react';
import { Btn, copyToClipboard } from '../shared';
import { Sigma, Copy, Download, RotateCcw, ChevronDown } from 'lucide-react';

const FORMULA_TEMPLATES: Record<string, { label: string; latex: string }[]> = {
  '基础运算': [
    { label: '分数', latex: '\\frac{a}{b}' },
    { label: '上标', latex: 'x^{n}' },
    { label: '下标', latex: 'x_{i}' },
    { label: '根号', latex: '\\sqrt{x}' },
    { label: 'n次根', latex: '\\sqrt[n]{x}' },
    { label: '求和', latex: '\\sum_{i=1}^{n} x_i' },
    { label: '连乘', latex: '\\prod_{i=1}^{n} x_i' },
    { label: '极限', latex: '\\lim_{x \\to \\infty} f(x)' },
  ],
  '微积分': [
    { label: '积分', latex: '\\int_{a}^{b} f(x) \\, dx' },
    { label: '二重积分', latex: '\\iint_{D} f(x,y) \\, dx \\, dy' },
    { label: '偏导数', latex: '\\frac{\\partial f}{\\partial x}' },
    { label: '二阶偏导', latex: '\\frac{\\partial^2 f}{\\partial x^2}' },
    { label: '梯度', latex: '\\nabla f' },
    { label: '微分', latex: 'dy = f\'(x) \\, dx' },
  ],
  '线性代数': [
    { label: '矩阵', latex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}' },
    { label: '行列式', latex: '\\det(A)' },
    { label: '转置', latex: 'A^{\\top}' },
    { label: '特征值', latex: 'A\\mathbf{v} = \\lambda\\mathbf{v}' },
    { label: '向量', latex: '\\vec{a}' },
    { label: '点乘', latex: '\\mathbf{a} \\cdot \\mathbf{b}' },
  ],
  '希腊字母': [
    { label: 'α β γ', latex: '\\alpha \\beta \\gamma' },
    { label: 'δ ε ζ', latex: '\\delta \\epsilon \\zeta' },
    { label: 'θ λ μ', latex: '\\theta \\lambda \\mu' },
    { label: 'π ρ σ', latex: '\\pi \\rho \\sigma' },
    { label: 'φ ψ ω', latex: '\\phi \\psi \\omega' },
    { label: 'Γ Δ Θ', latex: '\\Gamma \\Delta \\Theta' },
  ],
  '逻辑与集合': [
    { label: '属于', latex: 'x \\in A' },
    { label: '子集', latex: 'A \\subseteq B' },
    { label: '并集', latex: 'A \\cup B' },
    { label: '交集', latex: 'A \\cap B' },
    { label: '任意', latex: '\\forall x \\in S' },
    { label: '存在', latex: '\\exists x \\in S' },
  ],
  '箭头与关系': [
    { label: '右箭头', latex: '\\rightarrow' },
    { label: '双向箭头', latex: '\\leftrightarrow' },
    { label: '推出', latex: '\\Rightarrow' },
    { label: '等价', latex: '\\Leftrightarrow' },
    { label: '约等', latex: '\\approx' },
    { label: '不等', latex: '\\neq' },
  ],
};

const latexToText = (latex: string): string => {
  let text = latex;
  const replacements: [RegExp, string | ((substring: string, ...args: string[]) => string)][] = [
    [/\\frac\{([^}]+)\}\{([^}]+)\}/g, '($1)/($2)'],
    [/\\sqrt\{([^}]+)\}/g, 'sqrt($1)'],
    [/\\sqrt\[(\d+)\]\{([^}]+)\}/g, '($1)th-root($2)'],
    [/\\sum_\{([^}]+)\}\^\{([^}]+)\}/g, 'sum($1 to $2)'],
    [/\\prod_\{([^}]+)\}\^\{([^}]+)\}/g, 'prod($1 to $2)'],
    [/\\int_\{([^}]+)\}\^\{([^}]+)\}/g, 'int($1 to $2)'],
    [/\\lim_\{([^}]+)\}/g, 'lim($1)'],
    [/\\partial/g, 'd'],
    [/\\nabla/g, 'nabla'],
    [/\\vec\{([^}]+)\}/g, 'vec($1)'],
    [/\\mathbf\{([^}]+)\}/g, '$1'],
    [/\\begin\{pmatrix\}(.+?)\\end\{pmatrix\}/gs, '[$1]'],
    [/\\left|\\right|\\,|\\displaystyle/g, ''],
    [/\\(alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega)/g, (m) => m.slice(1)],
    [/\\(Alpha|Beta|Gamma|Delta|Epsilon|Zeta|Eta|Theta|Iota|Kappa|Lambda|Mu|Nu|Xi|Pi|Rho|Sigma|Tau|Upsilon|Phi|Chi|Psi|Omega)/g, (m) => m.slice(1).toUpperCase()],
    [/\\(rightarrow|leftarrow|Rightarrow|Leftarrow|leftrightarrow|Leftrightarrow)/g, (m) => {
      const map: Record<string, string> = { rightarrow: '->', leftarrow: '<-', Rightarrow: '=>', Leftarrow: '<=', leftrightarrow: '<->', Leftrightarrow: '<=>' };
      return map[m.slice(1)] || m;
    }],
    [/\\(infty|approx|neq|leq|geq|subseteq|supseteq|cup|cap|in|forall|exists|cdot|times|circ)/g, (m) => {
      const map: Record<string, string> = { infty: 'inf', approx: '~=', neq: '!=', leq: '<=', geq: '>=', subseteq: 'subset=', supseteq: 'superset=', cup: 'union', cap: 'intersect', in: 'in', forall: 'forall', exists: 'exists', cdot: '*', times: 'x', circ: 'o' };
      return map[m.slice(1)] || m;
    }],
    [/\{([^}]+)\}/g, '$1'],
    [/\\\\/g, '; '],
  ];
  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement as any);
  }
  return text.replace(/\s+/g, ' ').trim();
};

const FormulaEditor: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [latex, setLatex] = useState('E = mc^2');
  const [history, setHistory] = useState<string[]>(['E = mc^2']);
  const [historyIdx, setHistoryIdx] = useState(0);
  const [showTemplates, setShowTemplates] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const insertAtCursor = (snippet: string) => {
    setLatex(prev => {
      const newLatex = prev + snippet;
      const newHistory = [...history.slice(0, historyIdx + 1), newLatex];
      setHistory(newHistory);
      setHistoryIdx(newHistory.length - 1);
      return newLatex;
    });
  };

  const undo = () => {
    if (historyIdx > 0) {
      setHistoryIdx(historyIdx - 1);
      setLatex(history[historyIdx - 1]);
    }
  };

  const redo = () => {
    if (historyIdx < history.length - 1) {
      setHistoryIdx(historyIdx + 1);
      setLatex(history[historyIdx + 1]);
    }
  };

  const clearFormula = () => {
    setLatex('');
  };

  const copyLatex = () => copyToClipboard(latex);
  const copyPlainText = () => copyToClipboard(latexToText(latex));
  const copyWordFormat = () => {
    const wordLatex = latex.replace(/\$/g, '').replace(/\\\\/g, '\\r\\n');
    copyToClipboard(wordLatex);
  };

  const downloadPng = async () => {
    if (!previewRef.current) return;
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      canvas.width = 600;
      canvas.height = 120;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 600, 120);
      ctx.fillStyle = '#333333';
      ctx.font = '20px serif';
      ctx.textAlign = 'center';
      ctx.fillText(latexToText(latex), 300, 70);
      const link = document.createElement('a');
      link.download = 'formula.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch {
      // fallback
    }
  };

  const insertSymbol = (symbol: string) => {
    setLatex(prev => prev + symbol);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b735c]">LaTeX 公式编辑器：模板插入、实时预览、多种格式导出</p>

      {/* Quick symbols bar */}
      <div className="bg-[#fff4e6] border border-[#ead0ad] rounded-lg p-2">
        <div className="text-xs text-[#6d5a47] font-medium mb-1">快速插入</div>
        <div className="flex flex-wrap gap-1">
          {['^', '_', '{', '}', '\\frac{}{}', '\\sqrt{}', '\\sum', '\\int', '\\infty', '\\alpha', '\\beta', '\\gamma', '\\delta', '\\theta', '\\lambda', '\\pi', '\\sigma', '\\phi', '\\omega', '\\nabla', '\\partial'].map(s => (
            <button key={s} onClick={() => insertSymbol(s)}
              className="text-xs px-1.5 py-0.5 bg-white border border-[#ead0ad] rounded hover:bg-[#f1dcc2] text-[#6f3714]">
              {s.replace(/\\/, '')}
            </button>
          ))}
        </div>
      </div>

      {/* Template categories */}
      <div className="space-y-1">
        <div className="text-xs text-[#6d5a47] font-medium">公式模板</div>
        <div className="flex flex-wrap gap-1">
          {Object.keys(FORMULA_TEMPLATES).map(cat => (
            <button key={cat} onClick={() => setShowTemplates(showTemplates === cat ? null : cat)}
              className={`text-xs px-2 py-1 rounded ${showTemplates === cat ? 'bg-[#7a421b] text-[#fff8ef]' : 'bg-[#f1dcc2] text-[#6f3714] hover:bg-[#ead0ad]'}`}>
              {cat} <ChevronDown className="w-3 h-3 inline" />
            </button>
          ))}
        </div>
        {showTemplates && FORMULA_TEMPLATES[showTemplates] && (
          <div className="flex flex-wrap gap-1 bg-[#fff4e6] border border-[#ead0ad] rounded-lg p-2">
            {FORMULA_TEMPLATES[showTemplates].map(t => (
              <button key={t.label} onClick={() => insertAtCursor(t.latex)}
                className="text-xs px-2 py-1 bg-white border border-[#ead0ad] rounded hover:bg-[#f1dcc2] text-[#6f3714]">
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* LaTeX input */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-[#6d5a47] font-medium">LaTeX 公式</label>
          <div className="flex gap-1">
            <button onClick={undo} disabled={historyIdx <= 0} className="text-xs text-[#7a421b] disabled:text-[#c79f72] hover:underline">撤销</button>
            <button onClick={redo} disabled={historyIdx >= history.length - 1} className="text-xs text-[#7a421b] disabled:text-[#c79f72] hover:underline">重做</button>
            <button onClick={clearFormula} className="text-xs text-red-500 hover:underline">清空</button>
          </div>
        </div>
        <textarea value={latex} onChange={e => {
          setLatex(e.target.value);
          const newHistory = [...history.slice(0, historyIdx + 1), e.target.value];
          setHistory(newHistory);
          setHistoryIdx(newHistory.length - 1);
        }}
          className="w-full p-2 border border-[#ead0ad] rounded-lg text-sm font-mono bg-white resize-y min-h-[60px]"
          placeholder="输入 LaTeX 公式，如 E = mc^2 或 \frac{a}{b}" />
      </div>

      {/* Preview */}
      <div className="bg-white border border-[#ead0ad] rounded-lg p-4">
        <div className="text-xs text-[#6d5a47] font-medium mb-2">预览</div>
        <div ref={previewRef} className="text-center text-lg text-[#333] min-h-[40px] flex items-center justify-center">
          {latex ? (
            <span className="font-mono">{latexToText(latex)}</span>
          ) : (
            <span className="text-[#c79f72] text-sm">输入公式后显示预览</span>
          )}
        </div>
        <div className="text-xs text-[#8b735c] mt-2 border-t border-[#ead0ad] pt-2">
          <span className="text-[#6d5a47] font-medium">纯文本：</span>
          {latex ? latexToText(latex) : '-'}
        </div>
      </div>

      {/* Export buttons */}
      <div className="flex flex-wrap gap-2">
        <Btn onClick={copyLatex}><Copy className="w-4 h-4 mr-1" />复制 LaTeX</Btn>
        <Btn onClick={copyPlainText} variant="secondary">复制纯文本</Btn>
        <Btn onClick={copyWordFormat} variant="secondary">复制 Word 格式</Btn>
        <Btn onClick={downloadPng} variant="secondary"><Download className="w-4 h-4 mr-1" />导出 PNG</Btn>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
        <p className="text-xs text-amber-700">
          提示：纯文本模式将 LaTeX 转换为近似数学表达式。如需高质量公式渲染，建议使用 MathJax 或 KaTeX 库。
        </p>
      </div>

      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    </div>
  );
};

export default FormulaEditor;