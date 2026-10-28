import React, { useState, useMemo } from 'react';

interface DreamSymbol {
  symbol: string;
  emoji: string;
  meaning: string;
  psychological: string;
  tags: string[];
}

const DREAM_DICTIONARY: DreamSymbol[] = [
  { symbol: '水', emoji: '💧', meaning: '水通常象征情感、潜意识和生命的流动。清水代表平静和净化，浑浊的水可能暗示情感上的困惑。', psychological: '心理学认为水是潜意识的象征，梦中的水反映了内心深处的情感状态。', tags: ['情感', '潜意识', '生命'] },
  { symbol: '火', emoji: '🔥', meaning: '火象征激情、转变和能量。梦中的火可能代表强烈的感情、创造力，或需要释放的愤怒。', psychological: '火在心理学中代表转化的力量，可能暗示内心正在经历重要的变化。', tags: ['激情', '转变', '能量'] },
  { symbol: '蛇', emoji: '🐍', meaning: '蛇是复杂的梦境象征，可能代表智慧、转变、治愈，也可能暗示隐藏的威胁或恐惧。', psychological: '弗洛伊德认为蛇与性有关，荣格则认为蛇象征潜意识的智慧和自我更新。', tags: ['智慧', '转变', '恐惧'] },
  { symbol: '飞翔', emoji: '🕊️', meaning: '飞翔的梦通常象征自由、超越和对更高境界的追求。也可能表示想要逃离现实的压力。', psychological: '飞翔梦反映了一种控制感和自由感，可能暗示对现状的超越渴望。', tags: ['自由', '超越', '逃避'] },
  { symbol: '牙齿掉落', emoji: '🦷', meaning: '牙齿掉落是最常见的梦境之一，通常象征焦虑、无力感或对外表的担忧。也可能暗示沟通困难。', psychological: '这类梦通常与自信、形象焦虑或害怕失去控制有关。', tags: ['焦虑', '自信', '变化'] },
  { symbol: '考试', emoji: '📝', meaning: '考试梦通常象征对自我评价的焦虑，或感到被测试和评判。也可能暗示对准备不足的担忧。', psychological: '这类梦反映了对表现和成就的焦虑，常见于完美主义者。', tags: ['焦虑', '评价', '压力'] },
  { symbol: '追逐', emoji: '🏃', meaning: '被追逐的梦通常象征逃避某种问题或情感。追逐者可能代表你不愿面对的事情。', psychological: '这类梦暗示存在未解决的冲突或被压抑的情感需要面对。', tags: ['逃避', '恐惧', '冲突'] },
  { symbol: '死亡', emoji: '💀', meaning: '梦中的死亡通常不预示真实死亡，而是象征结束和新的开始。可能代表某个阶段的终结或重大转变。', psychological: '死亡梦通常象征心理上的转化和更新，是成长的一部分。', tags: ['结束', '转变', '重生'] },
  { symbol: '婚礼', emoji: '💒', meaning: '婚礼梦象征结合、承诺和新的开始。不一定与实际婚姻有关，可能代表不同方面的统一。', psychological: '婚礼梦可能反映对亲密关系的渴望，或内在不同部分的整合。', tags: ['结合', '承诺', '新开始'] },
  { symbol: '怀孕', emoji: '🤰', meaning: '怀孕梦通常象征新想法、新项目或内在的成长。可能暗示创造力正在孕育中。', psychological: '怀孕梦反映了内心正在孕育新的可能性和潜能。', tags: ['创造', '成长', '潜能'] },
  { symbol: '坠落', emoji: '⬇️', meaning: '坠落的梦通常象征失控感、焦虑或对失败的恐惧。也可能代表放手和信任的过程。', psychological: '坠落梦反映了对失去控制的恐惧，或需要学会放松和信任。', tags: ['失控', '恐惧', '放手'] },
  { symbol: '迷路', emoji: '🗺️', meaning: '迷路的梦象征方向感的缺失，可能暗示在生活中感到困惑或不确定。', psychological: '这类梦反映了对人生方向的迷茫，或面临重要选择时的困惑。', tags: ['困惑', '方向', '选择'] },
  { symbol: '飞行', emoji: '✈️', meaning: '飞行梦象征自由、野心和超越限制的愿望。顺利飞行表示自信，困难飞行可能暗示障碍。', psychological: '飞行梦反映了对自由和成就的渴望，是自我超越的象征。', tags: ['自由', '野心', '超越'] },
  { symbol: '镜子', emoji: '🪞', meaning: '镜子象征自我认识和反思。梦中的镜子可能暗示需要审视真实的自己。', psychological: '镜子梦反映了自我意识和对自我形象的思考。', tags: ['自我', '反思', '真实'] },
  { symbol: '房子', emoji: '🏠', meaning: '房子通常象征自我和内心世界。不同的房间代表不同的心理层面。', psychological: '房子是自我的象征，探索房子代表探索自己的内心世界。', tags: ['自我', '内心', '安全感'] },
  { symbol: '婴儿', emoji: '👶', meaning: '婴儿象征新的开始、纯真和脆弱。可能代表新的想法、项目或自我的新部分。', psychological: '婴儿梦反映了对新开始的期待，或内心脆弱的一面需要呵护。', tags: ['新开始', '纯真', '脆弱'] },
  { symbol: '黑暗', emoji: '🌑', meaning: '黑暗象征未知、恐惧或被压抑的情感。也可能代表需要向内探索的时刻。', psychological: '黑暗梦反映了对未知的恐惧，或潜意识中需要被认识的部分。', tags: ['未知', '恐惧', '潜意识'] },
  { symbol: '阳光', emoji: '☀️', meaning: '阳光象征希望、温暖和清晰。梦中出现阳光通常预示积极的转变和觉醒。', psychological: '阳光梦反映了内心充满希望和乐观的状态。', tags: ['希望', '温暖', '觉醒'] },
  { symbol: '大海', emoji: '🌊', meaning: '大海象征广阔的潜意识和情感世界。平静的海面代表内心平和，汹涌的海浪暗示情感波动。', psychological: '大海是集体潜意识的象征，反映深层的情感状态。', tags: ['潜意识', '情感', '广阔'] },
  { symbol: '山', emoji: '⛰️', meaning: '山象征挑战、成就和精神追求。攀登高山代表克服困难，山顶代表成就和远见。', psychological: '山的梦反映了对目标的追求和克服障碍的决心。', tags: ['挑战', '成就', '追求'] },
  { symbol: '血', emoji: '🩸', meaning: '血象征生命力、情感和牺牲。梦中的血可能暗示情感伤害或生命力的流失。', psychological: '血的梦反映了深层的情感创伤或对生命力的关注。', tags: ['生命力', '情感', '伤害'] },
  { symbol: '雨', emoji: '🌧️', meaning: '雨象征情感的释放、净化和更新。细雨代表温柔的情感，暴雨暗示强烈的情绪。', psychological: '雨的梦反映了情感的流动和内心净化的需求。', tags: ['情感', '净化', '释放'] },
  { symbol: '雪', emoji: '❄️', meaning: '雪象征纯洁、冷漠或情感的冻结。融化的雪暗示情感的解冻和新的开始。', psychological: '雪的梦反映了情感的冻结状态，或对纯洁和宁静的渴望。', tags: ['纯洁', '冷漠', '冻结'] },
  { symbol: '花', emoji: '🌸', meaning: '花象征美丽、成长和短暂。盛开的花代表成功和喜悦，枯萎的花暗示失落。', psychological: '花的梦反映了对美好事物的欣赏和对生命短暂性的认识。', tags: ['美丽', '成长', '短暂'] },
  { symbol: '树', emoji: '🌳', meaning: '树象征成长、稳定和生命力。茂盛的树代表健康和繁荣，枯树暗示活力流失。', psychological: '树是自我成长的象征，反映个人发展和根基的稳固。', tags: ['成长', '稳定', '生命力'] },
  { symbol: '动物', emoji: '🐾', meaning: '梦中的动物象征本能和直觉。不同动物代表不同的特质和能量。', psychological: '动物代表我们内在的本能部分，是与潜意识连接的桥梁。', tags: ['本能', '直觉', '特质'] },
  { symbol: '食物', emoji: '🍽️', meaning: '食物象征滋养、满足和欲望。梦中的食物可能暗示身体或情感上的需求。', psychological: '食物梦反映了对滋养和满足的渴望，可能是身体或心理层面的。', tags: ['滋养', '满足', '需求'] },
  { symbol: '钥匙', emoji: '🔑', meaning: '钥匙象征答案、机会和新的可能性。找到钥匙暗示发现了问题的解决方案。', psychological: '钥匙梦反映了对解决问题的渴望和对新机会的期待。', tags: ['答案', '机会', '解决'] },
  { symbol: '门', emoji: '🚪', meaning: '门象征机会、选择和过渡。打开的门代表新机会，关闭的门暗示障碍或拒绝。', psychological: '门的梦反映了面临选择和过渡的心理状态。', tags: ['机会', '选择', '过渡'] },
  { symbol: '金钱', emoji: '💰', meaning: '金钱象征价值、安全感和自我价值。梦中的金钱可能反映对物质或精神财富的关注。', psychological: '金钱梦反映了对安全感和自我价值的深层需求。', tags: ['价值', '安全', '需求'] },
  { symbol: '钟表', emoji: '⏰', meaning: '钟表象征时间、紧迫感和生命的流逝。梦中的钟表可能暗示对时间的焦虑。', psychological: '钟表梦反映了对时间管理和生命有限性的关注。', tags: ['时间', '紧迫', '生命'] },
  { symbol: '桥', emoji: '🌉', meaning: '桥象征过渡、连接和转变。过桥代表从一个阶段过渡到另一个阶段。', psychological: '桥的梦反映了人生过渡期的心理状态和对变化的态度。', tags: ['过渡', '连接', '转变'] },
  { symbol: '云', emoji: '☁️', meaning: '云象征思维、幻想和不确定性。白云代表平静的思考，乌云暗示忧虑。', psychological: '云的梦反映了思维状态和对未来的不确定感。', tags: ['思维', '幻想', '不确定'] },
  { symbol: '星星', emoji: '⭐', meaning: '星星象征希望、指引和灵感。梦中的星星代表对未来的希望和精神上的指引。', psychological: '星星梦反映了内心对希望和意义的追寻。', tags: ['希望', '指引', '灵感'] },
  { symbol: '月亮', emoji: '🌙', meaning: '月亮象征女性能量、直觉和潜意识。满月代表完整，新月代表新的开始。', psychological: '月亮梦反映了与潜意识和女性特质的连接。', tags: ['直觉', '女性', '潜意识'] },
  { symbol: '彩虹', emoji: '🌈', meaning: '彩虹象征希望、承诺和美好。梦中出现彩虹通常预示困难后的美好转机。', psychological: '彩虹梦反映了对美好未来的期待和内心的乐观。', tags: ['希望', '美好', '转机'] },
];

const ALL_TAGS = [...new Set(DREAM_DICTIONARY.flatMap(d => d.tags))];

const DreamDictionary: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [search, setSearch] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  const filteredResults = useMemo(() => {
    let results = DREAM_DICTIONARY;
    if (selectedTag) {
      results = results.filter(d => d.tags.includes(selectedTag));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      results = results.filter(d =>
        d.symbol.includes(q) ||
        d.meaning.includes(q) ||
        d.psychological.includes(q) ||
        d.tags.some(t => t.includes(q))
      );
    }
    return results;
  }, [search, selectedTag]);

  return (
    <div className="space-y-4">
      <div className="text-center mb-2">
        <p className="text-slate-400 text-sm">探索梦境的奥秘，解读潜意识的信息</p>
      </div>

      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="搜索梦境关键词..."
        className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 focus:outline-none focus:border-blue-500/50 placeholder-slate-500"
      />

      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setSelectedTag(null)}
          className={`text-xs px-2 py-1 rounded-full transition-colors ${
            selectedTag === null
              ? 'bg-blue-500/30 text-blue-400 border border-blue-500/50'
              : 'bg-slate-800/50 text-slate-400 border border-slate-700 hover:bg-slate-700/30'
          }`}
        >
          全部
        </button>
        {ALL_TAGS.map(tag => (
          <button
            key={tag}
            onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
            className={`text-xs px-2 py-1 rounded-full transition-colors ${
              selectedTag === tag
                ? 'bg-blue-500/30 text-blue-400 border border-blue-500/50'
                : 'bg-slate-800/50 text-slate-400 border border-slate-700 hover:bg-slate-700/30'
            }`}
          >
            {tag}
          </button>
        ))}
      </div>

      <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
        {filteredResults.map(item => (
          <div key={item.symbol} className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl">{item.emoji}</span>
              <h3 className="text-sm font-bold text-blue-400">{item.symbol}</h3>
            </div>
            <div className="space-y-2">
              <div>
                <p className="text-xs text-slate-500 mb-1">梦境寓意</p>
                <p className="text-sm text-slate-300 leading-relaxed">{item.meaning}</p>
              </div>
              <div>
                <p className="text-xs text-blue-400/80 mb-1">心理学解读</p>
                <p className="text-sm text-slate-400 leading-relaxed">{item.psychological}</p>
              </div>
              <div className="flex flex-wrap gap-1">
                {item.tags.map(tag => (
                  <button
                    key={tag}
                    onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                    className="text-xs px-1.5 py-0.5 bg-slate-700/50 text-slate-400 rounded hover:bg-slate-600/50 transition-colors"
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
        {filteredResults.length === 0 && (
          <p className="text-center text-slate-500 text-sm py-8">没有找到匹配的梦境符号</p>
        )}
      </div>
    </div>
  );
};

export default DreamDictionary;
