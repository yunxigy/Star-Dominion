import React, { useState } from 'react';
import { TextInput, Btn, copyToClipboard } from '../shared';

const STYLES = ['可爱风', '搞笑风', '文艺风', '霸气风', '古风'] as const;
type StyleType = typeof STYLES[number];

const WORDS: Record<StyleType, string[][]> = {
  '可爱风': [
    ['小', '软', '甜', '萌', '乖乖', '奶', '嘟嘟', '蜜糖', '棉花糖', '泡泡'],
    ['兔兔', '猫咪', '熊熊', '团子', '丸子', '果冻', '奶茶', '布丁', '糖糖', '宝贝'],
    ['酱', '呀', '呢', '哒', '喵', '哦', '嘻嘻', '~', '', ''],
  ],
  '搞笑风': [
    ['一只', '专业的', '资深', '无敌', '传说中的', '退休的', '半成品', '野生的', '官方认证', '铁憨憨'],
    ['咸鱼', '干饭人', '打工人', '秃头', '社畜', '摸鱼', '躺平', '摆烂', '卷王', '吃瓜群众'],
    ['', '大师', '选手', '选手', '侠', '怪', '侠客', '王者', '传说', '之王'],
  ],
  '文艺风': [
    ['清风', '月色', '烟雨', '落花', '流年', '浅夏', '墨染', '长安', '浮生', '半夏'],
    ['听雪', '入梦', '微凉', '如初', '未央', '无恙', '归期', '知秋', '拾光', '若水'],
    ['', '者', '人', '客', '君', '生', '', '', '', ''],
  ],
  '霸气风': [
    ['逆天', '至尊', '无敌', '霸绝', '狂战', '傲世', '绝世', '万古', '永恒', '不败'],
    ['战神', '龙王', '天帝', '魔尊', '剑圣', '帝王', '霸王', '主宰', '苍穹', '九天'],
    ['', '归来', '再临', '崛起', '降世', '无双', '称霸', '封神', '踏天', '焚天'],
  ],
  '古风': [
    ['云中', '长安', '江南', '青衫', '白衣', '烟波', '竹杖', '孤舟', '月下', '山间'],
    ['客', '公子', '侠', '仙', '隐者', '居士', '散人', '道人', '书生', '剑客'],
    ['', '归', '行', '吟', '赋', '记', '歌', '曲', '引', '辞'],
  ],
};

const RandomNickname: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [style, setStyle] = useState<StyleType>('可爱风');
  const [count, setCount] = useState('5');
  const [results, setResults] = useState<string[]>([]);

  const generate = () => {
    const n = Math.min(Math.max(Number(count) || 1, 1), 20);
    const words = WORDS[style];
    const nicknames: string[] = [];
    for (let i = 0; i < n; i++) {
      const parts = words.map(group => group[Math.floor(Math.random() * group.length)]);
      nicknames.push(parts.join(''));
    }
    setResults(nicknames);
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        {STYLES.map(s => (
          <button
            key={s}
            onClick={() => setStyle(s)}
            className={`px-3 py-1.5 rounded-lg text-sm transition-all ${
              style === s
                ? 'bg-pink-400/20 border border-pink-400/40 text-pink-400'
                : 'bg-slate-800/50 border border-slate-700 text-slate-400 hover:border-slate-600'
            }`}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="flex gap-2 items-center">
        <TextInput value={count} onChange={setCount} placeholder="数量" type="number" className="w-20" />
        <Btn onClick={generate}>生成</Btn>
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
      {results.length > 0 && (
        <div className="space-y-1">
          {results.map((name, i) => (
            <div key={i} className="flex items-center gap-2 bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2">
              <span className="text-sm text-pink-400 flex-1 font-medium">{name}</span>
              <button onClick={() => copyToClipboard(name)} className="text-xs text-pink-400 hover:text-pink-300 shrink-0">复制</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default RandomNickname;
