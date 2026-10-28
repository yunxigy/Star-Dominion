import type { AssessmentDefinition } from '../types';
import { withAssessmentModes } from '../modes';
import { scenarioQuestion } from './builders';

const colorPersonalityDefinitionBase: AssessmentDefinition = {
  id: 'color-personality-test',
  title: '色彩人格测试',
  subtitle: '你的行动、关系与灵感，更像哪一种颜色？',
  group: 'fun', questionCount: 24, estimatedMinutes: 6, mode: 'dominant', sensitive: false,
  intro: '颜色不定义人格，却很适合描绘我们处理生活的不同方式。请根据真实习惯选择，而不是选择看起来最理想的答案。',
  disclaimer: '结果仅供自我探索和娱乐，不构成心理诊断或专业建议。',
  minAnsweredRatio: 1,
  dimensions: [
    { id: 'red', label: '红色', color: '#c4513f', description: '果断行动与直接推动' },
    { id: 'orange', label: '橙色', color: '#d77a32', description: '热情连接与现场活力' },
    { id: 'yellow', label: '黄色', color: '#d6a622', description: '乐观创意与开放想象' },
    { id: 'green', label: '绿色', color: '#6f9563', description: '稳定协调与持续滋养' },
    { id: 'blue', label: '蓝色', color: '#4c7899', description: '理性秩序与深度思考' },
    { id: 'purple', label: '紫色', color: '#7d5b8f', description: '审美洞察与意义感受' },
  ],
  questions: [
    scenarioQuestion('color-01', '开始一个新项目时，你会先做什么？', [
      ['确定目标，马上推进第一步', 'red', 'orange'],
      ['召集伙伴，让大家进入状态', 'orange', 'yellow'],
      ['先发散想象，寻找独特方向', 'yellow', 'purple'],
      ['确认节奏，让过程可以持续', 'green', 'blue'],
    ]),
    scenarioQuestion('color-02', '收到批评时，你更接近哪种反应？', [
      ['梳理事实，判断哪些值得采纳', 'blue', 'green'],
      ['体会话语背后的期待和意义', 'purple', 'yellow'],
      ['先明确问题，尽快做出调整', 'red', 'orange'],
      ['主动沟通，避免关系留下疙瘩', 'orange', 'yellow'],
    ]),
    scenarioQuestion('color-03', '布置自己的房间时，你更看重？', [
      ['有趣的细节和明亮的灵感', 'yellow', 'purple'],
      ['舒适自然，让人能慢下来', 'green', 'blue'],
      ['整洁清晰，每件东西都有位置', 'blue', 'green'],
      ['整体气质独特，有个人表达', 'purple', 'yellow'],
    ]),
    scenarioQuestion('color-04', '小组讨论迟迟没有结论时，你会？', [
      ['提出明确选择，推动大家决定', 'red', 'orange'],
      ['调动气氛，让更多人愿意表达', 'orange', 'yellow'],
      ['抛出一个新思路打破僵局', 'yellow', 'purple'],
      ['总结共识，找一个平衡方案', 'green', 'blue'],
    ]),
    scenarioQuestion('color-05', '理想周末更像哪幅画面？', [
      ['按喜欢的节奏读书、整理或思考', 'blue', 'green'],
      ['去看展、拍照或感受一场演出', 'purple', 'yellow'],
      ['完成挑战，享受清晰的成就感', 'red', 'orange'],
      ['和朋友吃饭聊天，分享热闹', 'orange', 'yellow'],
    ]),
    scenarioQuestion('color-06', '压力积累时，什么最能帮助你？', [
      ['换个新鲜活动，让注意力重新亮起来', 'yellow', 'purple'],
      ['回到稳定作息，照顾身体和环境', 'green', 'blue'],
      ['把问题拆清楚，逐项恢复秩序', 'blue', 'green'],
      ['写下感受，理解这段经历的意义', 'purple', 'yellow'],
    ]),
    scenarioQuestion('color-07', '初次见面时，你通常给人的感觉是？', [
      ['直接、有主见，不太绕弯', 'red', 'orange'],
      ['热情、好接近，很快聊起来', 'orange', 'yellow'],
      ['轻松、有点子，话题跳跃有趣', 'yellow', 'purple'],
      ['温和、可靠，让人容易放松', 'green', 'blue'],
    ]),
    scenarioQuestion('color-08', '给重要的人挑礼物时，你会？', [
      ['研究需求，选实用且品质可靠的东西', 'blue', 'green'],
      ['挑一个有故事、有审美表达的物件', 'purple', 'yellow'],
      ['选能立刻解决对方问题的礼物', 'red', 'orange'],
      ['准备能一起体验和分享的安排', 'orange', 'yellow'],
    ]),
    scenarioQuestion('color-09', '学习陌生内容时，你更喜欢？', [
      ['用联想和创意快速建立兴趣', 'yellow', 'purple'],
      ['按稳定节奏反复练习和吸收', 'green', 'blue'],
      ['先搭好结构，再补充细节', 'blue', 'green'],
      ['追问它与自己经验有什么深层联系', 'purple', 'yellow'],
    ]),
    scenarioQuestion('color-10', '意见冲突时，你倾向于？', [
      ['把不同点说清楚，直面问题', 'red', 'orange'],
      ['保持互动，寻找能继续合作的方式', 'orange', 'yellow'],
      ['提出第三种可能，不困在二选一里', 'yellow', 'purple'],
      ['让节奏慢一点，兼顾各方感受', 'green', 'blue'],
    ]),
    scenarioQuestion('color-11', '旅行中最吸引你的部分是？', [
      ['路线知识、历史资料和清晰安排', 'blue', 'green'],
      ['当地建筑、艺术和独特气质', 'purple', 'yellow'],
      ['完成想去的清单，行动充实', 'red', 'orange'],
      ['和同行者共享一路上的快乐', 'orange', 'yellow'],
    ]),
    scenarioQuestion('color-12', '取得好成绩后，你最想？', [
      ['想象下一次还能创造什么新东西', 'yellow', 'purple'],
      ['感谢支持者，让成果继续生长', 'green', 'blue'],
      ['复盘方法，留下可重复的经验', 'blue', 'green'],
      ['用一个有仪式感的方式纪念它', 'purple', 'yellow'],
    ]),
    scenarioQuestion('color-13', '面对日常琐事，你更常？', [
      ['迅速处理，不让它持续占用注意力', 'red', 'orange'],
      ['边做边聊，让过程不那么无聊', 'orange', 'yellow'],
      ['想办法改造流程，让它更有趣', 'yellow', 'purple'],
      ['按固定节奏完成，保持生活稳定', 'green', 'blue'],
    ]),
    scenarioQuestion('color-14', '遇到风险机会时，你会？', [
      ['收集信息，比较收益和代价', 'blue', 'green'],
      ['判断它是否符合自己的价值和愿景', 'purple', 'yellow'],
      ['如果目标重要，会果断承担风险', 'red', 'orange'],
      ['找伙伴一起行动，分担不确定性', 'orange', 'yellow'],
    ]),
    scenarioQuestion('color-15', '别人向你求助时，你更可能？', [
      ['提供新角度，让对方看到更多可能', 'yellow', 'purple'],
      ['持续陪伴，帮他恢复稳定节奏', 'green', 'blue'],
      ['分析问题，给出清晰步骤', 'blue', 'green'],
      ['理解他真正想守住的东西', 'purple', 'yellow'],
    ]),
    scenarioQuestion('color-16', '表达重要观点时，你偏好？', [
      ['先给结论，再说明行动要求', 'red', 'orange'],
      ['通过互动和故事让人参与进来', 'orange', 'yellow'],
      ['用比喻和想象打开新的视角', 'yellow', 'purple'],
      ['语气平和，让信息容易被接受', 'green', 'blue'],
    ]),
    scenarioQuestion('color-17', '精力不足时，你如何恢复？', [
      ['减少信息输入，安静整理思绪', 'blue', 'green'],
      ['看电影、听音乐或接触美的事物', 'purple', 'yellow'],
      ['完成一个小目标，找回推进感', 'red', 'orange'],
      ['找熟悉的人聊聊，获得回应', 'orange', 'yellow'],
    ]),
    scenarioQuestion('color-18', '想到未来，你最期待？', [
      ['不断有新鲜想法和成长空间', 'yellow', 'purple'],
      ['生活稳定、关系温暖、可以持续', 'green', 'blue'],
      ['能力和系统越来越成熟可靠', 'blue', 'green'],
      ['活出鲜明而有意义的个人表达', 'purple', 'yellow'],
    ]),
    scenarioQuestion('color-19', '开始学习一个新技能时，你会？', [
      ['先定一个可见目标，马上练第一步', 'red', 'orange'],
      ['找同伴交流，让过程更有动力', 'orange', 'yellow'],
      ['先发散各种玩法，找到最感兴趣的方向', 'yellow', 'purple'],
      ['建立规律节奏，确保可以坚持', 'green', 'blue'],
    ]),
    scenarioQuestion('color-20', '看到一个复杂问题时，你更想？', [
      ['先整理信息，找到结构和关键证据', 'blue', 'green'],
      ['体会它背后的情绪、意义或故事', 'purple', 'yellow'],
      ['直接试一个方案，看能否推动变化', 'red', 'orange'],
      ['邀请别人一起讨论和分担', 'orange', 'yellow'],
    ]),
    scenarioQuestion('color-21', '生活节奏被打乱时，你会？', [
      ['用新鲜活动换一个角度重新启动', 'yellow', 'purple'],
      ['先恢复作息和环境的稳定', 'green', 'blue'],
      ['把事情重新排出优先级和步骤', 'blue', 'green'],
      ['写下感受，找回这段经历的意义', 'purple', 'yellow'],
    ]),
    scenarioQuestion('color-22', '团队需要做决定时，你倾向于？', [
      ['提出明确选择并推动落地', 'red', 'orange'],
      ['确保大家都愿意参与和表达', 'orange', 'yellow'],
      ['提出一个打破惯性的第三方案', 'yellow', 'purple'],
      ['总结共识，找到能持续执行的安排', 'green', 'blue'],
    ]),
    scenarioQuestion('color-23', '为自己安排休息时，你更看重？', [
      ['安静整理思绪，减少信息干扰', 'blue', 'green'],
      ['接触艺术、音乐或有审美的事物', 'purple', 'yellow'],
      ['做一个有挑战的小目标', 'red', 'orange'],
      ['和喜欢的人共享轻松时光', 'orange', 'yellow'],
    ]),
    scenarioQuestion('color-24', '想到下一阶段，你最希望？', [
      ['拥有更多创造和尝试的空间', 'yellow', 'purple'],
      ['生活关系稳定，也能慢慢成长', 'green', 'blue'],
      ['建立更成熟可靠的方法和系统', 'blue', 'green'],
      ['用鲜明的方式表达真正重要的东西', 'purple', 'yellow'],
    ]),
  ],
  results: [
    { id: 'red', title: '红色行动者', description: '你偏爱清晰目标和直接行动，愿意在关键时刻推动事情向前。你的力量来自决断、勇气和看得见的进展。', keywords: ['果断', '行动力', '目标'], suggestion: '在加速之前多留一点倾听空间，会让行动获得更多支持。' },
    { id: 'orange', title: '橙色连接者', description: '你从互动和共享体验中获得能量，擅长让陌生人放松、让团队活起来。关系中的即时回应对你很重要。', keywords: ['热情', '连接', '感染力'], suggestion: '热闹之外也为自己保留安静时间，能让热情更稳定。' },
    { id: 'yellow', title: '黄色创想家', description: '你对可能性、新点子和有趣变化十分敏感，常能在平常事物里发现新的玩法。乐观是你启动探索的燃料。', keywords: ['创意', '乐观', '开放'], suggestion: '给最重要的灵感配一条完成路径，让想象真正落地。' },
    { id: 'green', title: '绿色调和者', description: '你看重自然节奏、关系舒适与可持续的成长。你不急于争先，却很擅长让环境慢慢变得稳定宜居。', keywords: ['稳定', '协调', '滋养'], suggestion: '维持和谐时别忘了表达自己的明确偏好。' },
    { id: 'blue', title: '蓝色思考者', description: '你喜欢理解结构、核对信息并建立秩序。面对复杂局面，你通常通过清晰分析和可靠方法重新获得方向。', keywords: ['理性', '秩序', '深度'], suggestion: '不是所有体验都要先解释清楚，偶尔允许自己边走边感受。' },
    { id: 'purple', title: '紫色洞察者', description: '你对审美、象征和内在意义有天然感受力，容易看见事物表面之下的情绪与主题。你追求独特而真实的表达。', keywords: ['审美', '洞察', '意义感'], suggestion: '把深刻感受翻译成具体语言，别人会更容易走近你的世界。' },
  ],
  tieBreakOrder: ['red', 'orange', 'yellow', 'green', 'blue', 'purple'],
};

export const colorPersonalityDefinition = withAssessmentModes(
  colorPersonalityDefinitionBase,
  colorPersonalityDefinitionBase.questions.slice(0, 12).map((question) => question.id),
  3,
);
