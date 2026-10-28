import type { AssessmentDefinition } from '../types';
import { withAssessmentModes } from '../modes';
import { agreementQuestion } from './builders';

const intimacyBoundariesDefinitionBase: AssessmentDefinition = {
  id: 'intimacy-boundaries-test',
  title: '亲密边界风格',
  subtitle: '了解你在自主、靠近、透明沟通与慢节奏之间的偏好',
  group: 'orientation', questionCount: 24, estimatedMinutes: 6, mode: 'dominant', sensitive: true,
  intro: '本测评建议 16+ 使用。请按你觉得舒服的亲密互动方式作答，任何题目都可以跳过；边界会因关系与阶段而变化。',
  disclaimer: '结果仅供自我探索，不用于确认或诊断身份。四种风格没有哪一种更健康或更成熟，关键是知情、自愿、可沟通且彼此尊重。',
  minAnsweredRatio: 0.5,
  dimensions: [
    { id: 'autonomy', label: '自主空间', color: '#6f8094', description: '重视个人节奏、独处空间与独立决定' },
    { id: 'closeness', label: '亲密靠近', color: '#b16f76', description: '重视高频连接、陪伴感与及时回应' },
    { id: 'transparent', label: '透明协商', color: '#56847c', description: '倾向直接说清需要、同意与边界变化' },
    { id: 'slowPace', label: '渐进节奏', color: '#8b749b', description: '需要时间、稳定和逐步确认来建立安全感' },
  ],
  questions: [
    agreementQuestion('ib-01', '即使关系亲密，我也需要稳定的个人空间。', 'autonomy'),
    agreementQuestion('ib-02', '经常保持联系会让我更有安全感。', 'closeness'),
    agreementQuestion('ib-03', '我希望双方能直接讨论彼此舒服与不舒服的界限。', 'transparent'),
    agreementQuestion('ib-04', '我更愿意让亲密程度逐步增加，而不是快速推进。', 'slowPace'),
    agreementQuestion('ib-05', '重要决定中，保留独立选择对我很重要。', 'autonomy'),
    agreementQuestion('ib-06', '我喜欢通过陪伴和分享日常来确认关系连接。', 'closeness'),
    agreementQuestion('ib-07', '当边界发生变化时，我会希望及时重新协商。', 'transparent'),
    agreementQuestion('ib-08', '在充分信任之前，我通常会保持一定距离。', 'slowPace'),
    agreementQuestion('ib-09', '短暂独处不会削弱我对一段关系的重视。', 'autonomy'),
    agreementQuestion('ib-10', '情绪低落时，我通常更希望重要的人靠近。', 'closeness'),
    agreementQuestion('ib-11', '比起让对方猜，我更愿意明确表达需要。', 'transparent'),
    agreementQuestion('ib-12', '我需要多次稳定互动，才能确认自己真正舒服。', 'slowPace'),
    agreementQuestion('ib-13', '我不希望亲密关系占据全部个人生活。', 'autonomy'),
    agreementQuestion('ib-14', '及时回应和主动关心对我有明显意义。', 'closeness'),
    agreementQuestion('ib-15', '我重视双方都能随时改变主意并被尊重。', 'transparent'),
    agreementQuestion('ib-16', '面对新的亲密互动，我更偏好先观察再决定。', 'slowPace'),
    agreementQuestion('ib-17', '我希望关系能支持彼此拥有独立兴趣与朋友圈。', 'autonomy'),
    agreementQuestion('ib-18', '共同安排较多时间会让我感到被重视。', 'closeness'),
    agreementQuestion('ib-19', '即使关系亲密，我也希望保留自己的兴趣和朋友圈。', 'autonomy'),
    agreementQuestion('ib-20', '当我感到不安时，及时的陪伴和回应会很有帮助。', 'closeness'),
    agreementQuestion('ib-21', '我希望重要的边界在变化时能够被重新确认。', 'transparent'),
    agreementQuestion('ib-22', '我通常需要多次稳定互动，才会愿意进一步靠近。', 'slowPace'),
    agreementQuestion('ib-23', '我会直接说明自己此刻能接受和不能接受的互动。', 'transparent'),
    agreementQuestion('ib-24', '我希望亲密关系的推进始终可以暂停、调整或重新选择。', 'slowPace'),
  ],
  results: [
    { id: 'autonomy', title: '自主空间型', description: '你倾向在亲密中保留清晰的个人空间与选择权。独立对你不是疏远，而是保持稳定与真实的重要条件。', keywords: ['个人空间', '独立选择', '稳定自我'], suggestion: '主动说明独处需求和预计恢复联系的时间，能减少误解。' },
    { id: 'closeness', title: '亲密靠近型', description: '你重视陪伴、分享与及时回应，持续连接能帮助你确认关系安全。这样的需要值得被清楚表达和共同安排。', keywords: ['陪伴连接', '及时回应', '共享日常'], suggestion: '把“多一点关心”转成双方可执行的具体期待。' },
    { id: 'transparent', title: '透明协商型', description: '你重视直接沟通、持续同意与边界协商。你更愿意让需要被说出来，而不是依赖默认规则或猜测。', keywords: ['直接沟通', '持续同意', '边界协商'], suggestion: '在气氛平稳时定期确认彼此的舒适度与变化。' },
    { id: 'slowPace', title: '渐进节奏型', description: '你通常需要时间与稳定互动来建立信任，并偏好逐步确认亲密程度。谨慎是保护舒适感的一种方式。', keywords: ['渐进信任', '稳定互动', '观察确认'], suggestion: '提前说明自己的节奏，同时保留随时暂停与重新选择的权利。' },
  ],
  tieBreakOrder: ['autonomy', 'closeness', 'transparent', 'slowPace'],
};

export const intimacyBoundariesDefinition = withAssessmentModes(
  intimacyBoundariesDefinitionBase,
  intimacyBoundariesDefinitionBase.questions.slice(0, 12).map((question) => question.id),
  3,
);
