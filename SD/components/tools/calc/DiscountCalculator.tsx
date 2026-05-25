import React, { useState } from 'react';
import { Btn, TextInput, ResultBox } from '../shared';

const DiscountCalculator: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [originalPrice, setOriginalPrice] = useState('');
  const [discount, setDiscount] = useState('');
  const [result, setResult] = useState<{ finalPrice: string; saved: string; discountRate: string } | null>(null);

  const calculate = () => {
    const price = parseFloat(originalPrice);
    const disc = parseFloat(discount);
    if (!price || price <= 0 || isNaN(disc) || disc < 0 || disc > 100) return;

    const finalPrice = price * (disc / 100);
    const saved = price - finalPrice;
    const discountRate = (100 - disc).toFixed(0);

    setResult({
      finalPrice: finalPrice.toFixed(2),
      saved: saved.toFixed(2),
      discountRate: `${discountRate}%`,
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-slate-400 mb-1">原价 (元)</label>
        <TextInput value={originalPrice} onChange={setOriginalPrice} placeholder="请输入原价" type="number" />
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">折扣 (%)</label>
        <TextInput value={discount} onChange={setDiscount} placeholder="例如: 80 表示八折" type="number" />
      </div>
      <Btn onClick={calculate} variant="primary">计算折后价</Btn>
      {result && (
        <div className="space-y-2">
          <ResultBox label="折后价" value={`${result.finalPrice} 元`} onCopy={() => navigator.clipboard.writeText(result.finalPrice)} />
          <ResultBox label="节省金额" value={`${result.saved} 元`} />
          <ResultBox label="折扣率" value={result.discountRate} />
        </div>
      )}
    </div>
  );
};

export default DiscountCalculator;
