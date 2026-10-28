import type {
  AssessmentDefinition,
  AssessmentDimension,
  AssessmentResultProfile,
} from '../types';
import { getQuickQuestionIds, withAssessmentModes } from '../modes';
import { agreementQuestion } from './builders';

type PromptItem = string | readonly [prompt: string, reverse: boolean];

interface LegacyDefinitionConfig extends Omit<
  AssessmentDefinition,
  'questionCount' | 'estimatedMinutes' | 'questions' | 'results' | 'variants'
> {
  completeMinutes: number;
  quickMinutes: number;
  prompts: Record<string, readonly PromptItem[]>;
  titles?: Record<string, string>;
  quickPerDimension: number;
}

function makeProfiles(
  dimensions: AssessmentDimension[],
  titles: Record<string, string> = {},
): AssessmentResultProfile[] {
  return dimensions.map((dimension) => ({
    id: dimension.id,
    title: titles[dimension.id] ?? `${dimension.label}倾向`,
    description: `你的回答在“${dimension.label}”这条线索上相对突出。${dimension.description}结果反映的是本次回答中的相对倾向，不是固定标签。`,
    keywords: [dimension.label, '自我观察', '可练习'],
    suggestion: '把这条结果当作观察入口，结合最近的真实场景验证，而不是用它替你下结论。',
  }));
}

function makeAgreementDefinition(config: LegacyDefinitionConfig): AssessmentDefinition {
  const {
    prompts,
    completeMinutes,
    quickMinutes,
    quickPerDimension,
    titles,
    ...definitionFields
  } = config;
  const questions = definitionFields.dimensions.flatMap((dimension) => (
    (prompts[dimension.id] ?? []).map((item, index) => {
      const [prompt, reverse] = typeof item === 'string' ? [item, false] : item;
      return agreementQuestion(
        `${definitionFields.id}-${dimension.id}-${index + 1}`,
        prompt,
        dimension.id,
        reverse,
      );
    })
  ));
  const definition: AssessmentDefinition = {
    ...definitionFields,
    questionCount: questions.length,
    estimatedMinutes: completeMinutes,
    questions,
    results: makeProfiles(definitionFields.dimensions, titles),
  };

  return withAssessmentModes(
    definition,
    getQuickQuestionIds(
      questions,
      definition.dimensions.map((dimension) => dimension.id),
      quickPerDimension,
    ),
    quickMinutes,
  );
}

const bigFiveDimensions: AssessmentDimension[] = [
  { id: 'openness', label: '开放性', color: '#8b6f9e', description: '好奇、想象、审美与接纳新经验' },
  { id: 'conscientiousness', label: '尽责性', color: '#6f9364', description: '计划、自律、可靠与持续完成' },
  { id: 'extraversion', label: '外向性', color: '#c97932', description: '互动、表达、活力与外部刺激' },
  { id: 'agreeableness', label: '宜人性', color: '#a15f78', description: '信任、合作、体谅与关系温度' },
  { id: 'neuroticism', label: '情绪敏感度', color: '#71839b', description: '对压力、变化和负面情绪的敏感程度' },
];

export const bigFiveDefinition = makeAgreementDefinition({
  id: 'big-five-test',
  title: '大五人格测试',
  subtitle: '从五个维度看见自己的行为倾向与性格底色',
  group: 'personality',
  completeMinutes: 7,
  quickMinutes: 3,
  quickPerDimension: 2,
  mode: 'dimensions',
  sensitive: false,
  intro: '大五人格是一种描述性框架，不把人分成好坏。请根据最近一段时间的真实状态作答，尽量不要选择“理想中的自己”。',
  disclaimer: '结果仅供自我探索，不构成心理诊断、能力评定或职业决策依据。',
  minAnsweredRatio: 1,
  dimensions: bigFiveDimensions,
  prompts: {
    openness: [
      '我喜欢探索陌生主题，即使一开始看不出实际用途。',
      '艺术、设计或新鲜的表达方式容易引起我的兴趣。',
      '遇到不同于惯例的做法，我愿意先了解它为什么有效。',
      '我经常把看似无关的想法联结成新的可能。',
      ['我更愿意一直使用熟悉的方法，不太想尝试改变。', true],
    ],
    conscientiousness: [
      '我会把重要任务拆成清晰的步骤。',
      '即使没人监督，我也会尽量按约定完成事情。',
      '开始行动前，我通常会先确认优先级和截止时间。',
      '我会定期整理待办、资料或工作空间。',
      ['我常常把需要完成的事情拖到最后一刻。', true],
    ],
    extraversion: [
      '和人交流、分享想法会让我更容易进入状态。',
      '在陌生群体中，我通常能找到自然加入对话的机会。',
      '我愿意主动发起活动或邀请别人一起参与。',
      '热闹、有互动的环境常能让我保持活力。',
      ['长时间社交后，我通常只想完全避开任何交流。', true],
    ],
    agreeableness: [
      '我愿意先理解别人为什么会做出某个选择。',
      '团队合作时，我会关注彼此是否都能顺利推进。',
      '别人遇到困难时，我通常愿意提供力所能及的帮助。',
      '即使坚持自己的观点，我也会尽量保持尊重。',
      ['只要结果对我有利，别人的感受通常不太重要。', true],
    ],
    neuroticism: [
      '计划出现意外变化时，我的情绪容易明显波动。',
      '压力积累后，我需要一段时间才能恢复平稳。',
      '我会反复回想自己说错或做错的地方。',
      '不确定的等待容易让我感到紧张或不安。',
      ['遇到批评时，我通常很快就能放下，不会反复纠结。', true],
    ],
  },
  titles: {
    openness: '开放探索',
    conscientiousness: '可靠执行',
    extraversion: '外部能量',
    agreeableness: '合作共情',
    neuroticism: '情绪敏感度',
  },
});

const enneagramDimensions: AssessmentDimension[] = [
  { id: 'type1', label: '原则改进', color: '#b46d67', description: '重视标准、责任与把事情做得更好' },
  { id: 'type2', label: '助人连接', color: '#c77c65', description: '通过照顾、支持与被需要建立价值感' },
  { id: 'type3', label: '目标成就', color: '#c78b48', description: '追求成果、成长与被看见的能力' },
  { id: 'type4', label: '独特表达', color: '#9a6c91', description: '重视真实、意义与独特的内在体验' },
  { id: 'type5', label: '理解储备', color: '#6e8194', description: '通过观察、知识与独立空间获得安全感' },
  { id: 'type6', label: '安全忠诚', color: '#6f8d77', description: '重视可靠、预判风险与相互承诺' },
  { id: 'type7', label: '可能体验', color: '#d0954a', description: '追求选择、兴奋、新体验与未来可能' },
  { id: 'type8', label: '自主保护', color: '#b55a54', description: '重视力量、直接性与保护自己人的能力' },
  { id: 'type9', label: '和平整合', color: '#7c9b8c', description: '追求和谐、稳定与让各方都能共处' },
];

export const enneagramDefinition = makeAgreementDefinition({
  id: 'enneagram-test',
  title: '九型人格探索',
  subtitle: '从核心动机、压力反应与关系需要观察九种倾向',
  group: 'personality',
  completeMinutes: 8,
  quickMinutes: 3,
  quickPerDimension: 1,
  mode: 'dominant',
  sensitive: false,
  intro: '九型人格更适合用来观察“我为什么这样做”，而不是给自己贴上固定标签。选择最接近你长期动机的描述，而不是偶尔发生的行为。',
  disclaimer: '结果仅供自我探索和娱乐，不构成心理诊断、人格定论或专业建议。',
  minAnsweredRatio: 1,
  dimensions: enneagramDimensions,
  tieBreakOrder: enneagramDimensions.map((dimension) => dimension.id),
  prompts: {
    type1: ['看到可以改进的问题时，我很难完全不管。', '我会因为没有达到自己的标准而感到不踏实。', '即使没人要求，我也希望事情符合原则。'],
    type2: ['我很容易注意到别人需要什么帮助。', '被重要的人需要，会让我感觉自己有价值。', '我有时先照顾别人，之后才想起自己的需要。'],
    type3: ['我会自然地为自己设定一个可衡量的目标。', '完成成果并得到认可，会明显提升我的动力。', '我倾向于调整呈现方式，让别人看见我的能力。'],
    type4: ['我很在意一件事是否真正符合自己的感受。', '平凡重复的生活容易让我想寻找更独特的表达。', '我会长时间体会一段经历对自己的意义。'],
    type5: ['面对新问题，我会先收集足够的信息再投入。', '我需要独处时间来恢复和整理想法。', '理解事物的原理本身就会让我感到满足。'],
    type6: ['做决定前，我会先想想可能出现的风险。', '可靠的承诺和清晰的规则能让我安心。', '当我不确定时，我会寻找值得信任的人确认。'],
    type7: ['我很容易被新计划、新地点或新体验吸引。', '遇到不舒服的情绪时，我会倾向于寻找别的可能。', '选择越多，我越容易保持兴奋和活力。'],
    type8: ['遇到不公平时，我通常愿意直接站出来。', '我希望自己有足够的力量保护重要的人和事。', '我不喜欢别人替我决定，也不喜欢过度被控制。'],
    type9: ['我会自然地寻找不同观点之间的共同点。', '相比争论输赢，我更希望大家能继续相处。', '我需要稳定、平和的节奏才能发挥得好。'],
  },
  titles: {
    type1: '原则改进型',
    type2: '温暖助人型',
    type3: '目标成就型',
    type4: '独特表达型',
    type5: '深度观察型',
    type6: '安全忠诚型',
    type7: '可能体验型',
    type8: '自主保护型',
    type9: '和平整合型',
  },
});

const attachmentDimensions: AssessmentDimension[] = [
  { id: 'secure', label: '安全连接', color: '#6f9364', description: '能够在亲近与独立之间保持弹性' },
  { id: 'anxious', label: '确认需要', color: '#b46d67', description: '对回应、稳定与关系确定感较敏感' },
  { id: 'avoidant', label: '自主防护', color: '#6e8194', description: '重视边界、独立和降低过度依赖' },
  { id: 'fearful', label: '靠近警觉', color: '#8b6f9e', description: '渴望连接，同时对受伤或失控保持谨慎' },
];

export const attachmentStyleDefinition = makeAgreementDefinition({
  id: 'attachment-style-test',
  title: '依恋互动风格',
  subtitle: '观察你在亲密关系中的安全感、边界和回应需要',
  group: 'personality',
  completeMinutes: 7,
  quickMinutes: 3,
  quickPerDimension: 2,
  mode: 'dominant',
  sensitive: false,
  intro: '依恋风格会受到关系对象、阶段和经历影响，不是永久不变的性格标签。请结合最近的亲密互动回答。',
  disclaimer: '结果仅供关系自我观察，不构成心理诊断、关系判断或专业建议。',
  minAnsweredRatio: 1,
  dimensions: attachmentDimensions,
  tieBreakOrder: attachmentDimensions.map((dimension) => dimension.id),
  prompts: {
    secure: ['我能在需要时向重要的人寻求支持。', '关系出现分歧时，我相信问题可以被说清楚。', '亲近的人拥有自己的空间，不会让我自动感到被抛下。', '我能表达喜欢，也能表达不舒服。', '我通常能在独处和陪伴之间找到合适节奏。', '即使关系暂时有距离，我也能保持基本信任。'],
    anxious: ['对方回复变慢时，我容易猜测是不是关系出了问题。', '我需要比较明确的回应，才能安心投入一段关系。', '我会反复确认自己是否仍被在乎。', ['我很少在意关系中的细微变化。', true], '我担心自己的需要太多，会让对方离开。', '关系不确定时，我很难把注意力放回自己的生活。'],
    avoidant: ['我更习惯自己消化情绪，不太主动求助。', '关系过于密集时，我会想要拉开距离。', '我很重视保留不被打扰的个人空间。', ['我可以很自然地把脆弱和需要告诉别人。', true], '我不喜欢别人过多介入我的决定。', '即使亲近，我也希望自己的生活保持高度独立。'],
    fearful: ['我期待亲密，但真正靠近时又会担心受伤。', '我有时会因为害怕失望而提前降低期待。', '关系变得重要后，我反而更容易保持警惕。', ['我很容易完全相信新认识的人。', true], '我可能一边想被理解，一边又不知如何回应靠近。', '冲突会让我同时想解释和逃开。'],
  },
  titles: {
    secure: '弹性安全型',
    anxious: '回应确认型',
    avoidant: '自主防护型',
    fearful: '靠近警觉型',
  },
});

const loveLanguageDimensions: AssessmentDimension[] = [
  { id: 'words', label: '肯定表达', color: '#b46d78', description: '通过语言、认可和明确表达感受到重视' },
  { id: 'qualityTime', label: '专属时光', color: '#697fa2', description: '通过专注陪伴和共同经历建立连接' },
  { id: 'gifts', label: '心意礼物', color: '#c78b48', description: '通过有针对性的物品与纪念感表达在乎' },
  { id: 'acts', label: '实际行动', color: '#6f9364', description: '通过分担、照料和解决问题感受到支持' },
  { id: 'touch', label: '身体亲近', color: '#9a6c91', description: '通过拥抱、牵手和舒适的身体靠近建立安全感' },
];

export const loveLanguageDefinition = makeAgreementDefinition({
  id: 'love-language-test',
  title: '爱的表达偏好',
  subtitle: '发现你更容易接收和表达在乎的方式',
  group: 'personality',
  completeMinutes: 7,
  quickMinutes: 3,
  quickPerDimension: 2,
  mode: 'dominant',
  sensitive: false,
  intro: '表达偏好不是关系规则，也不是判断谁更爱你的标准。请想想什么行为最容易让你感到被认真对待。',
  disclaimer: '结果仅供关系沟通和自我探索，不构成对你或他人的固定判断。',
  minAnsweredRatio: 1,
  dimensions: loveLanguageDimensions,
  tieBreakOrder: loveLanguageDimensions.map((dimension) => dimension.id),
  prompts: {
    words: ['一句具体而真诚的肯定，会让我记很久。', '我希望重要的人直接说出欣赏、感谢或想念。', '冲突后，听到清楚的解释和确认会让我安心。', '我会通过鼓励和赞美表达自己的在乎。', '模糊的态度比暂时没空更容易让我不安。'],
    qualityTime: ['对方愿意放下手机专心陪我，会让我感到被重视。', '共同完成一件小事，常比收到东西更让我开心。', '我喜欢和重要的人安排只属于彼此的时间。', '即使只是散步聊天，只要专注就很有意义。', '关系忙碌时，我最希望重新安排一段不被打断的时间。'],
    gifts: ['一件明显根据我喜好挑选的礼物，会让我感到被记得。', '我喜欢为重要的人准备有纪念意义的小物件。', '物品背后的故事和心思，对我来说比价格重要。', '看到对方在特别日子准备了小惊喜，我会很受触动。', '我会把有特殊意义的礼物保存很久。'],
    acts: ['有人主动分担一件麻烦事，会让我感到可靠。', '我更容易从具体行动判断对方是否把我放在心上。', '对方注意到我的负担并帮忙处理，会让我很感动。', '我会通过照顾日常细节表达关心。', '在我忙不过来时，实际支持比口头安慰更有帮助。'],
    touch: ['拥抱、牵手等舒服的身体接触能让我快速放松。', '见面时自然的靠近会让我感觉关系有温度。', '我会用合适的身体亲近表达安慰和喜欢。', '低落时，一个被尊重的拥抱可能胜过很多话。', '我希望亲密互动始终建立在双方舒服和同意的基础上。'],
  },
  titles: {
    words: '肯定表达偏好',
    qualityTime: '专属时光偏好',
    gifts: '心意礼物偏好',
    acts: '实际行动偏好',
    touch: '身体亲近偏好',
  },
});

const careerDimensions: AssessmentDimension[] = [
  { id: 'realistic', label: '实践型 R', color: '#b46d67', description: '喜欢动手、设备、材料和看得见的成果' },
  { id: 'investigative', label: '研究型 I', color: '#537b98', description: '喜欢分析问题、寻找原理和验证假设' },
  { id: 'artistic', label: '艺术型 A', color: '#9a6c91', description: '喜欢创作、审美、表达和开放的形式' },
  { id: 'social', label: '社会型 S', color: '#6f9364', description: '喜欢支持、教学、沟通和促进他人成长' },
  { id: 'enterprising', label: '企业型 E', color: '#c78b48', description: '喜欢推动目标、影响他人和组织资源' },
  { id: 'conventional', label: '常规型 C', color: '#71839b', description: '喜欢结构、准确、流程和稳定的管理方式' },
];

export const careerInterestDefinition = makeAgreementDefinition({
  id: 'career-interest-test',
  title: '职业兴趣六型探索',
  subtitle: '用 RIASEC 六种兴趣线索寻找更有能量的工作场景',
  group: 'personality',
  completeMinutes: 7,
  quickMinutes: 3,
  quickPerDimension: 2,
  mode: 'dimensions',
  sensitive: false,
  intro: '职业兴趣描述“什么活动更容易让你投入”，不等于能力、专业或适合职业清单。请按你愿意长期接触的活动作答。',
  disclaimer: '结果仅供职业探索，不构成测评认证、录用判断或职业规划结论。',
  minAnsweredRatio: 1,
  dimensions: careerDimensions,
  prompts: {
    realistic: ['我喜欢使用工具、设备或材料把想法做出来。', '解决一个具体的实际问题会让我很有成就感。', '我愿意学习操作流程，并通过练习提高熟练度。', '比起只讨论，我更喜欢看到可以检验的实物或结果。'],
    investigative: ['我喜欢追问事情背后的原理和因果关系。', '遇到问题时，我会享受收集资料和验证假设。', '复杂数据或难题会激发我的好奇心。', '我愿意为弄懂一个问题投入较长时间。'],
    artistic: ['我喜欢用文字、图像、声音或形式表达独特想法。', '我希望工作过程保留一定的自由和创造空间。', '审美、氛围和表达方式会影响我对项目的投入。', '我常能想到不止一种新颖的呈现方案。'],
    social: ['帮助别人理解、学习或成长会让我感到有意义。', '我愿意倾听不同处境的人，并寻找支持方式。', '团队中我常关注成员是否都能参与进来。', '我喜欢通过交流促进理解和合作。'],
    enterprising: ['我喜欢把一个模糊想法推进成明确的目标。', '说服、谈判或带动他人参与对我来说有吸引力。', '面对资源有限的情况，我愿意主动争取机会。', '我享受承担责任并看到团队取得进展。'],
    conventional: ['我喜欢把资料、流程或任务整理得清楚准确。', '稳定的规则和明确的标准能让我发挥得更好。', '我会主动检查细节，减少遗漏和错误。', '维护一套可靠的记录或系统会让我感到踏实。'],
  },
  titles: {
    realistic: '实践型兴趣',
    investigative: '研究型兴趣',
    artistic: '艺术型兴趣',
    social: '社会型兴趣',
    enterprising: '企业型兴趣',
    conventional: '常规型兴趣',
  },
});

const discDimensions: AssessmentDimension[] = [
  { id: 'dominance', label: '支配 D', color: '#b45b4f', description: '直接、果断，关注目标和推进速度' },
  { id: 'influence', label: '影响 I', color: '#c78b48', description: '热情、表达，关注互动和现场感染力' },
  { id: 'steadiness', label: '稳健 S', color: '#6f9364', description: '耐心、可靠，关注支持和稳定节奏' },
  { id: 'conscientiousness', label: '谨慎 C', color: '#537b98', description: '准确、审慎，关注标准和事实依据' },
];

export const discDefinition = makeAgreementDefinition({
  id: 'disc-test',
  title: 'DISC 行为风格探索',
  subtitle: '了解你在目标、互动、稳定与规则之间的行为偏好',
  group: 'personality',
  completeMinutes: 7,
  quickMinutes: 3,
  quickPerDimension: 2,
  mode: 'dominant',
  sensitive: false,
  intro: 'DISC 更像行为风格镜子：同一个人在不同角色与压力下也可能切换。请按你最常用的工作和协作方式回答。',
  disclaimer: '结果仅供沟通和自我探索，不是能力认证、招聘依据或心理诊断。',
  minAnsweredRatio: 1,
  dimensions: discDimensions,
  tieBreakOrder: discDimensions.map((dimension) => dimension.id),
  prompts: {
    dominance: ['目标明确时，我会很快做出决定并推动行动。', '遇到阻力时，我倾向于直接面对问题。', '我愿意承担结果，而不是一直等待更完美的条件。', '效率和进展通常比过程舒适更能激励我。', '在讨论中，我会自然地表达自己的立场。', '为了达成重要目标，我能接受一定的不确定性。'],
    influence: ['我常通过热情表达让别人愿意参与。', '新认识的人通常不难和我聊起来。', '我喜欢在团队中分享想法和鼓舞气氛。', '获得现场回应会让我更有动力。', '我会用故事、例子或幽默让观点更容易被听见。', '我喜欢把一个普通计划变成大家期待的体验。'],
    steadiness: ['我会持续陪伴团队把事情稳稳做完。', '变化发生时，我通常先关注大家能否适应。', '我喜欢可靠、可预期的合作节奏。', '别人需要耐心倾听时，我愿意留出时间。', '我不急于抢先表达，但会认真跟进承诺。', '长期积累和稳定改进对我很有吸引力。'],
    conscientiousness: ['我会先确认标准、事实和边界，再开始行动。', '发现细节错误时，我通常会停下来修正。', '我希望做出的结果经得起检查和复盘。', '面对复杂任务，我会建立清晰的结构。', '我会谨慎比较不同方案的风险和证据。', '即使进度变慢，我也不愿牺牲关键质量。'],
  },
  titles: {
    dominance: '目标推动型',
    influence: '互动影响型',
    steadiness: '稳定支持型',
    conscientiousness: '审慎分析型',
  },
});

const procrastinationDimensions: AssessmentDimension[] = [
  { id: 'activation', label: '启动阻力', color: '#b46d67', description: '面对任务开始阶段的清晰度和行动阻力' },
  { id: 'perfectionism', label: '完美压力', color: '#8b6f9e', description: '对犯错、评价和达不到标准的敏感程度' },
  { id: 'distraction', label: '即时诱惑', color: '#c78b48', description: '注意力被新鲜刺激和短期回报带走的程度' },
  { id: 'energy', label: '能量节奏', color: '#6f9364', description: '睡眠、精力与任务安排之间的匹配程度' },
];

export const procrastinationDefinition = makeAgreementDefinition({
  id: 'procrastination-test',
  title: '拖延模式探索',
  subtitle: '找出让你卡住的环节，把“自责”换成可调整的线索',
  group: 'personality',
  completeMinutes: 7,
  quickMinutes: 3,
  quickPerDimension: 2,
  mode: 'dimensions',
  sensitive: false,
  intro: '拖延通常不只是懒惰，也可能和任务不清晰、害怕评价、即时诱惑或精力不足有关。请按最近一个月的真实情况作答。',
  disclaimer: '结果仅供行为观察，不构成心理诊断、治疗判断或对个人意志力的评价。',
  minAnsweredRatio: 1,
  dimensions: procrastinationDimensions,
  prompts: {
    activation: ['任务越模糊，我越难迈出第一步。', '我常常知道要做什么，却迟迟没有开始。', '把任务拆成一个很小的动作，会明显帮助我启动。', '我容易花很多时间准备，却没有真正进入执行。', '面对需要长期投入的事情，我常等到紧迫才行动。', '如果第一步足够清晰，我通常能顺利开始。'],
    perfectionism: ['我担心做得不够好，所以迟迟不愿交出初稿。', '任务越重要，我越容易害怕犯错。', '我会因为不知道怎样做到最好而暂时逃开。', '收到评价前，我常反复修改已经足够好的内容。', '我能接受先完成一个不完美但可改进的版本。', ['只要不能一次做到完美，我就宁愿不开始。', false]],
    distraction: ['手机、短视频或即时消息很容易打断我的计划。', '我会用整理、浏览或其他小事逃避困难任务。', '短期有趣的事情常比长期目标更能吸引我。', '工作卡住时，我很快会寻找新的刺激。', '我能为专注安排一个不被打扰的时间段。', '我会把容易分心的入口提前移开。'],
    energy: ['睡眠不足时，我很难维持原本的执行节奏。', '我常在精力最低的时候安排最重要的任务。', '规律吃饭、休息或运动会明显影响我的行动力。', '忙了一段时间后，我需要先恢复能量再继续。', '我能根据当天状态调整任务难度和顺序。', '我会为长期目标留出可持续而不是透支的节奏。'],
  },
  titles: {
    activation: '启动阻力线索',
    perfectionism: '完美压力线索',
    distraction: '即时诱惑线索',
    energy: '能量节奏线索',
  },
});

const socialAnxietyDimensions: AssessmentDimension[] = [
  { id: 'anticipation', label: '预期紧张', color: '#b46d67', description: '在社交前对评价、尴尬或出错的担忧' },
  { id: 'avoidance', label: '回避压力', color: '#8b6f9e', description: '为了降低不适而减少参与或表达的倾向' },
  { id: 'selfFocus', label: '自我聚焦', color: '#c78b48', description: '社交中对自己表现和他人反应的过度关注' },
  { id: 'recovery', label: '恢复弹性', color: '#6f9364', description: '社交结束后回到平稳状态、复盘并继续生活的能力' },
];

export const socialAnxietyDefinition = makeAgreementDefinition({
  id: 'social-anxiety-test',
  title: '社交紧张度自测',
  subtitle: '了解社交前后让你消耗的环节与可以练习的空间',
  group: 'personality',
  completeMinutes: 7,
  quickMinutes: 3,
  quickPerDimension: 2,
  mode: 'dimensions',
  sensitive: false,
  intro: '这是一份非临床的自我观察练习。请根据最近一段时间的常见感受作答，不需要用结果给自己下诊断。',
  disclaimer: '结果仅供自我观察，不是社交焦虑诊断或治疗替代；如果困扰持续影响生活，建议寻求专业支持。',
  minAnsweredRatio: 1,
  dimensions: socialAnxietyDimensions,
  prompts: {
    anticipation: ['参加陌生场合前，我会提前担心自己表现不好。', '需要主动发言时，我的身体容易出现紧张反应。', '和不熟悉的人见面前，我会反复想象可能出错的地方。', '即使是普通的社交邀约，也可能让我提前消耗很多精力。', '临时被邀请表达观点时，我会明显感到压力。', '社交安排越重要，我越容易在之前睡不好或坐立不安。'],
    avoidance: ['我会因为担心尴尬而放弃本来想参加的活动。', '在群体中，我常选择不说话以免引起注意。', '需要打电话、询问或求助时，我会拖很久。', '我会尽量避开可能被评价的场合。', '即使有想法，我也可能因为害怕回应而不表达。', '如果可以选择，我常用文字代替当面沟通。'],
    selfFocus: ['社交时，我会不断检查自己的语气、表情或动作。', '别人短暂沉默时，我容易以为自己说错了话。', '一次小失误可能让我之后反复回想。', '我很难把注意力完全放在对话内容上。', '我常猜测别人是不是觉得我不自然。', '我会把普通的社交细节理解成对自己的负面评价。'],
    recovery: [['社交结束后，我通常很快就能回到自己的节奏。', true], ['我能提醒自己：一次不完美的交流并不代表什么。', true], ['即使有点紧张，我也能完成必要的沟通。', true], ['我会从真实反馈中调整，而不是只靠猜测。', true], ['参加过一次活动后，我愿意再次尝试类似场景。', true], ['社交中的不舒服通常不会影响我接下来的生活。', true]],
  },
  titles: {
    anticipation: '社交前预期',
    avoidance: '参与回避压力',
    selfFocus: '自我聚焦压力',
    recovery: '恢复弹性',
  },
});

const learningStyleDimensions: AssessmentDimension[] = [
  { id: 'visual', label: '视觉输入', color: '#8b6f9e', description: '通过图示、空间结构和视觉线索建立理解' },
  { id: 'auditory', label: '听说互动', color: '#b46d67', description: '通过讲解、讨论、复述和声音节奏吸收内容' },
  { id: 'kinesthetic', label: '实践体验', color: '#6f9364', description: '通过操作、演示、试错和身体参与学习' },
  { id: 'reading', label: '阅读整理', color: '#537b98', description: '通过文字、笔记、提纲和书写巩固知识' },
];

export const learningStyleDefinition = makeAgreementDefinition({
  id: 'learning-style-test',
  title: '学习方式偏好',
  subtitle: '发现你更容易进入状态、理解和记住内容的路径',
  group: 'personality',
  completeMinutes: 7,
  quickMinutes: 3,
  quickPerDimension: 2,
  mode: 'dimensions',
  sensitive: false,
  intro: '学习方式不是固定类型，复杂任务往往需要混合使用多种通道。请按你实际学得顺手的方式回答，而不是按别人建议的方式。',
  disclaimer: '结果仅供学习习惯探索，不代表固定能力，也不限制你发展其他学习方式。',
  minAnsweredRatio: 1,
  dimensions: learningStyleDimensions,
  prompts: {
    visual: ['图表、流程图或示意图能帮助我迅速抓住重点。', '我会用颜色、位置或画面记住信息。', '看别人演示一遍后，我通常更容易开始尝试。', '我喜欢把抽象概念转换成结构图或空间关系。', '复习时，看到页面布局就能想起相关内容。', '视频、动画或实例画面能明显提升我的理解。'],
    auditory: ['听别人完整讲解，比只看文字更容易让我理解。', '和别人讨论后，我常能发现自己原来没想清楚的地方。', '把内容讲给别人听，会帮助我记得更牢。', '我会通过朗读、录音或节奏记忆重要信息。', '提问和即时交流对我的学习效率影响很大。', '听到一个清晰的类比或故事，我会很快建立理解。'],
    kinesthetic: ['亲手操作一次后，我通常比只看说明更容易掌握。', '我喜欢通过实验、练习或模拟来学习。', '学习太久不动时，我的注意力会明显下降。', '我会在试错过程中逐渐找到适合自己的方法。', '把知识应用到真实任务中，会让我记得最牢。', '我喜欢边做边调整，而不是先把所有理论读完。'],
    reading: ['我喜欢阅读完整文字材料后再形成自己的理解。', '写笔记、列提纲或做摘要能帮我整理思路。', '我会通过查词、标注和重写来消化复杂内容。', '面对新主题，我常先寻找一份结构清楚的资料。', '把知识写成清单或步骤，会让我更有掌控感。', '复习时，自己整理过的文字比现成内容更有用。'],
  },
  titles: {
    visual: '视觉输入偏好',
    auditory: '听说互动偏好',
    kinesthetic: '实践体验偏好',
    reading: '阅读整理偏好',
  },
});

const emotionalStabilityDimensions: AssessmentDimension[] = [
  { id: 'calm', label: '冷静底盘', color: '#6f9364', description: '突发状况下维持清晰判断和基本节奏' },
  { id: 'regulation', label: '调节能力', color: '#537b98', description: '在情绪升高后暂停、选择与恢复的能力' },
  { id: 'perspective', label: '视角弹性', color: '#8b6f9e', description: '面对批评、变化和不确定时调整解释的能力' },
  { id: 'recovery', label: '恢复速度', color: '#c78b48', description: '经历压力或挫折后回到日常状态的速度' },
];

export const emotionalStabilityDefinition = makeAgreementDefinition({
  id: 'emotional-stability-test',
  title: '情绪稳定性自测',
  subtitle: '从冷静、调节、视角与恢复四个角度观察自己的状态',
  group: 'personality',
  completeMinutes: 7,
  quickMinutes: 3,
  quickPerDimension: 2,
  mode: 'dimensions',
  sensitive: false,
  intro: '情绪稳定不是没有情绪，而是能在情绪中逐渐找回选择。请按最近一段时间的常见状态作答，并给自己保留变化空间。',
  disclaimer: '结果仅供自我探索，不构成心理诊断、治疗判断或情绪能力认证。',
  minAnsweredRatio: 1,
  dimensions: emotionalStabilityDimensions,
  prompts: {
    calm: ['遇到突发状况时，我通常能先处理最重要的事情。', '压力出现时，我还能保持基本的工作和生活节奏。', '别人情绪激烈时，我不容易立刻被带着失去判断。', '我能在紧急情况下把注意力放在眼前可做的事上。', '事情混乱时，我会尝试先建立一个简单秩序。', '我通常不会因为一件小事完全打乱整天状态。'],
    regulation: ['情绪上来时，我能给自己留出暂停的时间。', '我知道几种对自己有效的放松或恢复方式。', '我会在反应之前先判断自己现在真正需要什么。', '即使生气，我也能尽量避免做出伤害性的决定。', '我能通过呼吸、走动、记录或沟通逐步调节状态。', '我愿意承认情绪，而不是只靠压住它继续做事。'],
    perspective: ['面对批评时，我能区分有用信息和个人否定。', '计划改变后，我通常能重新寻找可行方案。', '我会提醒自己，一次失败不等于整个人失败。', '面对不确定性，我能接受暂时没有答案。', '我愿意从不同角度重新理解一段不舒服的经历。', '我不太会把别人的一句话直接解释成最坏的意思。'],
    recovery: ['经历挫折后，我通常能在一段时间内重新行动。', '情绪过去后，我能把注意力慢慢放回生活。', '我会从低谷经验中总结下次可以使用的方法。', '疲惫时，我知道什么时候应该休息而不是硬撑。', '我能向信任的人表达状态并获得支持。', '即使还没有完全恢复，我也能完成必要的日常。'],
  },
  titles: {
    calm: '冷静底盘',
    regulation: '主动调节',
    perspective: '视角弹性',
    recovery: '恢复弹性',
  },
});
