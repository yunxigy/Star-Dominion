import React, { useState, useRef } from 'react';
import { Btn } from '../shared';

const CATEGORIES = {
  '中餐': ['火锅', '麻辣烫', '兰州拉面', '北京烤鸭', '宫保鸡丁', '麻婆豆腐', '回锅肉', '水煮鱼', '小龙虾', '酸菜鱼', '牛肉面', '小笼包', '煎饺', '蛋炒饭', '红烧肉', '糖醋排骨', '鱼香肉丝', '干锅花菜', '烤串', '煲仔饭'],
  '西餐': ['汉堡', '披萨', '牛排', '意面', '沙拉', '三明治', '炸鸡', '薯条', '焗饭', '奶油蘑菇汤', '凯撒沙拉', '烤鸡翅', '热狗', '法式蜗牛', '西班牙海鲜饭', '墨西哥卷饼', '培根芝士焗土豆', '意大利烩饭', '烤肋排', '芝士蛋糕'],
  '日料': ['寿司', '刺身', '拉面', '天妇罗', '鳗鱼饭', '咖喱饭', '乌冬面', '关东煮', '章鱼小丸子', '大阪烧', '日式烤肉', '味噌汤', '饭团', '亲子丼', '猪排饭', '日式煎饺', '抹茶甜品', '寿喜烧', '便当', '茶泡饭'],
  '韩料': ['石锅拌饭', '韩式炸鸡', '部队锅', '泡菜锅', '烤五花肉', '韩式冷面', '年糕', '紫菜包饭', '韩式炸酱面', '参鸡汤', '大酱汤', '辣炒章鱼', '韩式烤牛肉', '海鲜葱饼', '芝士玉米', '辣鸡爪', '韩式拌面', '土豆汤', '牛骨汤', '韩式煎饼'],
  '甜品': ['奶茶', '蛋糕', '冰淇淋', '蛋挞', '马卡龙', '提拉米苏', '杨枝甘露', '双皮奶', '芋圆', '豆花', '铜锣烧', '泡芙', '甜甜圈', '华夫饼', '慕斯蛋糕', '千层蛋糕', '烧仙草', '水果捞', '布丁', '奶昔'],
} as const;

type Category = keyof typeof CATEGORIES;

const EMOJIS: Record<Category, string> = {
  '中餐': '🍜',
  '西餐': '🍔',
  '日料': '🍣',
  '韩料': '🍖',
  '甜品': '🍰',
};

const WhatToEat: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [category, setCategory] = useState<Category | '随机'>('随机');
  const [result, setResult] = useState('');
  const [spinning, setSpinning] = useState(false);
  const [display, setDisplay] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const decide = () => {
    if (spinning) return;

    const allCategories = Object.keys(CATEGORIES) as Category[];
    const foods: string[] = [];

    if (category === '随机') {
      allCategories.forEach(cat => foods.push(...CATEGORIES[cat]));
    } else {
      foods.push(...CATEGORIES[category]);
    }

    setSpinning(true);
    setResult('');
    let tick = 0;
    const totalTicks = 25;

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setDisplay(foods[Math.floor(Math.random() * foods.length)]);
      tick++;
      if (tick >= totalTicks) {
        clearInterval(timerRef.current!);
        timerRef.current = null;
        const final = foods[Math.floor(Math.random() * foods.length)];
        setResult(final);
        setDisplay('');
        setSpinning(false);
      }
    }, 80);
  };

  const getCategoryEmoji = () => {
    if (category === '随机') return '🎲';
    return EMOJIS[category];
  };

  const getFoodEmoji = () => {
    if (category !== '随机') return EMOJIS[category];
    const allCats = Object.keys(EMOJIS) as Category[];
    for (const cat of allCats) {
      if ((CATEGORIES[cat] as readonly string[]).includes(result)) return EMOJIS[cat];
    }
    return '🍽️';
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        {(['随机', ...Object.keys(CATEGORIES)] as const).map(cat => (
          <button
            key={cat}
            onClick={() => setCategory(cat as Category | '随机')}
            className={`px-3 py-1.5 rounded-lg text-sm transition-all ${
              category === cat
                ? 'bg-pink-400/20 border border-pink-400/40 text-pink-400'
                : 'bg-slate-800/50 border border-slate-700 text-slate-400 hover:border-slate-600'
            }`}
          >
            {cat === '随机' ? '🎲 随机' : `${EMOJIS[cat as Category]} ${cat}`}
          </button>
        ))}
      </div>

      <Btn onClick={decide} disabled={spinning}>
        {spinning ? '正在选择...' : '帮我决定!'}
      </Btn>

      {spinning && (
        <div className="text-center py-8">
          <div className="text-4xl font-bold text-pink-400 animate-pulse">{getCategoryEmoji()} {display}</div>
        </div>
      )}

      {result && !spinning && (
        <div className="text-center py-6 bg-pink-400/5 border border-pink-400/20 rounded-xl">
          <div className="text-sm text-slate-400 mb-2">今天就吃</div>
          <div className="text-4xl font-bold text-pink-400 mb-2">{getFoodEmoji()} {result}</div>
          <div className="text-xs text-slate-500">祝你用餐愉快!</div>
        </div>
      )}
    </div>
  );
};

export default WhatToEat;
