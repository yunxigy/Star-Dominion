import React, { useState } from 'react';
import { Btn, TextInput, ResultBox } from '../shared';

const BmiCalculator: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [result, setResult] = useState<{ bmi: string; category: string } | null>(null);

  const calculate = () => {
    const h = parseFloat(height);
    const w = parseFloat(weight);
    if (!h || !w || h <= 0 || w <= 0) return;

    const bmi = w / ((h / 100) ** 2);
    let category = '';
    if (bmi < 18.5) category = '偏瘦';
    else if (bmi < 24) category = '正常';
    else if (bmi < 28) category = '偏胖';
    else category = '肥胖';

    setResult({ bmi: bmi.toFixed(2), category });
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-slate-400 mb-1">身高 (cm)</label>
        <TextInput value={height} onChange={setHeight} placeholder="请输入身高" type="number" />
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">体重 (kg)</label>
        <TextInput value={weight} onChange={setWeight} placeholder="请输入体重" type="number" />
      </div>
      <Btn onClick={calculate} variant="primary">计算 BMI</Btn>
      {result && (
        <div className="space-y-2">
          <ResultBox label="BMI 值" value={result.bmi} onCopy={() => navigator.clipboard.writeText(result.bmi)} />
          <ResultBox label="分类" value={result.category} />
        </div>
      )}
    </div>
  );
};

export default BmiCalculator;
