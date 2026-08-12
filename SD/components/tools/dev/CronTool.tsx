import React, { useState, useMemo } from 'react';
import { Btn, copyToClipboard } from '../shared';
import { Clock, Copy, CheckCircle, AlertCircle } from 'lucide-react';

interface CronField {
  value: string;
  label: string;
  min: number;
  max: number;
  description: string;
}

const FIELDS: CronField[] = [
  { value: 'minute', label: '分钟', min: 0, max: 59, description: '0-59' },
  { value: 'hour', label: '小时', min: 0, max: 23, description: '0-23' },
  { value: 'dayOfMonth', label: '日', min: 1, max: 31, description: '1-31' },
  { value: 'month', label: '月', min: 1, max: 12, description: '1-12' },
  { value: 'dayOfWeek', label: '周', min: 0, max: 7, description: '0-7 (0和7均为周日)' },
];

const MONTH_NAMES = ['', '一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

const PRESETS = [
  { label: '每分钟', cron: '* * * * *' },
  { label: '每小时', cron: '0 * * * *' },
  { label: '每天零点', cron: '0 0 * * *' },
  { label: '每天8点', cron: '0 8 * * *' },
  { label: '每周一零点', cron: '0 0 * * 1' },
  { label: '每月1号零点', cron: '0 0 1 * *' },
  { label: '工作日9点', cron: '0 9 * * 1-5' },
  { label: '每5分钟', cron: '*/5 * * * *' },
  { label: '每15分钟', cron: '*/15 * * * *' },
  { label: '每30分钟', cron: '*/30 * * * *' },
  { label: '每2小时', cron: '0 */2 * * *' },
  { label: '每6小时', cron: '0 */6 * * *' },
  { label: '每季度初', cron: '0 0 1 1,4,7,10 *' },
  { label: '每年1月1日', cron: '0 0 1 1 *' },
];

const parseCronField = (field: string, min: number, max: number): string[] => {
  if (field === '*') {
    const result: string[] = [];
    for (let i = min; i <= max; i++) result.push(String(i));
    return result;
  }

  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2));
    if (isNaN(step) || step <= 0) return [];
    const result: string[] = [];
    for (let i = min; i <= max; i += step) result.push(String(i));
    return result;
  }

  const result = new Set<string>();
  for (const part of field.split(',')) {
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-');
      const start = parseInt(startStr);
      const end = parseInt(endStr);
      if (!isNaN(start) && !isNaN(end)) {
        for (let i = start; i <= end; i++) result.add(String(i));
      }
    } else if (part.startsWith('*/')) {
      const step = parseInt(part.slice(2));
      const base = min;
      for (let i = base; i <= max; i += step) result.add(String(i));
    } else {
      const num = parseInt(part);
      if (!isNaN(num)) result.add(String(num));
    }
  }

  return Array.from(result).sort((a, b) => parseInt(a) - parseInt(b));
};

const describeCronField = (field: string, cronField: CronField): string => {
  if (field === '*') return `每${cronField.label}`;

  if (field.startsWith('*/')) {
    const step = field.slice(2);
    return `每${step}${cronField.label}`;
  }

  if (field.includes(',')) {
    const parts = field.split(',');
    if (cronField.value === 'month') return parts.map(p => MONTH_NAMES[parseInt(p)] || p).join('、');
    if (cronField.value === 'dayOfWeek') return parts.map(p => DAY_NAMES[parseInt(p)] || p).join('、');
    return parts.join('、');
  }

  if (field.includes('-')) {
    const [start, end] = field.split('-');
    if (cronField.value === 'month') return `${MONTH_NAMES[parseInt(start)]}到${MONTH_NAMES[parseInt(end)]}`;
    if (cronField.value === 'dayOfWeek') return `${DAY_NAMES[parseInt(start)]}到${DAY_NAMES[parseInt(end)]}`;
    return `${start}到${end}`;
  }

  if (cronField.value === 'month') return MONTH_NAMES[parseInt(field)] || field;
  if (cronField.value === 'dayOfWeek') return DAY_NAMES[parseInt(field)] || field;
  return field;
};

const getNextRuns = (cronParts: string[], count: number): Date[] => {
  const results: Date[] = [];
  const now = new Date();
  now.setSeconds(0, 0);
  let current = new Date(now.getTime() + 60000); // Start from next minute

  const maxIterations = 366 * 24 * 60; // Max 1 year of minutes
  let iterations = 0;

  while (results.length < count && iterations < maxIterations) {
    iterations++;
    const [minute, hour, dayOfMonth, month, dayOfWeek] = cronParts;

    const matchMinute = parseCronField(minute, 0, 59).includes(String(current.getMinutes()));
    const matchHour = parseCronField(hour, 0, 23).includes(String(current.getHours()));
    const matchDayOfMonth = parseCronField(dayOfMonth, 1, 31).includes(String(current.getDate()));
    const matchMonth = parseCronField(month, 1, 12).includes(String(current.getMonth() + 1));

    let matchDayOfWeek = true;
    if (dayOfWeek !== '*') {
      const dow = current.getDay();
      const dowValues = parseCronField(dayOfWeek, 0, 7);
      matchDayOfWeek = dowValues.includes(String(dow)) || (dow === 0 && dowValues.includes('7'));
    }

    if (matchMinute && matchHour && matchDayOfMonth && matchMonth && matchDayOfWeek) {
      results.push(new Date(current.getTime()));
    }

    current = new Date(current.getTime() + 60000);
  }

  return results;
};

const validateCron = (expression: string): { valid: boolean; error?: string } => {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return { valid: false, error: `Cron表达式需要5个字段，当前有${parts.length}个` };

  const ranges = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
  const fieldNames = ['分钟', '小时', '日', '月', '周'];

  for (let i = 0; i < 5; i++) {
    const part = parts[i];
    const [min, max] = ranges[i];

    if (part === '*') continue;

    // Check each sub-expression
    for (const sub of part.split(',')) {
      if (sub.startsWith('*/')) {
        const step = parseInt(sub.slice(2));
        if (isNaN(step) || step <= 0) return { valid: false, error: `${fieldNames[i]}字段: 步长必须是正整数` };
        continue;
      }

      if (sub.includes('-')) {
        const [start, end] = sub.split('-').map(Number);
        if (isNaN(start) || isNaN(end)) return { valid: false, error: `${fieldNames[i]}字段: 范围格式无效` };
        if (start < min || end > max || start > end) return { valid: false, error: `${fieldNames[i]}字段: 范围${start}-${end}超出允许范围${min}-${max}` };
        continue;
      }

      const num = parseInt(sub);
      if (isNaN(num)) return { valid: false, error: `${fieldNames[i]}字段: "${sub}"不是有效值` };
      if (num < min || num > max) return { valid: false, error: `${fieldNames[i]}字段: ${num}超出允许范围${min}-${max}` };
    }
  }

  return { valid: true };
};

const CronTool: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [expression, setExpression] = useState('0 9 * * 1-5');
  const [copied, setCopied] = useState(false);

  const validation = useMemo(() => validateCron(expression), [expression]);
  const cronParts = expression.trim().split(/\s+/);

  const description = useMemo(() => {
    if (!validation.valid || cronParts.length !== 5) return '';
    return FIELDS.map((field, i) => describeCronField(cronParts[i], field)).join('，');
  }, [expression, validation.valid]);

  const nextRuns = useMemo(() => {
    if (!validation.valid || cronParts.length !== 5) return [];
    return getNextRuns(cronParts, 10);
  }, [expression, validation.valid]);

  const handleCopy = async () => {
    await copyToClipboard(expression);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b735c]">Cron 表达式生成、解析和可视化，支持预览下次执行时间</p>

      {/* Expression input */}
      <div>
        <label className="text-xs text-[#8b735c] mb-1 block">Cron 表达式</label>
        <div className="flex gap-2">
          <input value={expression} onChange={e => setExpression(e.target.value)}
            className="flex-1 text-sm font-mono border border-[#ead0ad] rounded-lg px-3 py-2 bg-white focus:border-[#7a421b] focus:outline-none"
            placeholder="* * * * *" />
          <button onClick={handleCopy} className="px-3 py-2 border border-[#ead0ad] rounded-lg hover:bg-[#f1dcc2] transition-colors">
            {copied ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-[#7a421b]" />}
          </button>
        </div>
        <div className="flex items-center gap-4 mt-1 text-[10px] text-[#c79f72]">
          <span>├ 分钟 (0-59)</span><span>├ 小时 (0-23)</span><span>├ 日 (1-31)</span><span>├ 月 (1-12)</span><span>└ 周 (0-7)</span>
        </div>
      </div>

      {/* Validation */}
      {expression.trim() && (
        <div className={`flex items-center gap-2 text-xs rounded-lg p-2 ${validation.valid ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
          {validation.valid ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          <span>{validation.valid ? '表达式有效' : validation.error}</span>
        </div>
      )}

      {/* Human readable description */}
      {description && (
        <div className="bg-[#fff4e6] border border-[#ead0ad] rounded-lg p-3">
          <h4 className="text-xs font-medium text-[#6f3714] mb-1">中文描述</h4>
          <p className="text-sm text-[#6d5a47]">{description}</p>
        </div>
      )}

      {/* Field breakdown */}
      {validation.valid && cronParts.length === 5 && (
        <div className="space-y-1">
          <h4 className="text-xs font-medium text-[#6d5a47]">字段解析</h4>
          {FIELDS.map((field, i) => (
            <div key={field.value} className="flex items-center gap-2 text-xs bg-white border border-[#ead0ad] rounded p-2">
              <span className="font-mono font-bold text-[#7a421b] min-w-[60px]">{cronParts[i]}</span>
              <span className="text-[#8b735c]">{field.label}</span>
              <span className="text-[#c79f72]">({field.description})</span>
              <span className="ml-auto text-[#6d5a47]">{describeCronField(cronParts[i], field)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Next runs */}
      {nextRuns.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-[#6d5a47] mb-1">下次执行时间（最近10次）</h4>
          <div className="space-y-0.5 max-h-40 overflow-y-auto">
            {nextRuns.map((date, i) => (
              <div key={i} className="text-xs font-mono text-[#6d5a47] bg-white border border-[#ead0ad] rounded px-2 py-1 flex items-center gap-2">
                <Clock className="w-3 h-3 text-[#c79f72]" />
                <span>{date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' })}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Presets */}
      <div>
        <h4 className="text-xs font-medium text-[#6d5a47] mb-1">常用预设</h4>
        <div className="grid grid-cols-2 gap-1">
          {PRESETS.map(preset => (
            <button key={preset.cron} onClick={() => setExpression(preset.cron)}
              className={`text-left px-2 py-1.5 rounded border text-xs transition-colors ${expression === preset.cron ? 'bg-[#7a421b] text-white border-[#7a421b]' : 'bg-white text-[#6d5a47] border-[#ead0ad] hover:border-[#c79f72]'}`}>
              <span className="font-mono">{preset.cron}</span>
              <span className="ml-1 text-[10px] opacity-70">{preset.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Quick builder */}
      <div className="bg-[#fff4e6] border border-[#ead0ad] rounded-lg p-3">
        <h4 className="text-xs font-medium text-[#6f3714] mb-2">快速构建</h4>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-[#8b735c]">分钟</label>
            <select onChange={e => { const parts = cronParts.length === 5 ? [...cronParts] : ['0','9','*','*','1-5']; parts[0] = e.target.value; setExpression(parts.join(' ')); }}
              className="w-full text-xs border border-[#ead0ad] rounded px-2 py-1 bg-white" value={cronParts[0] || '0'}>
              <option value="0">0 (整点)</option>
              <option value="*/5">*/5 (每5分钟)</option>
              <option value="*/15">*/15 (每15分钟)</option>
              <option value="*/30">*/30 (每30分钟)</option>
              <option value="*">* (每分钟)</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-[#8b735c]">小时</label>
            <select onChange={e => { const parts = cronParts.length === 5 ? [...cronParts] : ['0','9','*','*','1-5']; parts[1] = e.target.value; setExpression(parts.join(' ')); }}
              className="w-full text-xs border border-[#ead0ad] rounded px-2 py-1 bg-white" value={cronParts[1] || '9'}>
              <option value="0">0 (午夜)</option>
              <option value="6">6 (早晨)</option>
              <option value="9">9 (上午)</option>
              <option value="12">12 (中午)</option>
              <option value="18">18 (傍晚)</option>
              <option value="*">* (每小时)</option>
              <option value="*/2">*/2 (每2小时)</option>
              <option value="*/6">*/6 (每6小时)</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-[#8b735c]">日</label>
            <select onChange={e => { const parts = cronParts.length === 5 ? [...cronParts] : ['0','9','*','*','1-5']; parts[2] = e.target.value; setExpression(parts.join(' ')); }}
              className="w-full text-xs border border-[#ead0ad] rounded px-2 py-1 bg-white" value={cronParts[2] || '*'}>
              <option value="*">* (每天)</option>
              <option value="1">1 (每月1号)</option>
              <option value="15">15 (每月15号)</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-[#8b735c]">周</label>
            <select onChange={e => { const parts = cronParts.length === 5 ? [...cronParts] : ['0','9','*','*','1-5']; parts[4] = e.target.value; setExpression(parts.join(' ')); }}
              className="w-full text-xs border border-[#ead0ad] rounded px-2 py-1 bg-white" value={cronParts[4] || '1-5'}>
              <option value="*">* (每天)</option>
              <option value="1-5">1-5 (工作日)</option>
              <option value="0">0 (周日)</option>
              <option value="1">1 (周一)</option>
              <option value="6">6 (周六)</option>
            </select>
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    </div>
  );
};

export default CronTool;