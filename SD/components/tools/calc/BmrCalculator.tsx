import React, { useState } from 'react';
import { Btn, TextInput, ResultBox } from '../shared';

const BmrCalculator: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const [age, setAge] = useState('');
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [result, setResult] = useState<{ bmr: string; description: string } | null>(null);

  const calculate = () => {
    const a = parseFloat(age);
    const h = parseFloat(height);
    const w = parseFloat(weight);
    if (!a || !h || !w || a <= 0 || h <= 0 || w <= 0) return;

    // Harris-Benedict 公式
    let bmr: number;
    if (gender === 'male') {
      bmr = 88.362 + (13.397 * w) + (4.799 * h) - (5.677 * a);
    } else {
      bmr = 447.593 + (9.247 * w) + (3.098 * h) - (4.330 * a);
    }

    const description = `每日基础代谢约 ${Math.round(bmr)} 千卡`;
    setResult({ bmr: bmr.toFixed(2), description });
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-slate-400 mb-1">性别</label>
        <div className="flex gap-2">
          <button
            onClick={() => setGender('male')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
              gender === 'male' ? 'bg-violet-600 text-white' : 'bg-slate-800/50 text-slate-400 border border-slate-700'
            }`}
          >
            男
          </button>
          <button
            onClick={() => setGender('female')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
              gender === 'female' ? 'bg-violet-600 text-white' : 'bg-slate-800/50 text-slate-400 border border-slate-700'
            }`}
          >
            女
          </button>
        </div>
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">年龄 (岁)</label>
        <TextInput value={age} onChange={setAge} placeholder="请输入年龄" type="number" />
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">身高 (cm)</label>
        <TextInput value={height} onChange={setHeight} placeholder="请输入身高" type="number" />
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">体重 (kg)</label>
        <TextInput value={weight} onChange={setWeight} placeholder="请输入体重" type="number" />
      </div>
      <Btn onClick={calculate} variant="primary">计算 BMR</Btn>
      {result && (
        <div className="space-y-2">
          <ResultBox label="基础代谢率 (BMR)" value={`${result.bmr} 千卡/天`} onCopy={() => navigator.clipboard.writeText(result.bmr)} />
          <ResultBox label="说明" value={result.description} />
        </div>
      )}
    </div>
  );
};

export default BmrCalculator;
