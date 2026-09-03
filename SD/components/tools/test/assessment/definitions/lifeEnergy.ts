import type { AssessmentDefinition } from '../types';
import { withAssessmentModes } from '../modes';
import { scenarioQuestion } from './builders';

const lifeEnergyDefinitionBase: AssessmentDefinition = {
  id: 'life-energy-test',
  title: '生活能量类型',
  subtitle: '你通常靠什么方式启动、维持和恢复能量？',
  group: 'fun', questionCount: 24, estimatedMinutes: 6, mode: 'dominant', sensitive: false,
  intro: '这份测评关注你在日常节奏里的自然偏好：有人靠行动充电，有人靠稳定、探索、仪式、连接或安静恢复。',
  disclaimer: '结果仅供自我探索和娱乐，不构成心理诊断或专业建议。',
  minAnsweredRatio: 1,
  dimensions: [
    { id: 'action', label: '行动', color: '#c75a36', description: '通过推进和完成获得能量' },
    { id: 'steady', label: '稳态', color: '#718b5d', description: '通过规律和可预期保持能量' },
    { id: 'explore', label: '探索', color: '#d09432', description: '通过新鲜和学习点亮能量' },
    { id: 'ritual', label: '仪式', color: '#9a647c', description: '通过质感和用心安排积蓄能量' },
    { id: 'social', label: '社交', color: '#b56d43', description: '通过回应和共同体验交换能量' },
    { id: 'quiet', label: '静心', color: '#527d7a', description: '通过独处和低刺激恢复能量' },
  ],
  questions: [
    scenarioQuestion('energy-01', '早晨醒来后，什么最能让你进入状态？', [
      ['马上完成一件小事，启动行动感', 'action', 'social'],
      ['按熟悉顺序洗漱、吃饭、出门', 'steady', 'ritual'],
      ['看看今天有没有值得期待的新东西', 'explore', 'action'],
      ['认真准备早餐或挑选今天的搭配', 'ritual', 'quiet'],
    ]),
    scenarioQuestion('energy-02', '面对一项新任务，你最自然的开场是？', [
      ['先找人碰一碰想法，获得回应', 'social', 'action'],
      ['先安静理解要求，减少外界打扰', 'quiet', 'steady'],
      ['先做最明显的一步，边走边调整', 'action', 'social'],
      ['把任务拆进日程，稳定推进', 'steady', 'ritual'],
    ]),
    scenarioQuestion('energy-03', '一顿让你满意的饭更像？', [
      ['尝试从没吃过的口味或组合', 'explore', 'action'],
      ['摆盘和环境都让人感到被认真对待', 'ritual', 'quiet'],
      ['和喜欢的人边吃边聊，共享当下', 'social', 'action'],
      ['安静吃完，不需要太多额外刺激', 'quiet', 'steady'],
    ]),
    scenarioQuestion('energy-04', '理想工作区最重要的特点是？', [
      ['随手就能开始，方便快速推进', 'action', 'social'],
      ['物品位置固定，节奏清晰可控', 'steady', 'ritual'],
      ['有新工具和资料可以随时探索', 'explore', 'action'],
      ['光线、气味和细节让人心情舒服', 'ritual', 'quiet'],
    ]),
    scenarioQuestion('energy-05', '意外多出两小时，你会更想？', [
      ['约个人见面或一起做点什么', 'social', 'action'],
      ['关掉消息，一个人慢慢恢复', 'quiet', 'steady'],
      ['处理掉一件一直想完成的事', 'action', 'social'],
      ['按原本节奏休息，不突然塞满安排', 'steady', 'ritual'],
    ]),
    scenarioQuestion('energy-06', '什么最容易让你重新有精神？', [
      ['学会一个新技巧或发现新去处', 'explore', 'action'],
      ['泡杯喜欢的饮品，认真照顾当下', 'ritual', 'quiet'],
      ['和熟悉的人聊聊，获得真实回应', 'social', 'action'],
      ['降低声音和信息量，独处一会儿', 'quiet', 'steady'],
    ]),
    scenarioQuestion('energy-07', '运动时你更喜欢哪种体验？', [
      ['有目标、有记录，能看到突破', 'action', 'social'],
      ['固定频率，不追求突然加量', 'steady', 'ritual'],
      ['轮换项目，让身体保持新鲜感', 'explore', 'action'],
      ['环境舒服，过程像一次照顾自己', 'ritual', 'quiet'],
    ]),
    scenarioQuestion('energy-08', '旅行中你的能量来自？', [
      ['和同行者分享一路上的反应', 'social', 'action'],
      ['留一点独处，不让行程过度拥挤', 'quiet', 'steady'],
      ['完成目的地清单，享受推进感', 'action', 'social'],
      ['住宿和作息可靠，身体不会被打乱', 'steady', 'ritual'],
    ]),
    scenarioQuestion('energy-09', '截止日期临近时，你会？', [
      ['寻找新方法，快速突破卡点', 'explore', 'action'],
      ['营造专注氛围，郑重完成收尾', 'ritual', 'quiet'],
      ['找伙伴并肩冲刺，互相保持状态', 'social', 'action'],
      ['屏蔽干扰，集中精力安静完成', 'quiet', 'steady'],
    ]),
    scenarioQuestion('energy-10', '学习新知识时，什么最能保持动力？', [
      ['马上练习，看到能力发生变化', 'action', 'social'],
      ['每天一点，形成稳定累积', 'steady', 'ritual'],
      ['不断发现新问题和关联', 'explore', 'action'],
      ['认真做笔记，让过程有质感', 'ritual', 'quiet'],
    ]),
    scenarioQuestion('energy-11', '理想的家中氛围是？', [
      ['有人来往，可以随时共享日常', 'social', 'action'],
      ['安静、有边界，是明确的休息区', 'quiet', 'steady'],
      ['方便行动，想做什么都能马上开始', 'action', 'social'],
      ['熟悉稳定，物品和作息各有位置', 'steady', 'ritual'],
    ]),
    scenarioQuestion('energy-12', '做决定时，你更依靠？', [
      ['探索更多可能，直到找到有趣方向', 'explore', 'action'],
      ['想象哪种选择更符合珍视的生活方式', 'ritual', 'quiet'],
      ['和重要的人讨论，听听彼此反应', 'social', 'action'],
      ['先安静下来，听清自己的真实感受', 'quiet', 'steady'],
    ]),
    scenarioQuestion('energy-13', '庆祝一件好事时，你最想？', [
      ['立刻去做一件期待已久的事', 'action', 'social'],
      ['用熟悉方式犒劳自己，不打乱节奏', 'steady', 'ritual'],
      ['顺势安排一个新的体验', 'explore', 'action'],
      ['认真准备一个有纪念感的小仪式', 'ritual', 'quiet'],
    ]),
    scenarioQuestion('energy-14', '连续忙碌后，你最需要？', [
      ['和懂自己的人聊聊，交换情绪', 'social', 'action'],
      ['不回复消息，安静待一段时间', 'quiet', 'steady'],
      ['先完成最后一个小目标再休息', 'action', 'social'],
      ['恢复睡眠、饮食和原本作息', 'steady', 'ritual'],
    ]),
    scenarioQuestion('energy-15', '生活出现变化时，你会怎样适应？', [
      ['把它当成探索新版本自己的机会', 'explore', 'action'],
      ['重新布置环境，用仪式开启新阶段', 'ritual', 'quiet'],
      ['保持和重要之人的联系，一起适应', 'social', 'action'],
      ['减少额外活动，留出消化变化的空间', 'quiet', 'steady'],
    ]),
    scenarioQuestion('energy-16', '灵感出现时，你通常会？', [
      ['马上做一个原型或开始尝试', 'action', 'social'],
      ['记录下来，安排合适时间实现', 'steady', 'ritual'],
      ['继续联想，看看还能延伸到哪里', 'explore', 'action'],
      ['找合适的形式，把灵感认真保存下来', 'ritual', 'quiet'],
    ]),
    scenarioQuestion('energy-17', '关系中什么最能为你充电？', [
      ['及时互动，一起经历生活', 'social', 'action'],
      ['不用解释也能安心共处和独处', 'quiet', 'steady'],
      ['共同完成目标，彼此带动成长', 'action', 'social'],
      ['稳定联系，关系节奏可以预期', 'steady', 'ritual'],
    ]),
    scenarioQuestion('energy-18', '你的理想一天更像？', [
      ['遇见新内容，始终保有好奇', 'explore', 'action'],
      ['每个细节都被认真感受和安排', 'ritual', 'quiet'],
      ['和重要的人共享经历与情绪', 'social', 'action'],
      ['安静清醒，给内心足够空间', 'quiet', 'steady'],
    ]),
    scenarioQuestion('energy-19', '一周结束时，你最想用什么恢复？', [
      ['完成一个小目标，找回推进感', 'action', 'social'],
      ['按熟悉的方式休息，慢慢稳定下来', 'steady', 'ritual'],
      ['去一个没去过的地方或尝试新活动', 'explore', 'action'],
      ['准备一顿舒服的饭或整理生活细节', 'ritual', 'quiet'],
    ]),
    scenarioQuestion('energy-20', '遇到卡住的任务时，你会先？', [
      ['找人聊聊，获得反馈和新的动力', 'social', 'action'],
      ['关掉干扰，安静把问题想清楚', 'quiet', 'steady'],
      ['先做最明显的一步，边走边调整', 'action', 'social'],
      ['重新安排时间和节奏，避免透支', 'steady', 'ritual'],
    ]),
    scenarioQuestion('energy-21', '理想的休息空间应该？', [
      ['能随时发现新内容和新灵感', 'explore', 'action'],
      ['细节有质感，让人慢慢放松', 'ritual', 'quiet'],
      ['有熟悉的人可以自然交流', 'social', 'action'],
      ['安静、低刺激，让心情慢慢沉下来', 'quiet', 'steady'],
    ]),
    scenarioQuestion('energy-22', '和朋友见面后，你通常？', [
      ['继续安排下一个想做的活动', 'social', 'action'],
      ['需要一点独处，安静恢复注意力', 'quiet', 'steady'],
      ['马上做一个小目标，延续行动感', 'action', 'social'],
      ['回到熟悉的日常，让身体恢复节奏', 'steady', 'ritual'],
    ]),
    scenarioQuestion('energy-23', '面对生活变化，你最需要？', [
      ['把变化当成认识新可能的入口', 'explore', 'action'],
      ['通过整理环境和仪式开启新阶段', 'ritual', 'quiet'],
      ['和重要的人保持联系，一起适应', 'social', 'action'],
      ['减少额外活动，留出安静消化空间', 'quiet', 'steady'],
    ]),
    scenarioQuestion('energy-24', '你希望长期保持哪种状态？', [
      ['每天都有明确的推进和完成', 'action', 'social'],
      ['生活规律，身心有足够恢复空间', 'steady', 'ritual'],
      ['持续学习、发现和尝试新事物', 'explore', 'action'],
      ['认真感受日常，并把生活过得有质感', 'ritual', 'quiet'],
    ]),
  ],
  results: [
    { id: 'action', title: '行动派', description: '你常在“开始做”之后获得清晰和能量。推进、完成和看得见的变化，会让你迅速找回掌控感。', keywords: ['启动快', '执行力', '推进感'], suggestion: '行动前留一个短暂停顿确认方向，能减少无效消耗。' },
    { id: 'steady', title: '稳态派', description: '规律、熟悉和可预期的节奏是你的能量底座。你擅长稳定累积，比起短暂爆发，更看重长期可持续。', keywords: ['规律', '耐力', '稳定感'], suggestion: '稳定不等于一成不变，可以为小范围试新预留固定空间。' },
    { id: 'explore', title: '探索派', description: '新问题、新地点和新技能最容易点亮你。你通过发现可能性保持活力，也常把好奇传递给身边的人。', keywords: ['好奇', '新鲜感', '学习力'], suggestion: '给最重要的探索设一个收束点，让收获真正沉淀下来。' },
    { id: 'ritual', title: '仪式派', description: '你会通过环境、细节和郑重安排，把普通日常变成可感知的生活。质感与意义能为你慢慢蓄能。', keywords: ['仪式感', '质感', '用心'], suggestion: '仪式是为了服务感受，不必让准备本身成为压力。' },
    { id: 'social', title: '社交派', description: '回应、共鸣和共同经历是你的重要能量来源。你常在互动中快速进入状态，也擅长让群体更有温度。', keywords: ['回应', '共享', '连接力'], suggestion: '分辨让你充电和耗电的关系，社交会变得更有选择。' },
    { id: 'quiet', title: '静心派', description: '低刺激、独处和清晰边界让你恢复得最快。你需要给内在留出足够空间，才能重新听见自己的节奏。', keywords: ['独处', '低刺激', '内在空间'], suggestion: '提前告知他人你的恢复方式，可以减少被误解为疏远。' },
  ],
  tieBreakOrder: ['action', 'steady', 'explore', 'ritual', 'social', 'quiet'],
};

export const lifeEnergyDefinition = withAssessmentModes(
  lifeEnergyDefinitionBase,
  lifeEnergyDefinitionBase.questions.slice(0, 12).map((question) => question.id),
  3,
);
