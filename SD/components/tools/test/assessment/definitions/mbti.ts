import type {
  AssessmentDefinition,
  AssessmentQuestion,
  AssessmentResultProfile,
} from '../types';
import { pairedTendencyOptions } from './builders';

function pairedQuestion(
  id: string,
  leftStatement: string,
  rightStatement: string,
  leftId: string,
  rightId: string,
  reverseDisplay = false,
): AssessmentQuestion {
  const first = reverseDisplay ? rightStatement : leftStatement;
  const second = reverseDisplay ? leftStatement : rightStatement;
  return {
    id,
    prompt: `哪一句更接近你？\n前者：${first}\n后者：${second}`,
    options: reverseDisplay
      ? pairedTendencyOptions(rightId, leftId)
      : pairedTendencyOptions(leftId, rightId),
  };
}

const profiles: AssessmentResultProfile[] = [
  { id: 'INTJ', title: 'INTJ · 战略构想者', description: '偏好独立思考、抽象构想、逻辑判断与清晰规划，常把复杂问题整理成长期路径。', keywords: ['战略', '独立', '系统思考'], suggestion: '为计划留出现实反馈和临时调整的空间。' },
  { id: 'INTP', title: 'INTP · 逻辑探索者', description: '偏好独立分析、概念推演与开放探索，常通过追问原理发现新的解释。', keywords: ['逻辑', '好奇', '概念探索'], suggestion: '用一个小型可交付成果帮助想法落地。' },
  { id: 'ENTJ', title: 'ENTJ · 目标组织者', description: '偏好外部协作、长远构想、理性决策与有序推进，擅长组织资源实现目标。', keywords: ['组织', '决策', '目标导向'], suggestion: '推进目标时也确认团队的理解和承载节奏。' },
  { id: 'ENTP', title: 'ENTP · 创意辩证者', description: '偏好互动碰撞、可能性探索与逻辑检验，常能迅速生成不同视角。', keywords: ['创意', '辩证', '适应变化'], suggestion: '在新点子出现前，先为最重要的一个设定完成线。' },
  { id: 'INFJ', title: 'INFJ · 洞察倡导者', description: '偏好深度思考、意义联结、价值判断与方向感，常关注长期的人与事。', keywords: ['洞察', '理想', '共情'], suggestion: '把对他人的关心与自己的恢复需要放在同一张清单上。' },
  { id: 'INFP', title: 'INFP · 价值调和者', description: '偏好内在探索、想象联结、价值感受与开放节奏，重视真实和个人意义。', keywords: ['真诚', '想象', '价值驱动'], suggestion: '把重要价值转成一个今天就能开始的小行动。' },
  { id: 'ENFJ', title: 'ENFJ · 成长连接者', description: '偏好积极互动、整体洞察、关系感受与有序协作，常能看见他人的潜力。', keywords: ['连接', '激励', '责任感'], suggestion: '帮助别人之前，先确认对方是否需要以及自己的边界。' },
  { id: 'ENFP', title: 'ENFP · 灵感发起者', description: '偏好广泛互动、可能性联想、价值感受与灵活选择，容易为新方向注入热情。', keywords: ['热情', '联想', '开放探索'], suggestion: '用少量稳定结构保护最有价值的灵感。' },
  { id: 'ISTJ', title: 'ISTJ · 稳健执行者', description: '偏好独立专注、事实细节、逻辑标准与明确计划，重视可靠和持续完成。', keywords: ['可靠', '细节', '秩序'], suggestion: '规则失效时，允许自己重新评估而非只增加投入。' },
  { id: 'ISFJ', title: 'ISFJ · 细致守护者', description: '偏好安静投入、实际观察、体察他人和稳定安排，常用具体行动表达关心。', keywords: ['细致', '体贴', '责任'], suggestion: '让自己的需要也成为关系中可以被看见的信息。' },
  { id: 'ESTJ', title: 'ESTJ · 秩序推动者', description: '偏好主动协作、现实依据、客观标准与快速落实，擅长把任务组织得清楚可行。', keywords: ['效率', '执行', '组织'], suggestion: '为不同工作风格留下参与决策的入口。' },
  { id: 'ESFJ', title: 'ESFJ · 和谐协作者', description: '偏好热情互动、具体照顾、关系感受与清晰安排，重视群体中的支持与稳定。', keywords: ['热情', '协作', '照顾'], suggestion: '不要只从他人的即时反馈判断自己的价值。' },
  { id: 'ISTP', title: 'ISTP · 实作分析者', description: '偏好独立处理、现实观察、逻辑判断与灵活应对，常在具体问题中快速找到办法。', keywords: ['实作', '冷静', '灵活'], suggestion: '在需要长期协作时，适度说出你的判断过程。' },
  { id: 'ISFP', title: 'ISFP · 感知探索者', description: '偏好安静体验、具体感受、个人价值与自由节奏，容易留意当下真实而细微的美好。', keywords: ['感受', '审美', '自由'], suggestion: '用温和但明确的方式表达边界与偏好。' },
  { id: 'ESTP', title: 'ESTP · 行动应变者', description: '偏好即时互动、现实信息、理性判断与开放行动，面对变化通常反应迅速。', keywords: ['行动', '应变', '务实'], suggestion: '高速度决定前，给长期影响留一次复核。' },
  { id: 'ESFP', title: 'ESFP · 活力体验者', description: '偏好丰富互动、当下体验、关系感受与灵活选择，常为环境带来热度与参与感。', keywords: ['活力', '表达', '当下体验'], suggestion: '把长期目标拆成仍然有趣的短周期体验。' },
];

const rows = [
  ['ei-01', '与很多人互动让我更有精神', '独处让我更快恢复精神', 'E', 'I'],
  ['ei-02', '我常边说边整理想法', '我常想清楚后再表达', 'E', 'I'],
  ['ei-03', '我容易主动认识新朋友', '我更愿意等待自然熟悉', 'E', 'I'],
  ['ei-04', '热闹环境能激发我的状态', '安静环境更能让我专注', 'E', 'I'],
  ['ei-05', '我乐于成为讨论的推动者', '我更常做深入的观察者', 'E', 'I'],
  ['ei-06', '新团队里我会尽快参与交流', '新团队里我会先了解氛围', 'E', 'I'],
  ['ei-07', '我倾向通过外部互动获得灵感', '我倾向通过内部思考获得灵感', 'E', 'I'],
  ['ei-08', '长时间独处会让我想找人交流', '长时间社交会让我需要独处', 'E', 'I'],
  ['ei-09', '我更喜欢广泛连接不同的人', '我更喜欢经营少数深度关系', 'E', 'I'],
  ['ei-10', '遇到新机会我愿意先参与看看', '遇到新机会我愿意先独立评估', 'E', 'I'],
  ['sn-01', '我先关注可观察的事实', '我先关注事实背后的可能性', 'S', 'N'],
  ['sn-02', '我信任经过验证的方法', '我喜欢尝试尚未验证的思路', 'S', 'N'],
  ['sn-03', '我容易记住具体细节', '我容易记住整体含义', 'S', 'N'],
  ['sn-04', '学习时实例最能帮助我', '学习时原理最能帮助我', 'S', 'N'],
  ['sn-05', '我更关注当下能做什么', '我更关注未来可能发生什么', 'S', 'N'],
  ['sn-06', '清晰步骤让我更安心', '开放空间让我更有创造力', 'S', 'N'],
  ['sn-07', '我偏好准确直接的表达', '我偏好隐喻和联想的表达', 'S', 'N'],
  ['sn-08', '解决问题时我从经验出发', '解决问题时我从新模型出发', 'S', 'N'],
  ['sn-09', '我更容易发现实际差错', '我更容易发现潜在机会', 'S', 'N'],
  ['sn-10', '我会先确认现实条件', '我会先构想理想图景', 'S', 'N'],
  ['tf-01', '决策时一致的标准最重要', '决策时人的具体处境最重要', 'T', 'F'],
  ['tf-02', '我更容易指出逻辑漏洞', '我更容易察觉情感影响', 'T', 'F'],
  ['tf-03', '反馈应当直接说明问题', '反馈应当照顾接受方式', 'T', 'F'],
  ['tf-04', '公平意味着规则一致', '公平意味着考虑差异', 'T', 'F'],
  ['tf-05', '争论时我先检验观点', '争论时我先维护理解', 'T', 'F'],
  ['tf-06', '我欣赏冷静客观的判断', '我欣赏温暖体贴的判断', 'T', 'F'],
  ['tf-07', '团队决策应优先效率', '团队决策应优先认同感', 'T', 'F'],
  ['tf-08', '面对困扰我会先找解决方案', '面对困扰我会先给予情绪支持', 'T', 'F'],
  ['tf-09', '即使不受欢迎也要坚持合理结论', '即使结论合理也要考虑关系影响', 'T', 'F'],
  ['tf-10', '两难时我依靠原则排序', '两难时我依靠价值感受排序', 'T', 'F'],
  ['jp-01', '提前安排让我更轻松', '保留选择让我更轻松', 'J', 'P'],
  ['jp-02', '我喜欢先完成再休息', '我常在状态合适时集中完成', 'J', 'P'],
  ['jp-03', '明确截止时间能帮助我规划', '临近截止时间能激发我行动', 'J', 'P'],
  ['jp-04', '旅行前我会准备清晰行程', '旅行时我喜欢随兴探索', 'J', 'P'],
  ['jp-05', '我倾向尽早做出决定', '我倾向继续收集可能性', 'J', 'P'],
  ['jp-06', '整齐有序让我更专注', '灵活可变让我更自在', 'J', 'P'],
  ['jp-07', '计划变化会明显打乱我', '计划变化通常不会困扰我', 'J', 'P'],
  ['jp-08', '我喜欢一次处理完一件事', '我喜欢在多个任务间切换', 'J', 'P'],
  ['jp-09', '确定性会带给我安全感', '开放性会带给我活力', 'J', 'P'],
  ['jp-10', '我更满足于事情已经定下来', '我更满足于仍有调整空间', 'J', 'P'],
] as const;

export const mbtiDefinition: AssessmentDefinition = {
  id: 'mbti-test',
  title: 'MBTI 40 题扩展版',
  subtitle: '从四个偏好维度了解你的性格倾向',
  group: 'personality', questionCount: 40, estimatedMinutes: 8, mode: 'mbti', sensitive: false,
  intro: '请选择每组双句中更接近你通常状态的一侧。没有更好的答案，也不必把偶尔发生的情况当作固定特征。',
  disclaimer: '这是基于四组偏好维度设计的原创趣味测评，并非 MBTI 官方题库、心理诊断或职业决策工具。类型用于提供观察语言，不限制你的能力与变化。',
  minAnsweredRatio: 1,
  dimensions: [
    { id: 'E', label: '外向 E', color: '#b46d67', description: '较多从外部互动中获得能量与灵感' },
    { id: 'I', label: '内向 I', color: '#6d7694', description: '较多从独处和内部思考中恢复与聚焦' },
    { id: 'S', label: '实感 S', color: '#6e8568', description: '偏好现实事实、经验与具体细节' },
    { id: 'N', label: '直觉 N', color: '#8b6f9e', description: '偏好整体含义、联想与未来可能' },
    { id: 'T', label: '思考 T', color: '#587f88', description: '偏好逻辑一致、客观标准与因果分析' },
    { id: 'F', label: '情感 F', color: '#ae7181', description: '偏好价值感受、具体处境与关系影响' },
    { id: 'J', label: '判断 J', color: '#8d785a', description: '偏好明确决定、结构与提前安排' },
    { id: 'P', label: '感知 P', color: '#6f8c84', description: '偏好保持开放、灵活与临场调整' },
  ],
  questions: rows.map(([id, left, right, leftId, rightId], index) =>
    pairedQuestion(id, left, right, leftId, rightId, index % 2 === 1)),
  results: profiles,
  mbtiPairs: [
    { id: 'EI', left: 'E', right: 'I', tieQuestionId: 'ei-10' },
    { id: 'SN', left: 'S', right: 'N', tieQuestionId: 'sn-10' },
    { id: 'TF', left: 'T', right: 'F', tieQuestionId: 'tf-10' },
    { id: 'JP', left: 'J', right: 'P', tieQuestionId: 'jp-10' },
  ],
};
