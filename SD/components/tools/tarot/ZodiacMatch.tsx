import React, { useState, useMemo } from 'react';

const ZODIAC_SIGNS = [
  { name: '白羊座', symbol: '♈', dates: '3.21-4.19', element: '火' },
  { name: '金牛座', symbol: '♉', dates: '4.20-5.20', element: '土' },
  { name: '双子座', symbol: '♊', dates: '5.21-6.21', element: '风' },
  { name: '巨蟹座', symbol: '♋', dates: '6.22-7.22', element: '水' },
  { name: '狮子座', symbol: '♌', dates: '7.23-8.22', element: '火' },
  { name: '处女座', symbol: '♍', dates: '8.23-9.22', element: '土' },
  { name: '天秤座', symbol: '♎', dates: '9.23-10.23', element: '风' },
  { name: '天蝎座', symbol: '♏', dates: '10.24-11.22', element: '水' },
  { name: '射手座', symbol: '♐', dates: '11.23-12.21', element: '火' },
  { name: '摩羯座', symbol: '♑', dates: '12.22-1.19', element: '土' },
  { name: '水瓶座', symbol: '♒', dates: '1.20-2.18', element: '风' },
  { name: '双鱼座', symbol: '♓', dates: '2.19-3.20', element: '水' },
];

// Compatibility matrix: [sign1][sign2] = { love, friend, career }
const COMPATIBILITY: Record<string, Record<string, { love: number; friend: number; career: number; desc: string }>> = {
  '白羊座': {
    '白羊座': { love: 75, friend: 70, career: 65, desc: '两个白羊在一起充满激情和活力，但也容易因为固执而产生冲突。学会互相让步是关键。' },
    '金牛座': { love: 55, friend: 60, career: 50, desc: '白羊的冲动与金牛的稳重形成对比。需要耐心理解彼此的节奏差异。' },
    '双子座': { love: 80, friend: 85, career: 75, desc: '充满活力的组合！双子的机智与白羊的勇气相得益彰，沟通顺畅。' },
    '巨蟹座': { love: 50, friend: 55, career: 45, desc: '白羊的直接可能伤害敏感的巨蟹。需要更多的情感理解和包容。' },
    '狮子座': { love: 90, friend: 85, career: 80, desc: '火象星座的完美搭配！彼此欣赏，充满热情和创造力。' },
    '处女座': { love: 45, friend: 50, career: 55, desc: '白羊的冲动与处女的细致形成挑战。互相学习可以互补。' },
    '天秤座': { love: 75, friend: 80, career: 70, desc: '对宫星座的吸引力很强。白羊的果断与天秤的优雅形成平衡。' },
    '天蝎座': { love: 65, friend: 55, career: 60, desc: '两个强势的星座，需要学会信任和给对方空间。' },
    '射手座': { love: 85, friend: 90, career: 80, desc: '火象星座的绝佳组合！共同热爱自由和冒险。' },
    '摩羯座': { love: 50, friend: 55, career: 65, desc: '白羊的热情与摩羯的务实可以互补，但需要耐心。' },
    '水瓶座': { love: 75, friend: 85, career: 75, desc: '两个独立而创新的灵魂，互相尊重对方的自由。' },
    '双鱼座': { love: 60, friend: 65, career: 50, desc: '白羊的直接与双鱼的敏感需要磨合，但可以互相成长。' },
  },
  '金牛座': {
    '白羊座': { love: 55, friend: 60, career: 50, desc: '金牛的稳重可以平衡白羊的冲动，但节奏差异需要调和。' },
    '金牛座': { love: 80, friend: 75, career: 85, desc: '两个金牛在一起稳定而舒适，享受生活的美好。但要避免陷入惰性。' },
    '双子座': { love: 50, friend: 60, career: 55, desc: '金牛的踏实与双子的灵活需要磨合。沟通是关键。' },
    '巨蟹座': { love: 90, friend: 85, career: 80, desc: '土象与水象的完美组合！彼此重视安全感和家庭。' },
    '狮子座': { love: 65, friend: 60, career: 55, desc: '金牛的节俭与狮子的豪爽需要找到平衡点。' },
    '处女座': { love: 85, friend: 90, career: 90, desc: '土象星座的绝佳搭配！务实而高效，互相欣赏。' },
    '天秤座': { love: 60, friend: 65, career: 60, desc: '金牛的固执与天秤的犹豫需要互相理解。' },
    '天蝎座': { love: 85, friend: 70, career: 75, desc: '对宫星座的强烈吸引力。深沉而忠诚的连接。' },
    '射手座': { love: 45, friend: 55, career: 50, desc: '金牛的安定与射手的自由需要调和。' },
    '摩羯座': { love: 90, friend: 85, career: 95, desc: '土象星座的完美组合！共同追求稳定和成就。' },
    '水瓶座': { love: 45, friend: 55, career: 50, desc: '金牛的传统与水瓶的创新需要互相包容。' },
    '双鱼座': { love: 80, friend: 80, career: 70, desc: '金牛的踏实给双鱼安全感，双鱼的浪漫给金牛温暖。' },
  },
  '双子座': {
    '白羊座': { love: 80, friend: 85, career: 75, desc: '充满活力和趣味的组合，沟通无障碍。' },
    '金牛座': { love: 50, friend: 60, career: 55, desc: '双子的多变与金牛的稳定需要磨合。' },
    '双子座': { love: 70, friend: 90, career: 75, desc: '两个双子在一起永远不会无聊，但可能缺乏深度。' },
    '巨蟹座': { love: 55, friend: 60, career: 50, desc: '双子的理性与巨蟹的感性需要互相理解。' },
    '狮子座': { love: 75, friend: 80, career: 70, desc: '双子的机智与狮子的魅力互相吸引。' },
    '处女座': { love: 55, friend: 65, career: 65, desc: '同为水星守护，沟通顺畅但风格不同。' },
    '天秤座': { love: 85, friend: 90, career: 80, desc: '风象星座的绝佳搭配！和谐而充满智慧。' },
    '天蝎座': { love: 50, friend: 45, career: 50, desc: '双子的轻快与天蝎的深沉形成对比。' },
    '射手座': { love: 70, friend: 80, career: 70, desc: '对宫星座的吸引力，共同热爱自由和知识。' },
    '摩羯座': { love: 45, friend: 50, career: 55, desc: '双子的灵活与摩羯的严谨需要调和。' },
    '水瓶座': { love: 90, friend: 95, career: 85, desc: '风象星座的灵魂伴侣！思想的共鸣和自由的尊重。' },
    '双鱼座': { love: 60, friend: 65, career: 50, desc: '双子的理性与双鱼的感性需要找到共同语言。' },
  },
  '巨蟹座': {
    '白羊座': { love: 50, friend: 55, career: 45, desc: '巨蟹的敏感与白羊的直接需要磨合。' },
    '金牛座': { love: 90, friend: 85, career: 80, desc: '稳定而温馨的组合，共同营造舒适的家。' },
    '双子座': { love: 55, friend: 60, career: 50, desc: '巨蟹的情感深度与双子的表面化需要调和。' },
    '巨蟹座': { love: 85, friend: 80, career: 75, desc: '两个巨蟹在一起情感丰富，但要注意过度敏感。' },
    '狮子座': { love: 70, friend: 65, career: 60, desc: '巨蟹的温柔与狮子的霸气可以互补。' },
    '处女座': { love: 80, friend: 85, career: 80, desc: '水象与土象的和谐搭配，互相照顾和支持。' },
    '天秤座': { love: 55, friend: 60, career: 55, desc: '巨蟹的家庭观念与天秤的社交需求需要平衡。' },
    '天蝎座': { love: 95, friend: 85, career: 80, desc: '水象星座的深度连接！灵魂伴侣的潜质。' },
    '射手座': { love: 45, friend: 55, career: 45, desc: '巨蟹的依恋与射手的自由需要调和。' },
    '摩羯座': { love: 75, friend: 70, career: 80, desc: '对宫星座的互补，家庭与事业的平衡。' },
    '水瓶座': { love: 45, friend: 50, career: 45, desc: '巨蟹的情感需求与水瓶的独立需要磨合。' },
    '双鱼座': { love: 90, friend: 90, career: 75, desc: '水象星座的完美组合！浪漫而深情。' },
  },
  '狮子座': {
    '白羊座': { love: 90, friend: 85, career: 80, desc: '火象星座的完美搭配！彼此欣赏，充满热情。' },
    '金牛座': { love: 65, friend: 60, career: 55, desc: '狮子的豪爽与金牛的节俭需要找到平衡。' },
    '双子座': { love: 75, friend: 80, career: 70, desc: '狮子的魅力与双子的机智互相吸引。' },
    '巨蟹座': { love: 70, friend: 65, career: 60, desc: '狮子的保护欲与巨蟹的温柔形成互补。' },
    '狮子座': { love: 80, friend: 75, career: 70, desc: '两个狮子在一起光芒四射，但要注意不要争抢聚光灯。' },
    '处女座': { love: 55, friend: 60, career: 65, desc: '狮子的自信与处女的谦逊需要磨合。' },
    '天秤座': { love: 85, friend: 85, career: 75, desc: '互相欣赏的组合，社交场合的最佳搭档。' },
    '天蝎座': { love: 70, friend: 55, career: 60, desc: '两个强势的星座，需要学会分享权力。' },
    '射手座': { love: 85, friend: 90, career: 80, desc: '火象星座的绝佳组合！共同追求精彩人生。' },
    '摩羯座': { love: 60, friend: 55, career: 70, desc: '狮子的热情与摩羯的务实可以互补。' },
    '水瓶座': { love: 70, friend: 75, career: 65, desc: '对宫星座的吸引力，需要互相尊重。' },
    '双鱼座': { love: 65, friend: 70, career: 55, desc: '狮子的强势与双鱼的柔弱需要平衡。' },
  },
  '处女座': {
    '白羊座': { love: 45, friend: 50, career: 55, desc: '处女的细致与白羊的冲动需要磨合。' },
    '金牛座': { love: 85, friend: 90, career: 90, desc: '土象星座的完美搭配！务实而高效。' },
    '双子座': { love: 55, friend: 65, career: 65, desc: '同为水星守护，但处理方式不同。' },
    '巨蟹座': { love: 80, friend: 85, career: 80, desc: '互相照顾的温馨组合。' },
    '狮子座': { love: 55, friend: 60, career: 65, desc: '处女的谦逊与狮子的自信需要磨合。' },
    '处女座': { love: 75, friend: 80, career: 85, desc: '两个处女在一起井井有条，但要注意不要过于挑剔。' },
    '天秤座': { love: 55, friend: 60, career: 60, desc: '处女的批判与天秤的和谐需要平衡。' },
    '天蝎座': { love: 80, friend: 75, career: 80, desc: '深沉而忠诚的组合，互相理解。' },
    '射手座': { love: 45, friend: 55, career: 50, desc: '处女的谨慎与射手的冒险需要调和。' },
    '摩羯座': { love: 85, friend: 85, career: 90, desc: '土象星座的绝佳搭配！共同追求完美。' },
    '水瓶座': { love: 45, friend: 50, career: 55, desc: '处女的传统与水瓶的创新需要磨合。' },
    '双鱼座': { love: 70, friend: 70, career: 60, desc: '对宫星座的互补，细致与浪漫的结合。' },
  },
  '天秤座': {
    '白羊座': { love: 75, friend: 80, career: 70, desc: '对宫星座的强烈吸引力，果断与优雅的平衡。' },
    '金牛座': { love: 60, friend: 65, career: 60, desc: '天秤的犹豫与金牛的固执需要磨合。' },
    '双子座': { love: 85, friend: 90, career: 80, desc: '风象星座的绝佳搭配！和谐而充满智慧。' },
    '巨蟹座': { love: 55, friend: 60, career: 55, desc: '天秤的社交与巨蟹的家庭需要平衡。' },
    '狮子座': { love: 85, friend: 85, career: 75, desc: '互相欣赏的社交搭档。' },
    '处女座': { love: 55, friend: 60, career: 60, desc: '天秤的随和与处女的严谨需要磨合。' },
    '天秤座': { love: 80, friend: 85, career: 75, desc: '两个天秤在一起优雅和谐，但要避免优柔寡断。' },
    '天蝎座': { love: 60, friend: 50, career: 55, desc: '天秤的表面化与天蝎的深沉需要调和。' },
    '射手座': { love: 70, friend: 75, career: 65, desc: '天秤的平衡与射手的自由需要磨合。' },
    '摩羯座': { love: 55, friend: 55, career: 65, desc: '天秤的随和与摩羯的严谨需要调和。' },
    '水瓶座': { love: 85, friend: 90, career: 80, desc: '风象星座的完美组合！思想的共鸣。' },
    '双鱼座': { love: 65, friend: 70, career: 55, desc: '天秤的理性与双鱼的感性需要找到平衡。' },
  },
  '天蝎座': {
    '白羊座': { love: 65, friend: 55, career: 60, desc: '两个强势的星座，需要学会信任。' },
    '金牛座': { love: 85, friend: 70, career: 75, desc: '对宫星座的深度连接，忠诚而深沉。' },
    '双子座': { love: 50, friend: 45, career: 50, desc: '天蝎的深沉与双子的轻快需要磨合。' },
    '巨蟹座': { love: 95, friend: 85, career: 80, desc: '水象星座的灵魂伴侣！深度的情感连接。' },
    '狮子座': { love: 70, friend: 55, career: 60, desc: '两个强势的星座，需要分享权力。' },
    '处女座': { love: 80, friend: 75, career: 80, desc: '深沉而忠诚的组合。' },
    '天秤座': { love: 60, friend: 50, career: 55, desc: '天蝎的深度与天秤的表面化需要调和。' },
    '天蝎座': { love: 85, friend: 70, career: 75, desc: '两个天蝎在一起深沉而强烈，但要避免猜疑。' },
    '射手座': { love: 50, friend: 50, career: 50, desc: '天蝎的占有与射手的自由需要调和。' },
    '摩羯座': { love: 80, friend: 75, career: 85, desc: '深沉而务实的组合，共同追求目标。' },
    '水瓶座': { love: 55, friend: 50, career: 55, desc: '天蝎的情感与水瓶的理性需要磨合。' },
    '双鱼座': { love: 90, friend: 85, career: 75, desc: '水象星座的深度连接！浪漫而神秘。' },
  },
  '射手座': {
    '白羊座': { love: 85, friend: 90, career: 80, desc: '火象星座的绝佳组合！共同热爱冒险。' },
    '金牛座': { love: 45, friend: 55, career: 50, desc: '射手的自由与金牛的安定需要调和。' },
    '双子座': { love: 70, friend: 80, career: 70, desc: '对宫星座的吸引力，共同追求知识。' },
    '巨蟹座': { love: 45, friend: 55, career: 45, desc: '射手的自由与巨蟹的依恋需要磨合。' },
    '狮子座': { love: 85, friend: 90, career: 80, desc: '火象星座的完美搭配！精彩而热烈。' },
    '处女座': { love: 45, friend: 55, career: 50, desc: '射手的随性与处女的严谨需要调和。' },
    '天秤座': { love: 70, friend: 75, career: 65, desc: '射手的直率与天秤的圆滑需要磨合。' },
    '天蝎座': { love: 50, friend: 50, career: 50, desc: '射手的自由与天蝎的占有需要调和。' },
    '射手座': { love: 80, friend: 90, career: 75, desc: '两个射手在一起自由而快乐，但要避免缺乏承诺。' },
    '摩羯座': { love: 50, friend: 55, career: 60, desc: '射手的乐观与摩羯的务实需要平衡。' },
    '水瓶座': { love: 80, friend: 85, career: 75, desc: '两个自由灵魂的组合，互相尊重。' },
    '双鱼座': { love: 55, friend: 60, career: 45, desc: '射手的直接与双鱼的敏感需要磨合。' },
  },
  '摩羯座': {
    '白羊座': { love: 50, friend: 55, career: 65, desc: '摩羯的谨慎与白羊的冲动需要磨合。' },
    '金牛座': { love: 90, friend: 85, career: 95, desc: '土象星座的完美组合！稳定而有成就。' },
    '双子座': { love: 45, friend: 50, career: 55, desc: '摩羯的严谨与双子的灵活需要调和。' },
    '巨蟹座': { love: 75, friend: 70, career: 80, desc: '对宫星座的互补，家庭与事业的平衡。' },
    '狮子座': { love: 60, friend: 55, career: 70, desc: '摩羯的低调与狮子的张扬需要磨合。' },
    '处女座': { love: 85, friend: 85, career: 90, desc: '土象星座的绝佳搭配！务实而高效。' },
    '天秤座': { love: 55, friend: 55, career: 65, desc: '摩羯的严谨与天秤的随和需要调和。' },
    '天蝎座': { love: 80, friend: 75, career: 85, desc: '深沉而务实的组合，共同追求目标。' },
    '射手座': { love: 50, friend: 55, career: 60, desc: '摩羯的谨慎与射手的乐观需要平衡。' },
    '摩羯座': { love: 80, friend: 75, career: 90, desc: '两个摩羯在一起目标明确，但要注意不要过于严肃。' },
    '水瓶座': { love: 50, friend: 55, career: 60, desc: '摩羯的传统与水瓶的创新需要磨合。' },
    '双鱼座': { love: 70, friend: 70, career: 65, desc: '摩羯的务实与双鱼的浪漫可以互补。' },
  },
  '水瓶座': {
    '白羊座': { love: 75, friend: 85, career: 75, desc: '两个独立而创新的灵魂，互相尊重自由。' },
    '金牛座': { love: 45, friend: 55, career: 50, desc: '水瓶的创新与金牛的传统需要磨合。' },
    '双子座': { love: 90, friend: 95, career: 85, desc: '风象星座的灵魂伴侣！思想的共鸣。' },
    '巨蟹座': { love: 45, friend: 50, career: 45, desc: '水瓶的独立与巨蟹的依恋需要调和。' },
    '狮子座': { love: 70, friend: 75, career: 65, desc: '对宫星座的吸引力，需要互相尊重。' },
    '处女座': { love: 45, friend: 50, career: 55, desc: '水瓶的创新与处女的传统需要磨合。' },
    '天秤座': { love: 85, friend: 90, career: 80, desc: '风象星座的完美搭配！和谐而智慧。' },
    '天蝎座': { love: 55, friend: 50, career: 55, desc: '水瓶的理性与天蝎的情感需要调和。' },
    '射手座': { love: 80, friend: 85, career: 75, desc: '两个自由灵魂的组合。' },
    '摩羯座': { love: 50, friend: 55, career: 60, desc: '水瓶的创新与摩羯的传统需要磨合。' },
    '水瓶座': { love: 75, friend: 85, career: 75, desc: '两个水瓶在一起充满创意，但要注意情感连接。' },
    '双鱼座': { love: 60, friend: 65, career: 50, desc: '水瓶的理性与双鱼的感性需要找到平衡。' },
  },
  '双鱼座': {
    '白羊座': { love: 60, friend: 65, career: 50, desc: '双鱼的敏感与白羊的直接需要磨合。' },
    '金牛座': { love: 80, friend: 80, career: 70, desc: '金牛的踏实给双鱼安全感。' },
    '双子座': { love: 60, friend: 65, career: 50, desc: '双鱼的感性与双子的理性需要调和。' },
    '巨蟹座': { love: 90, friend: 90, career: 75, desc: '水象星座的完美组合！浪漫而深情。' },
    '狮子座': { love: 65, friend: 70, career: 55, desc: '双鱼的柔弱与狮子的强势需要平衡。' },
    '处女座': { love: 70, friend: 70, career: 60, desc: '对宫星座的互补，浪漫与务实的结合。' },
    '天秤座': { love: 65, friend: 70, career: 55, desc: '双鱼的感性与天秤的理性需要找到平衡。' },
    '天蝎座': { love: 90, friend: 85, career: 75, desc: '水象星座的深度连接！神秘而浪漫。' },
    '射手座': { love: 55, friend: 60, career: 45, desc: '双鱼的依恋与射手的自由需要调和。' },
    '摩羯座': { love: 70, friend: 70, career: 65, desc: '双鱼的浪漫与摩羯的务实可以互补。' },
    '水瓶座': { love: 60, friend: 65, career: 50, desc: '双鱼的感性与水瓶的理性需要磨合。' },
    '双鱼座': { love: 85, friend: 85, career: 70, desc: '两个双鱼在一起浪漫而梦幻，但要面对现实。' },
  },
};

const ZodiacMatch: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [sign1, setSign1] = useState(0);
  const [sign2, setSign2] = useState(0);

  const result = useMemo(() => {
    const s1 = ZODIAC_SIGNS[sign1].name;
    const s2 = ZODIAC_SIGNS[sign2].name;
    return COMPATIBILITY[s1]?.[s2] || null;
  }, [sign1, sign2]);

  const getScoreColor = (score: number) => {
    if (score >= 85) return 'text-green-400';
    if (score >= 70) return 'text-blue-400';
    if (score >= 55) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getScoreBarColor = (score: number) => {
    if (score >= 85) return 'bg-green-500';
    if (score >= 70) return 'bg-blue-500';
    if (score >= 55) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  return (
    <div className="space-y-4">
      <div className="text-center mb-2">
        <p className="text-slate-400 text-sm">选择两个星座，探索你们的缘分</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">第一个星座</label>
          <select
            value={sign1}
            onChange={e => setSign1(Number(e.target.value))}
            className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 focus:outline-none focus:border-blue-500/50"
          >
            {ZODIAC_SIGNS.map((s, i) => (
              <option key={i} value={i}>{s.symbol} {s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">第二个星座</label>
          <select
            value={sign2}
            onChange={e => setSign2(Number(e.target.value))}
            className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 focus:outline-none focus:border-blue-500/50"
          >
            {ZODIAC_SIGNS.map((s, i) => (
              <option key={i} value={i}>{s.symbol} {s.name}</option>
            ))}
          </select>
        </div>
      </div>

      {result && (
        <div className="space-y-3">
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 text-center">
            <div className="flex items-center justify-center gap-4 mb-3">
              <span className="text-3xl">{ZODIAC_SIGNS[sign1].symbol}</span>
              <span className="text-blue-400 text-2xl">+</span>
              <span className="text-3xl">{ZODIAC_SIGNS[sign2].symbol}</span>
            </div>
            <p className="text-sm text-slate-300 leading-relaxed">{result.desc}</p>
          </div>

          {[
            { label: '爱情', score: result.love, icon: '💕' },
            { label: '友谊', score: result.friend, icon: '🤝' },
            { label: '事业', score: result.career, icon: '💼' },
          ].map(item => (
            <div key={item.label} className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-slate-300">{item.icon} {item.label}</span>
                <span className={`text-sm font-bold ${getScoreColor(item.score)}`}>{item.score}%</span>
              </div>
              <div className="w-full bg-slate-700 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all duration-500 ${getScoreBarColor(item.score)}`}
                  style={{ width: `${item.score}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ZodiacMatch;
