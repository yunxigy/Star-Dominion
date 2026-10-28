import type { AssessmentDefinition } from '../types';
import { withAssessmentModes } from '../modes';
import { agreementQuestion } from './builders';

const orientationSpectrumDefinitionBase: AssessmentDefinition = {
  id: 'orientation-spectrum-test',
  title: '吸引倾向光谱探索',
  subtitle: '温和观察性吸引可能指向哪里，以及它是否稳定或低频',
  group: 'orientation',
  questionCount: 24,
  estimatedMinutes: 6,
  mode: 'dimensions',
  sensitive: true,
  intro: '本测评建议 16+ 使用。请按最近一段时间真实、舒服的感受作答；任何题目都可以跳过，也不需要急着选择身份标签。',
  disclaimer: '结果仅供自我探索，不用于确认或诊断身份，也不能替代你对自身经历的长期理解。吸引倾向可以复杂、流动或暂时不确定。',
  minAnsweredRatio: 0.5,
  dimensions: [
    { id: 'sameGender', label: '同性吸引线索', color: '#9a647c', description: '对与自己相同性别的人产生性吸引或亲密想象的可能性' },
    { id: 'differentGender', label: '异性吸引线索', color: '#557e7a', description: '对与自己不同性别的人产生性吸引或亲密想象的可能性' },
    { id: 'multiGender', label: '多性别吸引线索', color: '#8a6c9e', description: '吸引并不只由单一性别范围决定的可能性' },
    { id: 'lowAttraction', label: '低频吸引线索', color: '#7f8792', description: '性吸引较少、较弱，或并非亲密关系核心的可能性' },
    { id: 'fluidExploring', label: '流动与探索', color: '#b17762', description: '目前仍在观察，或感受会随时间与情境变化' },
  ],
  questions: [
    agreementQuestion('os-01', '我可能对与自己相同性别的人产生性吸引。', 'sameGender'),
    agreementQuestion('os-02', '我可能对与自己不同性别的人产生性吸引。', 'differentGender'),
    agreementQuestion('os-03', '对我而言，吸引未必取决于对方属于哪一种性别。', 'multiGender'),
    agreementQuestion('os-04', '我很少体验到明确的性吸引。', 'lowAttraction'),
    agreementQuestion('os-05', '我愿意让自己的倾向保持开放或继续探索。', 'fluidExploring'),
    agreementQuestion('os-06', '想象亲密关系时，与自己相同性别的人也可能自然地出现。', 'sameGender'),
    agreementQuestion('os-07', '想象亲密关系时，与自己不同性别的人更容易自然地出现。', 'differentGender'),
    agreementQuestion('os-08', '我曾意识到自己可能被不止一种性别的人吸引。', 'multiGender'),
    agreementQuestion('os-09', '我常能欣赏一个人，却不一定伴随性吸引。', 'lowAttraction'),
    agreementQuestion('os-10', '我的吸引模式可能会随时间或关系情境变化。', 'fluidExploring'),
    agreementQuestion('os-11', '情感或审美上的亲近对我很重要，即使没有性吸引。', 'lowAttraction'),
    agreementQuestion('os-12', '比起性别，我更容易先被一个人的个性与连接感吸引。', 'multiGender'),
    agreementQuestion('os-13', '我愿意承认自己对相同性别存在吸引的可能。', 'sameGender'),
    agreementQuestion('os-14', '我愿意承认自己对不同性别存在吸引的可能。', 'differentGender'),
    agreementQuestion('os-15', '即使长期很少出现性吸引，我也能接纳这种状态。', 'lowAttraction'),
    agreementQuestion('os-16', '现有的常见标签未必能完整描述我。', 'fluidExploring'),
    agreementQuestion('os-17', '当我诚实观察感受时，同性吸引是值得被看见的一部分。', 'sameGender'),
    agreementQuestion('os-18', '我更重视实际出现的感受，而不是先套用固定结论。', 'differentGender'),
    agreementQuestion('os-19', '我愿意诚实观察自己对同性别者的心动或亲密想象。', 'sameGender'),
    agreementQuestion('os-20', '我愿意诚实观察自己对不同性别者的心动或亲密想象。', 'differentGender'),
    agreementQuestion('os-21', '我认为吸引可以同时受到个体特质和性别范围的影响。', 'multiGender'),
    agreementQuestion('os-22', '没有明确性吸引时，我也能认可自己的亲密需要。', 'lowAttraction'),
    agreementQuestion('os-23', '我允许自己的理解随着新的感受慢慢调整。', 'fluidExploring'),
    agreementQuestion('os-24', '我不需要为了让别人理解而马上确定一个标签。', 'fluidExploring'),
  ],
  results: [
    { id: 'sameGender', title: '同性吸引线索较清晰', description: '你的回答里，对相同性别的吸引线索相对更容易被你觉察。这只是当前感受的一个侧面，不要求你立刻采用任何身份标签。', keywords: ['同性线索', '真实感受', '自我接纳'], suggestion: '可以继续记录让你感到心动、亲近或舒适的具体时刻。' },
    { id: 'differentGender', title: '异性吸引线索较清晰', description: '你的回答里，对不同性别的吸引线索相对更明确。结果描述的是当前模式，不代表未来必须保持不变。', keywords: ['异性线索', '当前模式', '开放观察'], suggestion: '区分社会期待与自己的实际感受，会让理解更稳固。' },
    { id: 'multiGender', title: '多性别吸引线索较清晰', description: '你可能更容易被不止一种性别的人吸引，或认为性别不是吸引的唯一条件。每个人的范围与强度都可以不同。', keywords: ['多元吸引', '连接优先', '个体差异'], suggestion: '不必用别人的比例或经历来验证自己的感受。' },
    { id: 'lowAttraction', title: '低频吸引线索较清晰', description: '性吸引对你而言可能较少、较弱，或不是建立亲密连接的核心。低频并不等于缺陷，也不否定情感与关系需要。', keywords: ['低频吸引', '情感连接', '尊重节奏'], suggestion: '允许自己按真实节奏理解亲密，而不是追赶外界标准。' },
    { id: 'fluidExploring', title: '仍在探索或感受较流动', description: '你可能仍在理解自己的吸引模式，或发现它会随时间与情境变化。不确定本身也是有效状态。', keywords: ['持续探索', '流动感', '允许不确定'], suggestion: '给自己时间，把标签当作可选工具而不是必须交出的答案。' },
  ],
};

export const orientationSpectrumDefinition = withAssessmentModes(
  orientationSpectrumDefinitionBase,
  orientationSpectrumDefinitionBase.questions.slice(0, 12).map((question) => question.id),
  3,
);
