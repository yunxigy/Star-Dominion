import type { AssessmentDefinition } from '../types';
import { agreementQuestion } from './builders';

export const romanticOrientationDefinition: AssessmentDefinition = {
  id: 'romantic-orientation-test',
  title: '浪漫倾向探索',
  subtitle: '分开观察浪漫心动、深度连接、低频体验与探索状态',
  group: 'orientation', questionCount: 18, estimatedMinutes: 4, mode: 'dimensions', sensitive: true,
  intro: '本测评建议 16+ 使用。浪漫吸引和性吸引并不总是同步；请按自己的真实感受作答，任何题目都可以跳过。',
  disclaimer: '结果仅供自我探索，不用于确认或诊断身份。浪漫倾向没有标准强度，你也无需为了结果采用任何标签。',
  minAnsweredRatio: 0.5,
  dimensions: [
    { id: 'frequentRomantic', label: '浪漫心动', color: '#b46d78', description: '较容易体验浪漫想象、心动与关系期待' },
    { id: 'bondFirst', label: '连接先行', color: '#697fa2', description: '通常需要信任与深度连接后才出现浪漫感受' },
    { id: 'lowRomantic', label: '低频浪漫', color: '#7d8877', description: '浪漫吸引较少，或并非生活与关系中的核心需要' },
    { id: 'fluidExploring', label: '流动探索', color: '#8d6f9d', description: '浪漫感受仍在观察，或会随时间和情境变化' },
  ],
  questions: [
    agreementQuestion('ro-01', '我比较容易对某个人产生浪漫心动。', 'frequentRomantic'),
    agreementQuestion('ro-02', '我通常要建立深度信任后，才可能出现浪漫感受。', 'bondFirst'),
    agreementQuestion('ro-03', '我很少体验到明确的浪漫吸引。', 'lowRomantic'),
    agreementQuestion('ro-04', '我对自己的浪漫倾向仍保留探索空间。', 'fluidExploring'),
    agreementQuestion('ro-05', '我会自然想象与喜欢的人建立带有浪漫意味的关系。', 'frequentRomantic'),
    agreementQuestion('ro-06', '缺少情感连接时，外在吸引通常不足以让我心动。', 'bondFirst'),
    agreementQuestion('ro-07', '即使没有浪漫关系，我也不觉得生活缺少关键部分。', 'lowRomantic'),
    agreementQuestion('ro-08', '我对浪漫的理解会随着经历逐渐变化。', 'fluidExploring'),
    agreementQuestion('ro-09', '浪漫仪式感常能让我感到期待。', 'frequentRomantic'),
    agreementQuestion('ro-10', '真正了解一个人之后，我才更可能产生浪漫想象。', 'bondFirst'),
    agreementQuestion('ro-11', '友情、家人或社群连接足以承载我许多重要情感。', 'lowRomantic'),
    agreementQuestion('ro-12', '常见的浪漫关系模板未必完全适合我。', 'fluidExploring'),
    agreementQuestion('ro-13', '我能清楚区分普通欣赏与浪漫心动。', 'frequentRomantic'),
    agreementQuestion('ro-14', '安全感与互相理解是我产生浪漫感受的重要前提。', 'bondFirst'),
    agreementQuestion('ro-15', '别人谈论强烈心动时，我不一定有相似体验。', 'lowRomantic'),
    agreementQuestion('ro-16', '我允许自己暂时不知道最适合的浪漫关系形态。', 'fluidExploring'),
    agreementQuestion('ro-17', '当我喜欢一个人时，浪漫表达通常是重要的一部分。', 'frequentRomantic'),
    agreementQuestion('ro-18', '比起迅速心动，我更习惯让关系慢慢长出意义。', 'bondFirst'),
  ],
  results: [
    { id: 'frequentRomantic', title: '浪漫心动线索较清晰', description: '你较容易觉察浪漫心动、想象和表达需求。它可以成为关系的重要语言，但并不要求你遵循固定模板。', keywords: ['浪漫心动', '情感表达', '关系想象'], suggestion: '把期待说得具体，同时为对方保留不同表达方式。' },
    { id: 'bondFirst', title: '深度连接通常先于心动', description: '对你而言，信任、理解与安全感可能是浪漫感受生长的重要土壤。慢热不是迟钝，而是一种形成连接的节奏。', keywords: ['连接先行', '信任', '慢热'], suggestion: '让重要的人知道你需要时间与稳定互动来确认感受。' },
    { id: 'lowRomantic', title: '浪漫吸引可能较低频', description: '浪漫吸引对你可能较少出现，或并非生活的中心。你依然可以拥有丰富、重要而多样的关系连接。', keywords: ['低频浪漫', '多元关系', '自足'], suggestion: '用自己的需要定义关系价值，不必复制主流脚本。' },
    { id: 'fluidExploring', title: '浪漫倾向仍在探索', description: '你可能尚未找到完全贴合的描述，或浪漫体验会随时期和关系变化。暂时开放并不意味着缺少答案。', keywords: ['开放探索', '流动体验', '允许不确定'], suggestion: '持续观察什么让你舒适、期待或感到压力。' },
  ],
};
