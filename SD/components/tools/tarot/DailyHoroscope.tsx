import React, { useState, useMemo } from 'react';

const ZODIAC_SIGNS = [
  { name: '白羊座', symbol: '♈', dates: '3.21-4.19' },
  { name: '金牛座', symbol: '♉', dates: '4.20-5.20' },
  { name: '双子座', symbol: '♊', dates: '5.21-6.21' },
  { name: '巨蟹座', symbol: '♋', dates: '6.22-7.22' },
  { name: '狮子座', symbol: '♌', dates: '7.23-8.22' },
  { name: '处女座', symbol: '♍', dates: '8.23-9.22' },
  { name: '天秤座', symbol: '♎', dates: '9.23-10.23' },
  { name: '天蝎座', symbol: '♏', dates: '10.24-11.22' },
  { name: '射手座', symbol: '♐', dates: '11.23-12.21' },
  { name: '摩羯座', symbol: '♑', dates: '12.22-1.19' },
  { name: '水瓶座', symbol: '♒', dates: '1.20-2.18' },
  { name: '双鱼座', symbol: '♓', dates: '2.19-3.20' },
];

const FORTUNE_TEXTS: Record<string, string[]> = {
  '综合运势': [
    '今天整体运势不错，适合处理重要事务。', '今天可能会遇到一些小挑战，但都能顺利解决。',
    '今天适合放松身心，享受生活的美好。', '今天需要保持警惕，避免冲动决定。',
    '今天充满机遇，把握好每一个瞬间。', '今天适合社交和拓展人脉。',
    '今天需要独处思考，整理内心的想法。', '今天可能会收到好消息，保持乐观。',
    '今天适合学习新知识，提升自己。', '今天需要注意休息，不要过度劳累。',
    '今天适合制定计划，为未来做准备。', '今天可能会有意外收获，保持开放心态。',
    '今天需要耐心处理人际关系。', '今天适合运动和户外活动。',
    '今天可能会面临选择，相信自己的直觉。', '今天适合创意工作，灵感涌现。',
    '今天需要关注细节，避免疏忽。', '今天适合与家人相处，享受温馨时光。',
    '今天可能会有财务上的好消息。', '今天需要保持冷静，理性分析问题。',
    '今天适合解决遗留问题，会有突破。', '今天可能会遇到贵人相助。',
    '今天需要调整心态，积极面对挑战。', '今天适合反思和总结经验。',
    '今天充满创造力，适合艺术创作。', '今天需要注意沟通方式，避免误会。',
    '今天适合投资理财，会有好回报。', '今天可能会有意外惊喜。',
    '今天需要坚持自己的立场，不要轻易妥协。', '今天适合旅行或探索新地方。',
  ],
  '爱情': [
    '爱情运势上升，可能会有浪漫的邂逅。', '感情中需要更多的沟通和理解。',
    '单身者可能会遇到心仪的对象。', '有伴者适合安排约会，增进感情。',
    '爱情中需要给对方更多空间。', '可能会收到意外的表白或示好。',
    '感情中需要坦诚面对自己的感受。', '适合表达爱意，说出心里话。',
    '爱情中可能会有小摩擦，但很快化解。', '单身者桃花运旺盛，把握机会。',
    '感情中需要更多的耐心和包容。', '适合与伴侣共同规划未来。',
    '爱情中可能会有惊喜，保持期待。', '需要在感情中保持独立性。',
    '适合修复关系中的裂痕。', '感情中可能会面临重要选择。',
    '单身者可能会通过朋友介绍认识对象。', '有伴者感情更加稳定甜蜜。',
    '爱情中需要更多的浪漫和仪式感。', '可能会重新审视一段感情。',
    '感情中需要学会放手和接受。', '适合与伴侣进行深度交流。',
    '爱情运势平稳，享受当下的美好。', '可能会遇到灵魂伴侣级别的连接。',
    '感情中需要更多的信任。', '适合表达感激之情。',
    '单身者可能会在网络上遇到缘分。', '有伴者适合一起尝试新事物。',
    '爱情中需要平衡付出和接受。', '可能会收到一份特别的礼物。',
  ],
  '事业': [
    '事业运势上升，可能会有晋升机会。', '工作中需要更多的专注和耐心。',
    '可能会有新的工作机会出现。', '适合展现领导力和才能。',
    '工作中需要注意团队合作。', '可能会有重要的项目启动。',
    '事业中需要保持创新思维。', '适合学习新技能提升自己。',
    '工作中可能会遇到贵人相助。', '需要在事业中找到平衡点。',
    '可能会有出差或培训的机会。', '适合制定职业发展规划。',
    '工作中可能会有突破性进展。', '需要处理好与同事的关系。',
    '事业中可能会面临重要决策。', '适合创业或开展副业。',
    '工作中需要更多的自信和果断。', '可能会获得上级的认可和赞赏。',
    '事业中需要保持谦逊和学习态度。', '适合参加行业交流活动。',
    '工作中可能会有新的挑战，但也是机遇。', '需要在事业中保持长期视角。',
    '可能会有跨部门或跨领域合作的机会。', '适合整理工作思路和方法。',
    '事业运势平稳，保持稳定发展。', '可能会有薪资或福利方面的好消息。',
    '工作中需要更多的创意和灵活性。', '适合与客户或合作伙伴建立关系。',
    '事业中需要坚持目标不放弃。', '可能会有转岗或转型的机会。',
  ],
  '财运': [
    '财运不错，可能会有意外收入。', '需要注意理性消费，避免冲动购物。',
    '适合投资理财，会有好回报。', '可能会有大额支出，提前做好预算。',
    '财运上升，正财和偏财都有机会。', '需要谨慎处理借贷关系。',
    '适合做长期的财务规划。', '可能会收到礼物或意外之财。',
    '需要控制消费欲望，量入为出。', '财运平稳，保持稳健的理财策略。',
    '可能会有赚钱的新机会出现。', '适合学习理财知识提升财商。',
    '需要避免高风险的投资。', '可能会有债务方面的好消息。',
    '财运波动，保持谨慎态度。', '适合与他人合作投资项目。',
    '需要建立紧急备用金。', '可能会有加薪或奖金的机会。',
    '财运上升，但也要注意节约。', '适合处理保险或税务相关事务。',
    '需要避免借贷给不熟悉的人。', '可能会发现新的赚钱渠道。',
    '财运平稳，适合储蓄和积累。', '需要警惕诈骗和投资陷阱。',
    '适合做预算和记账。', '可能会有房产或车辆方面的好消息。',
    '财运上升，适合扩大投资。', '需要平衡消费和储蓄。',
    '可能会有副业收入的增加。', '适合整理和优化财务状况。',
  ],
  '健康': [
    '健康状况良好，精力充沛。', '需要注意休息，避免过度劳累。',
    '适合进行体育锻炼，增强体质。', '可能会有小感冒或不适，注意预防。',
    '健康运势上升，适合开始健身计划。', '需要注意饮食均衡，多吃蔬果。',
    '适合进行体检或健康检查。', '可能会有睡眠问题，注意调整作息。',
    '健康状况稳定，保持良好习惯。', '需要注意心理健康，适当放松。',
    '适合尝试瑜伽或冥想。', '可能会有肠胃不适，注意饮食卫生。',
    '健康运势不错，适合户外活动。', '需要注意保护视力，减少屏幕时间。',
    '适合制定健康饮食计划。', '可能会有皮肤问题，注意保湿防晒。',
    '健康状况良好，适合挑战自我。', '需要注意保暖，预防呼吸道疾病。',
    '适合进行深度放松和按摩。', '可能会有头痛或偏头痛，注意休息。',
    '健康运势平稳，保持规律生活。', '需要注意补充维生素和矿物质。',
    '适合进行有氧运动。', '可能会有肌肉酸痛，注意热身拉伸。',
    '健康状况不错，适合旅行。', '需要注意口腔健康。',
    '适合尝试新的健康习惯。', '可能会有情绪波动，注意调节。',
    '健康运势上升，身体状态良好。', '需要注意定期体检和预防。',
  ],
};

const LUCKY_COLORS = ['红色', '蓝色', '绿色', '紫色', '金色', '银色', '粉色', '橙色', '白色', '黑色', '黄色', '青色'];
const LUCKY_NUMBERS = ['1', '3', '5', '6', '7', '8', '9', '11', '13', '18', '22', '28'];

function getDailySeed(signIndex: number): number {
  const now = new Date();
  return now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate() + signIndex * 31;
}

function seededRandom(seed: number): number {
  let x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

const DailyHoroscope: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [selectedSign, setSelectedSign] = useState<number | null>(null);

  const fortune = useMemo(() => {
    if (selectedSign === null) return null;
    const seed = getDailySeed(selectedSign);

    const getFortune = (category: string) => {
      const texts = FORTUNE_TEXTS[category];
      const idx = Math.floor(seededRandom(seed + category.length) * texts.length);
      return texts[idx];
    };

    const overallScore = Math.floor(seededRandom(seed) * 30) + 70;

    return {
      overall: getFortune('综合运势'),
      love: getFortune('爱情'),
      career: getFortune('事业'),
      wealth: getFortune('财运'),
      health: getFortune('健康'),
      score: overallScore,
      luckyColor: LUCKY_COLORS[Math.floor(seededRandom(seed + 100) * LUCKY_COLORS.length)],
      luckyNumber: LUCKY_NUMBERS[Math.floor(seededRandom(seed + 200) * LUCKY_NUMBERS.length)],
    };
  }, [selectedSign]);

  const getScoreStars = (score: number) => {
    const stars = Math.round(score / 20);
    return '★'.repeat(stars) + '☆'.repeat(5 - stars);
  };

  return (
    <div className="space-y-4">
      <div className="text-center mb-2">
        <p className="text-slate-400 text-sm">选择你的星座，查看今日运势</p>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {ZODIAC_SIGNS.map((sign, idx) => (
          <button
            key={idx}
            onClick={() => setSelectedSign(idx)}
            className={`p-2 rounded-lg text-center transition-all ${
              selectedSign === idx
                ? 'bg-blue-500/30 border border-blue-500/50 text-blue-400'
                : 'bg-slate-800/50 border border-slate-700 text-slate-400 hover:bg-slate-700/30'
            }`}
          >
            <div className="text-2xl mb-1">{sign.symbol}</div>
            <div className="text-xs">{sign.name}</div>
          </button>
        ))}
      </div>

      {fortune && selectedSign !== null && (
        <div className="space-y-3">
          <div className="bg-slate-800/50 border border-blue-500/30 rounded-lg p-4 text-center">
            <div className="text-3xl mb-1">{ZODIAC_SIGNS[selectedSign].symbol}</div>
            <h3 className="text-lg font-bold text-blue-400 mb-1">{ZODIAC_SIGNS[selectedSign].name}今日运势</h3>
            <div className="text-yellow-400 text-lg tracking-wider">{getScoreStars(fortune.score)}</div>
            <div className="text-xs text-slate-500 mt-1">综合评分 {fortune.score}/100</div>
          </div>

          {[
            { label: '综合运势', icon: '🌟', text: fortune.overall },
            { label: '爱情', icon: '💕', text: fortune.love },
            { label: '事业', icon: '💼', text: fortune.career },
            { label: '财运', icon: '💰', text: fortune.wealth },
            { label: '健康', icon: '🏥', text: fortune.health },
          ].map(item => (
            <div key={item.label} className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <span>{item.icon}</span>
                <span className="text-xs text-blue-400 font-medium">{item.label}</span>
              </div>
              <p className="text-sm text-slate-300 leading-relaxed">{item.text}</p>
            </div>
          ))}

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-center">
              <p className="text-xs text-slate-500 mb-1">幸运颜色</p>
              <p className="text-sm text-blue-400 font-medium">{fortune.luckyColor}</p>
            </div>
            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-center">
              <p className="text-xs text-slate-500 mb-1">幸运数字</p>
              <p className="text-sm text-blue-400 font-medium">{fortune.luckyNumber}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DailyHoroscope;
