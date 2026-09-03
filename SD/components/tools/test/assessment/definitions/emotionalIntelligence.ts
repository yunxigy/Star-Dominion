import type { AssessmentDefinition } from '../types';
import { withAssessmentModes } from '../modes';
import { agreementQuestion } from './builders';

const emotionalIntelligenceDefinitionBase: AssessmentDefinition = {
  id: 'emotional-intelligence-test',
  title: '情绪智力测试',
  subtitle: '从觉察、调节、共情和关系管理四个维度认识自己',
  group: 'personality', questionCount: 24, estimatedMinutes: 6, mode: 'dimensions', sensitive: false,
  intro: '情绪智力不是固定天赋，而是一组可以练习的能力。请按近期真实表现作答，不必选择你认为更成熟的答案。',
  disclaimer: '结果仅供自我探索，不用于心理诊断、治疗判断或能力认证。',
  minAnsweredRatio: 1,
  dimensions: [
    { id: 'awareness', label: '自我觉察', color: '#9a647c', description: '识别自己的情绪、触发点与身体信号' },
    { id: 'regulation', label: '自我调节', color: '#557e7a', description: '在情绪中暂停、选择并逐步恢复' },
    { id: 'empathy', label: '共情理解', color: '#b06a52', description: '理解他人的感受、处境与差异' },
    { id: 'relationship', label: '关系管理', color: '#718d5e', description: '表达需要、修复冲突并建立支持' },
  ],
  questions: [
    agreementQuestion('eq-01', '我能较准确地说出自己当下是什么情绪。', 'awareness'),
    agreementQuestion('eq-02', '情绪上来时，我通常能先停一下再行动。', 'regulation'),
    agreementQuestion('eq-03', '即使观点不同，我也能理解对方为何那样感受。', 'empathy'),
    agreementQuestion('eq-04', '我能在不指责的情况下表达自己的需要。', 'relationship'),
    agreementQuestion('eq-05', '我会留意紧张、疲惫等身体信号与情绪的关系。', 'awareness'),
    agreementQuestion('eq-06', '压力事件结束后，我有办法逐步恢复平稳。', 'regulation'),
    agreementQuestion('eq-07', '倾听时，我会确认自己有没有理解错对方。', 'empathy'),
    agreementQuestion('eq-08', '发生冲突后，我愿意主动寻找修复关系的方式。', 'relationship'),
    agreementQuestion('eq-09', '我常在情绪爆发后才意识到自己早已不舒服。', 'awareness', true),
    agreementQuestion('eq-10', '一旦生气或焦虑，我很难阻止自己立刻反应。', 'regulation', true),
    agreementQuestion('eq-11', '别人表达感受时，我容易觉得他们反应过度。', 'empathy', true),
    agreementQuestion('eq-12', '我宁愿长期忍耐，也很少向别人提出支持请求。', 'relationship', true),
    agreementQuestion('eq-13', '我能分辨情绪背后真正重要的需要。', 'awareness'),
    agreementQuestion('eq-14', '计划被打乱时，我能重新调整而不是一直困住。', 'regulation'),
    agreementQuestion('eq-15', '只要事情与我无关，我通常不会在意对方的处境。', 'empathy', true),
    agreementQuestion('eq-16', '关系紧张时，我常回避沟通直到问题自行消失。', 'relationship', true),
    agreementQuestion('eq-17', '我的情绪变化经常让我自己也摸不着头脑。', 'awareness', true),
    agreementQuestion('eq-18', '受到刺激后，我常需要很久才能停止反复回想。', 'regulation', true),
    agreementQuestion('eq-19', '我能分辨“我现在感到什么”和“我需要什么”之间的区别。', 'awareness'),
    agreementQuestion('eq-20', '情绪强烈时，我会先选择一个能让我缓下来的动作。', 'regulation'),
    agreementQuestion('eq-21', '我会考虑同一件事对不同人的意义可能不一样。', 'empathy'),
    agreementQuestion('eq-22', '我能把自己的边界和期待说得让对方听得懂。', 'relationship'),
    agreementQuestion('eq-23', '我常把情绪当成麻烦，直到它积累到无法忽略。', 'awareness', true),
    agreementQuestion('eq-24', '关系出现误会时，我愿意尽早澄清而不是冷处理。', 'relationship'),
  ],
  results: [
    { id: 'awareness', title: '自我觉察', description: '你较能看见情绪正在发生，并理解它与身体信号、需要和触发情境的关系。觉察是后续选择的起点。', keywords: ['识别', '内省', '情绪命名'], suggestion: '继续用简短记录连接“事件—感受—需要”，觉察会更稳定。' },
    { id: 'regulation', title: '自我调节', description: '你较能在情绪和行动之间留出空间，并找到恢复节奏的方法。调节不是压住感受，而是保留选择。', keywords: ['暂停', '恢复', '选择空间'], suggestion: '为高压时刻准备一套固定的小型恢复流程。' },
    { id: 'empathy', title: '共情理解', description: '你愿意从他人的处境理解情绪，即使并不完全同意对方。这样的理解能降低关系中的防御。', keywords: ['换位', '倾听', '理解差异'], suggestion: '共情后再核对事实，能同时保持温度与边界。' },
    { id: 'relationship', title: '关系管理', description: '你较能表达需要、邀请支持并在冲突后推动修复。关系管理让感受转化为可沟通的行动。', keywords: ['表达', '修复', '支持网络'], suggestion: '用具体请求代替期待对方猜到，会让关系协作更顺畅。' },
  ],
};

export const emotionalIntelligenceDefinition = withAssessmentModes(
  emotionalIntelligenceDefinitionBase,
  emotionalIntelligenceDefinitionBase.questions.slice(0, 12).map((question) => question.id),
  3,
);
