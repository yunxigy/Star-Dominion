import React, { useState } from 'react';

// Common Chinese character stroke counts (deduplicated)
const STROKE_MAP: Record<string, number> = {
  '一': 1, '二': 2, '三': 3, '四': 5, '五': 4, '六': 4, '七': 2, '八': 2, '九': 2, '十': 2,
  '百': 6, '千': 3, '万': 3, '大': 3, '小': 3, '中': 4, '上': 3, '下': 3, '左': 5, '右': 5,
  '人': 2, '天': 4, '地': 6, '日': 4, '月': 4, '水': 4, '火': 4, '木': 4, '金': 8, '土': 3,
  '山': 3, '石': 5, '风': 4, '云': 4, '雨': 8, '雪': 11, '花': 7, '草': 9, '树': 16, '林': 8,
  '心': 4, '手': 4, '口': 3, '目': 5, '耳': 6, '头': 5, '足': 7, '牙': 4, '龙': 5, '凤': 4,
  '马': 3, '牛': 4, '羊': 6, '鱼': 8, '鸟': 5, '虫': 6, '犬': 4, '王': 4, '玉': 5, '宝': 8,
  '春': 9, '夏': 10, '秋': 9, '冬': 5, '东': 5, '西': 6, '南': 9, '北': 5, '明': 8, '星': 9,
  '光': 6, '亮': 9, '红': 6, '黄': 11, '蓝': 13, '绿': 11, '白': 5, '黑': 12, '紫': 12, '青': 8,
  '虎': 8, '鹤': 15, '梅': 11, '兰': 5, '竹': 6, '菊': 11, '松': 8, '柏': 9,
  '德': 15, '仁': 4, '义': 3, '礼': 5, '智': 12, '信': 9, '忠': 8, '孝': 7, '勇': 9, '善': 12,
  '美': 9, '真': 10, '爱': 10, '和': 8, '平': 5, '安': 6, '福': 13, '禄': 12, '寿': 7, '喜': 12,
  '文': 4, '武': 8, '才': 3, '学': 8, '书': 4, '画': 8, '诗': 8, '词': 7, '歌': 14, '舞': 14,
  '家': 10, '国': 8, '民': 5, '生': 5, '死': 6, '老': 6, '少': 4, '男': 7, '女': 3, '子': 3,
  '父': 4, '母': 5, '兄': 5, '弟': 7, '姐': 8, '妹': 8, '夫': 4, '妻': 8, '友': 4, '师': 6,
  '雷': 13, '电': 5, '影': 15,
  '梦': 11, '幻': 4, '灵': 7, '魂': 13, '神': 9, '仙': 5, '佛': 7, '道': 12, '法': 8, '术': 5,
  '龟': 7, '鹏': 13, '鹰': 18, '燕': 16, '雁': 12, '鸽': 11,
  '浩': 10, '宇': 6, '辰': 7, '泽': 8, '涵': 11, '瑞': 13, '睿': 14, '博': 12,
  '雅': 12, '静': 14, '婷': 12, '娟': 10, '秀': 7, '英': 8, '华': 6, '荣': 9, '贵': 9, '富': 12,
  '强': 12, '刚': 6, '坚': 7, '志': 7, '成': 6, '达': 6, '建': 8, '立': 5, '新': 13, '旧': 5,
  '长': 4, '短': 12, '高': 10, '低': 7, '远': 13, '近': 7, '深': 11, '浅': 8, '清': 11, '浊': 11,
  '阳': 6, '阴': 6, '正': 5, '邪': 6, '恶': 10, '好': 6, '坏': 7, '是': 9, '非': 8,
  '有': 6, '无': 4, '来': 7, '去': 5, '出': 5, '入': 2, '开': 4, '关': 6, '起': 10, '止': 4,
  '绝': 9, '代': 5, '双': 4, '世': 5, '之': 3, '不': 4, '凡': 3, '惊': 11, '艳': 10, '倾': 10, '城': 9,
  '色': 6, '香': 9, '闭': 6, '羞': 10, '沉': 7, '落': 12, '冰': 6, '洁': 9, '蕙': 15, '质': 8,
  '外': 5, '慧': 15, '贤': 8, '淑': 11, '端': 14, '庄': 6, '温': 12, '柔': 9,
  '婉': 11, '约': 6, '婀': 10, '娜': 9, '翩': 15, '跹': 13, '楚': 13, '动': 6,
};

function getStrokeCount(char: string): number {
  return STROKE_MAP[char] || Math.abs(char.charCodeAt(0) % 15) + 2;
}

function hashScore(name: string, seed: number): number {
  let hash = seed;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

interface ScoreResult {
  total: number;
  tian: number;
  di: number;
  ren: number;
  wai: number;
  zong: number;
}

const NameScore: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [name, setName] = useState('');
  const [result, setResult] = useState<ScoreResult | null>(null);

  const calculate = () => {
    if (!name.trim()) return;

    const chars = name.trim().split('');
    const strokes = chars.map(c => getStrokeCount(c));

    const tian = (strokes[0] || 1) + 1;
    const di = strokes.reduce((a, b) => a + b, 0) % 10 + (strokes.length > 1 ? strokes[strokes.length - 1] : 0);
    const ren = strokes.length >= 2 ? strokes[0] + strokes[1] : strokes[0] * 2;
    const wai = strokes.length >= 3 ? strokes[strokes.length - 1] + 1 : ren;
    const zong = strokes.reduce((a, b) => a + b, 0);

    const hash = hashScore(name, 42);
    const base = 60 + (hash % 35);

    const tianScore = ((tian * 7 + hash) % 40) + 60;
    const diScore = ((di * 11 + hash) % 40) + 60;
    const renScore = ((ren * 13 + hash) % 40) + 60;
    const waiScore = ((wai * 9 + hash) % 40) + 60;
    const zongScore = ((zong * 5 + hash) % 40) + 60;
    const total = Math.round((tianScore + diScore + renScore + waiScore + zongScore) / 5);

    setResult({
      total: Math.min(100, total),
      tian: Math.min(100, tianScore),
      di: Math.min(100, diScore),
      ren: Math.min(100, renScore),
      wai: Math.min(100, waiScore),
      zong: Math.min(100, zongScore),
    });
  };

  const getScoreColor = (score: number) => {
    if (score >= 90) return 'text-green-400';
    if (score >= 80) return 'text-blue-400';
    if (score >= 70) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getInterpretation = (score: number) => {
    if (score >= 90) return '极佳！这个名字蕴含着强大的正面能量。';
    if (score >= 80) return '很好！这是一个寓意美好的名字。';
    if (score >= 70) return '不错，名字整体能量平稳和谐。';
    return '尚可，名字有其独特的能量和意义。';
  };

  return (
    <div className="space-y-4">
      <div className="text-center mb-2">
        <p className="text-slate-400 text-sm">输入中文姓名，探索名字的奥秘</p>
      </div>

      <div className="space-y-3">
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="输入中文姓名..."
          className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 focus:outline-none focus:border-blue-500/50 placeholder-slate-500"
        />
        <button
          onClick={calculate}
          disabled={!name.trim()}
          className="w-full px-6 py-3 bg-blue-500/20 border border-blue-500/30 text-blue-400 rounded-lg hover:bg-blue-500/30 transition-all text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          ✨ 开始打分
        </button>
      </div>

      {result && (
        <div className="space-y-3">
          <div className="bg-slate-800/50 border border-blue-500/30 rounded-lg p-4 text-center">
            <p className="text-xs text-slate-500 mb-1">总分</p>
            <div className={`text-5xl font-bold ${getScoreColor(result.total)}`}>{result.total}</div>
            <p className="text-sm text-slate-300 mt-2">{getInterpretation(result.total)}</p>
          </div>

          {[
            { label: '天格', score: result.tian, desc: '代表先天运势和家族影响' },
            { label: '地格', score: result.di, desc: '代表前半生运势和基础运' },
            { label: '人格', score: result.ren, desc: '代表主运和性格特征' },
            { label: '外格', score: result.wai, desc: '代表社交和外在表现' },
            { label: '总格', score: result.zong, desc: '代表整体运势和人生走向' },
          ].map(item => (
            <div key={item.label} className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-slate-300">{item.label}</span>
                <span className={`text-sm font-bold ${getScoreColor(item.score)}`}>{item.score}分</span>
              </div>
              <p className="text-xs text-slate-500 mb-2">{item.desc}</p>
              <div className="w-full bg-slate-700 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all duration-500 ${
                    item.score >= 90 ? 'bg-green-500' : item.score >= 80 ? 'bg-blue-500' : item.score >= 70 ? 'bg-yellow-500' : 'bg-red-500'
                  }`}
                  style={{ width: `${item.score}%` }}
                />
              </div>
            </div>
          ))}

          <p className="text-xs text-slate-500 text-center italic">
            * 此打分仅供娱乐参考，名字的美好在于赋予它意义的人
          </p>
        </div>
      )}
    </div>
  );
};

export default NameScore;
