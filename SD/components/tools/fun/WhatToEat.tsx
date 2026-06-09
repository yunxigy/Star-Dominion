import React, { useState, useRef } from 'react';

const CATEGORIES = {
  '中餐': {
    emoji: '🍜',
    foods: ['火锅', '麻辣烫', '兰州拉面', '北京烤鸭', '宫保鸡丁', '麻婆豆腐', '回锅肉', '水煮鱼', '小龙虾', '酸菜鱼', '牛肉面', '小笼包', '煎饺', '蛋炒饭', '红烧肉', '糖醋排骨', '鱼香肉丝', '干锅花菜', '烤串', '煲仔饭'],
    tips: '中华美食博大精深，八大菜系各有特色'
  },
  '西餐': {
    emoji: '🍔',
    foods: ['汉堡', '披萨', '牛排', '意面', '沙拉', '三明治', '炸鸡', '薯条', '焗饭', '奶油蘑菇汤', '凯撒沙拉', '烤鸡翅', '热狗', '西班牙海鲜饭', '墨西哥卷饼', '培根芝士焗土豆', '意大利烩饭', '烤肋排', '芝士蛋糕', '法式蜗牛'],
    tips: '西餐注重食材原味，烹饪方式多样'
  },
  '日料': {
    emoji: '🍣',
    foods: ['寿司', '刺身', '拉面', '天妇罗', '鳗鱼饭', '咖喱饭', '乌冬面', '关东煮', '章鱼小丸子', '大阪烧', '日式烤肉', '味噌汤', '饭团', '亲子丼', '猪排饭', '日式煎饺', '抹茶甜品', '寿喜烧', '便当', '茶泡饭'],
    tips: '日料讲究新鲜和季节感，摆盘精美'
  },
  '韩料': {
    emoji: '🍖',
    foods: ['石锅拌饭', '韩式炸鸡', '部队锅', '泡菜锅', '烤五花肉', '韩式冷面', '年糕', '紫菜包饭', '韩式炸酱面', '参鸡汤', '大酱汤', '辣炒章鱼', '韩式烤牛肉', '海鲜葱饼', '芝士玉米', '辣鸡爪', '韩式拌面', '土豆汤', '牛骨汤', '韩式煎饼'],
    tips: '韩料口味偏辣，注重发酵和烤制'
  },
  '甜品': {
    emoji: '🍰',
    foods: ['奶茶', '蛋糕', '冰淇淋', '蛋挞', '马卡龙', '提拉米苏', '杨枝甘露', '双皮奶', '芋圆', '豆花', '铜锣烧', '泡芙', '甜甜圈', '华夫饼', '慕斯蛋糕', '千层蛋糕', '烧仙草', '水果捞', '布丁', '奶昔'],
    tips: '甜品是生活的调味剂，让心情更美好'
  },
  '快餐': {
    emoji: '⚡',
    foods: ['麦当劳', '肯德基', '必胜客', '汉堡王', '赛百味', '吉野家', '味千拉面', '真功夫', '永和大王', '沙县小吃', '黄焖鸡', '兰州拉面', '桂林米粉', '重庆小面', '酸辣粉', '煎饼果子', '肉夹馍', '手抓饼', '烤冷面', '鸡蛋灌饼'],
    tips: '快餐方便快捷，适合忙碌的生活节奏'
  },
  '夜宵': {
    emoji: '🌙',
    foods: ['烧烤', '小龙虾', '麻辣烫', '串串香', '炸鸡', '啤酒', '烤鱼', '干锅', '卤味', '鸭脖', '关东煮', '便利店便当', '泡面', '饺子', '馄饨', '炒粉', '炒面', '砂锅粥', '牛杂', '烤生蚝'],
    tips: '夜宵是深夜的慰藉，但要注意健康哦'
  },
} as const;

type Category = keyof typeof CATEGORIES;

const WhatToEat: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [category, setCategory] = useState<Category | '随机'>('随机');
  const [result, setResult] = useState('');
  const [spinning, setSpinning] = useState(false);
  const [display, setDisplay] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const decide = () => {
    if (spinning) return;

    const allCategories = Object.keys(CATEGORIES) as Category[];
    const foods: string[] = [];

    if (category === '随机') {
      allCategories.forEach(cat => foods.push(...CATEGORIES[cat].foods));
    } else {
      foods.push(...CATEGORIES[category].foods);
    }

    setSpinning(true);
    setResult('');
    let tick = 0;
    const totalTicks = 30;

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setDisplay(foods[Math.floor(Math.random() * foods.length)]);
      tick++;
      if (tick >= totalTicks) {
        clearInterval(timerRef.current!);
        timerRef.current = null;
        const final = foods[Math.floor(Math.random() * foods.length)];
        setResult(final);
        setHistory(prev => [final, ...prev].slice(0, 5));
        setDisplay('');
        setSpinning(false);
      }
    }, 80);
  };

  const getCategoryEmoji = () => {
    if (category === '随机') return '🎲';
    return CATEGORIES[category].emoji;
  };

  const getFoodEmoji = (food: string) => {
    const allCats = Object.keys(CATEGORIES) as Category[];
    for (const cat of allCats) {
      if ((CATEGORIES[cat].foods as readonly string[]).includes(food)) return CATEGORIES[cat].emoji;
    }
    return '🍽️';
  };

  const getCategoryTip = () => {
    if (category === '随机') return '让命运决定你的美食之旅';
    return CATEGORIES[category].tips;
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-8">
      {/* Header */}
      <div className="text-center">
        <h2 className="text-3xl font-bold text-pink-400 mb-3">今天吃什么</h2>
        <p className="text-lg text-slate-400">让美食不再成为难题</p>
      </div>

      {/* Category Selection */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-white text-center">选择美食类型</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(['随机', ...Object.keys(CATEGORIES)] as const).map(cat => (
            <button
              key={cat}
              onClick={() => setCategory(cat as Category | '随机')}
              className={`p-4 rounded-xl text-center transition-all ${
                category === cat
                  ? 'bg-pink-500/20 border-2 border-pink-500/50 text-pink-400 scale-105'
                  : 'bg-slate-800/50 border-2 border-slate-700 text-slate-400 hover:border-pink-500/30 hover:bg-pink-500/10'
              }`}
            >
              <div className="text-3xl mb-2">
                {cat === '随机' ? '🎲' : CATEGORIES[cat as Category].emoji}
              </div>
              <div className="font-medium">{cat}</div>
            </button>
          ))}
        </div>
        <p className="text-center text-sm text-slate-500">{getCategoryTip()}</p>
      </div>

      {/* Spin Button */}
      <div className="text-center">
        <button
          onClick={decide}
          disabled={spinning}
          className={`px-12 py-5 rounded-2xl text-xl font-bold transition-all ${
            spinning
              ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
              : 'bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-400 hover:to-rose-400 text-white hover:scale-105 hover:shadow-lg hover:shadow-pink-500/30'
          }`}
        >
          {spinning ? '正在选择...' : '帮我决定!'}
        </button>
      </div>

      {/* Spinning Animation */}
      {spinning && (
        <div className="text-center py-12 bg-slate-800/30 rounded-2xl border border-slate-700">
          <div className="text-6xl font-bold text-pink-400 animate-pulse mb-4">
            {getCategoryEmoji()} {display}
          </div>
          <div className="flex justify-center gap-1">
            {[0, 1, 2].map(i => (
              <div
                key={i}
                className="w-3 h-3 bg-pink-400 rounded-full animate-bounce"
                style={{ animationDelay: `${i * 0.1}s` }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Result */}
      {result && !spinning && (
        <div className="bg-gradient-to-br from-pink-500/20 to-rose-500/20 border-2 border-pink-500/30 rounded-2xl p-8 text-center">
          <div className="text-sm text-slate-400 mb-3">今天就吃</div>
          <div className="text-5xl font-bold text-pink-400 mb-4">
            {getFoodEmoji(result)} {result}
          </div>
          <div className="text-lg text-slate-300 mb-6">祝你用餐愉快!</div>
          <button
            onClick={decide}
            className="px-8 py-3 bg-pink-500/20 border border-pink-500/40 rounded-xl text-pink-400 hover:bg-pink-500/30 transition-all"
          >
            换一个
          </button>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-white">最近推荐</h3>
          <div className="flex flex-wrap gap-2">
            {history.map((food, index) => (
              <span
                key={index}
                className="px-4 py-2 bg-slate-800/50 border border-slate-700 rounded-full text-slate-400 text-sm"
              >
                {getFoodEmoji(food)} {food}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 text-center">
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
          <div className="text-2xl font-bold text-pink-400">
            {Object.values(CATEGORIES).reduce((sum, cat) => sum + cat.foods.length, 0)}
          </div>
          <div className="text-sm text-slate-400">美食选择</div>
        </div>
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
          <div className="text-2xl font-bold text-pink-400">
            {Object.keys(CATEGORIES).length}
          </div>
          <div className="text-sm text-slate-400">美食分类</div>
        </div>
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
          <div className="text-2xl font-bold text-pink-400">
            {history.length}
          </div>
          <div className="text-sm text-slate-400">已推荐</div>
        </div>
      </div>
    </div>
  );
};

export default WhatToEat;
