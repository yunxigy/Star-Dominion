import type {
  AssessmentDefinition,
  AssessmentDimension,
  AssessmentOption,
  AssessmentQuestion,
} from '../types';
import { getQuickQuestionIds, withAssessmentModes } from '../modes';

type Choice = readonly [label: string, correct: boolean];

function quizQuestion(
  id: string,
  prompt: string,
  dimensionId: string,
  choices: readonly Choice[],
): AssessmentQuestion {
  return {
    id,
    prompt,
    options: choices.map(([label, correct], index): AssessmentOption => ({
      id: `choice-${index + 1}`,
      label,
      scores: { [dimensionId]: correct ? 1 : 0 },
    })),
  };
}

function makeCognitiveDefinition(
  definition: Omit<AssessmentDefinition, 'questionCount' | 'estimatedMinutes' | 'questions' | 'variants'>,
  questions: AssessmentQuestion[],
  completeMinutes: number,
  quickMinutes: number,
): AssessmentDefinition {
  const completeDefinition: AssessmentDefinition = {
    ...definition,
    questionCount: questions.length,
    estimatedMinutes: completeMinutes,
    questions,
  };
  return withAssessmentModes(
    completeDefinition,
    getQuickQuestionIds(
      questions,
      definition.dimensions.map((dimension) => dimension.id),
      3,
    ),
    quickMinutes,
  );
}

const brainDimensions: AssessmentDimension[] = [
  { id: 'memory', label: '记忆力', color: '#8b6f9e', description: '保持、提取和更新短时信息的能力线索' },
  { id: 'attention', label: '注意力', color: '#537b98', description: '在干扰中发现细节并维持专注的能力线索' },
  { id: 'logic', label: '逻辑力', color: '#b46d67', description: '识别规律、关系与因果的推理能力线索' },
  { id: 'flexibility', label: '灵活力', color: '#6f9364', description: '切换规则、生成路径和换角度解决问题的能力线索' },
];

const brainQuestions: AssessmentQuestion[] = [
  quizQuestion('brain-memory-01', '记住序列“3 · 8 · 1 · 6”，下面哪一项顺序完全相同？', 'memory', [
    ['3 · 8 · 1 · 6', true], ['3 · 1 · 8 · 6', false], ['6 · 1 · 8 · 3', false], ['8 · 3 · 6 · 1', false],
  ]),
  quizQuestion('brain-memory-02', '字母序列 A、C、F、J、？中，问号最可能是什么？', 'memory', [
    ['M', false], ['N', false], ['O', true], ['P', false],
  ]),
  quizQuestion('brain-memory-03', '如果“蓝、圆、7、树”需要按“颜色—形状—数字—物体”复述，正确顺序是？', 'memory', [
    ['蓝、圆、7、树', true], ['圆、蓝、树、7', false], ['7、蓝、圆、树', false], ['树、7、圆、蓝', false],
  ]),
  quizQuestion('brain-memory-04', '数字 482951 去掉第 2 位和第 5 位后，剩下的数字是什么？', 'memory', [
    ['4291', false], ['4891', true], ['4821', false], ['4951', false],
  ]),
  quizQuestion('brain-memory-05', '一串图形顺序为“星、方、圆、星、方、圆”，第 11 个图形是什么？', 'memory', [
    ['星', false], ['方', false], ['圆', true], ['无法判断', false],
  ]),
  quizQuestion('brain-memory-06', '先记住四个词：雨伞、柠檬、钥匙、山。下列哪组没有改变顺序？', 'memory', [
    ['钥匙、柠檬、雨伞、山', false], ['雨伞、柠檬、钥匙、山', true], ['雨伞、钥匙、山、柠檬', false], ['山、钥匙、柠檬、雨伞', false],
  ]),
  quizQuestion('brain-attention-01', '下列哪一项与其他三项不同？', 'attention', [
    ['ABABAB', false], ['121212', false], ['红蓝红蓝红蓝', false], ['AABBAB', true],
  ]),
  quizQuestion('brain-attention-02', '从“猫、狗、猫、鸟、猫、鱼”中，出现次数最多的词是？', 'attention', [
    ['猫', true], ['狗', false], ['鸟', false], ['鱼', false],
  ]),
  quizQuestion('brain-attention-03', '若规则是“只数包含数字 5 的选项”，以下哪项应该被选中？', 'attention', [
    ['284', false], ['351', true], ['902', false], ['467', false],
  ]),
  quizQuestion('brain-attention-04', '下列哪一组完全由偶数构成？', 'attention', [
    ['2、4、8、10', true], ['2、5、8、10', false], ['1、4、6、8', false], ['4、8、9、12', false],
  ]),
  quizQuestion('brain-attention-05', '在“春夏秋冬秋夏春”中，正中间的字是？', 'attention', [
    ['夏', false], ['秋', false], ['冬', true], ['春', false],
  ]),
  quizQuestion('brain-attention-06', '下列哪一项同时满足“以 7 开头、以 2 结尾、共 3 位数”？', 'attention', [
    ['702', true], ['720', false], ['172', false], ['7820', false],
  ]),
  quizQuestion('brain-logic-01', '数列 2、4、8、16、？的下一项是？', 'logic', [
    ['20', false], ['24', false], ['32', true], ['36', false],
  ]),
  quizQuestion('brain-logic-02', '所有的杉树都是树，所有的树都需要水。可以推出？', 'logic', [
    ['所有需要水的都是杉树', false], ['所有杉树都需要水', true], ['没有树需要水', false], ['杉树不是树', false],
  ]),
  quizQuestion('brain-logic-03', '小李比小王高，小王比小张高。三人中谁最高？', 'logic', [
    ['小李', true], ['小王', false], ['小张', false], ['无法比较', false],
  ]),
  quizQuestion('brain-logic-04', '一个数加 6 后乘以 2 等于 20，这个数是？', 'logic', [
    ['2', false], ['4', true], ['6', false], ['8', false],
  ]),
  quizQuestion('brain-logic-05', '如果今天是星期三，17 天后是星期几？', 'logic', [
    ['星期五', false], ['星期六', true], ['星期日', false], ['星期一', false],
  ]),
  quizQuestion('brain-logic-06', '甲、乙、丙三人排队，甲不在第一位，丙在乙后面。可能的顺序是？', 'logic', [
    ['甲、乙、丙', false], ['乙、甲、丙', true], ['丙、乙、甲', false], ['乙、丙、甲', false],
  ]),
  quizQuestion('brain-flexibility-01', '“书”之于“阅读”，最接近“球拍”之于？', 'flexibility', [
    ['跑步', false], ['打球', true], ['看球', false], ['计分', false],
  ]),
  quizQuestion('brain-flexibility-02', '如果原规则是按大小排序，临时改为按颜色排序，你首先应该做什么？', 'flexibility', [
    ['继续按原规则', false], ['确认新的排序标准', true], ['随机排列', false], ['停止所有任务', false],
  ]),
  quizQuestion('brain-flexibility-03', '一个回形针除了夹纸，还可以用来做什么？下列哪项体现了不同用途？', 'flexibility', [
    ['夹更多纸', false], ['固定小物或临时作挂钩', true], ['换一种颜色夹纸', false], ['数一数有几个回形针', false],
  ]),
  quizQuestion('brain-flexibility-04', '看到问题“怎样让会议更高效”，哪一种回答最有发散性？', 'flexibility', [
    ['把会议缩短 10 分钟', false], ['只保留一个主持人', false], ['取消所有会议', false], ['从议程、人数、异步工具和决策权限分别尝试', true],
  ]),
  quizQuestion('brain-flexibility-05', '若一条路径被堵住，最灵活的下一步通常是？', 'flexibility', [
    ['反复走同一条路', false], ['换入口或重新规划路线', true], ['停在原地等待', false], ['认为目的地不存在', false],
  ]),
  quizQuestion('brain-flexibility-06', '“先观察—再尝试—根据反馈调整”体现了哪种思路？', 'flexibility', [
    ['固定不变', false], ['迭代试验', true], ['完全凭运气', false], ['只做理论推演', false],
  ]),
];

export const brainPowerDefinition = makeCognitiveDefinition({
  id: 'brain-power-test',
  title: '脑力挑战',
  subtitle: '用记忆、注意、逻辑和灵活四组题目热身大脑',
  group: 'fun',
  mode: 'dimensions',
  scoreType: 'quiz',
  sensitive: false,
  intro: '这是一组轻量的脑力小游戏，适合在几分钟内挑战自己。题目会混合记忆、观察、推理和换角度思考，不代表固定智力水平。',
  disclaimer: '结果仅供娱乐和自我挑战，不等同于标准化 IQ、临床评估或能力认证。',
  minAnsweredRatio: 1,
  dimensions: brainDimensions,
  results: [],
}, brainQuestions, 8, 4);

const intelligenceDimensions: AssessmentDimension[] = [
  { id: 'verbal', label: '语言推理', color: '#8b6f9e', description: '理解词义、关系和语言信息的能力线索' },
  { id: 'numeric', label: '数量推理', color: '#c78b48', description: '处理数量、运算和数字规律的能力线索' },
  { id: 'deductive', label: '演绎推理', color: '#537b98', description: '根据条件排除、归纳和推导答案的能力线索' },
  { id: 'spatial', label: '空间想象', color: '#6f9364', description: '在脑中转换方向、形状和空间关系的能力线索' },
];

const intelligenceQuestions: AssessmentQuestion[] = [
  quizQuestion('intelligence-verbal-01', '“谨慎”与“莽撞”的关系，最接近哪一组？', 'verbal', [
    ['近义词', false], ['反义词', true], ['因果关系', false], ['包含关系', false],
  ]),
  quizQuestion('intelligence-verbal-02', '“医生”之于“医院”，最接近“教师”之于？', 'verbal', [
    ['书本', false], ['学校', true], ['学生', false], ['考试', false],
  ]),
  quizQuestion('intelligence-verbal-03', '下列哪一个词最不属于同一组？', 'verbal', [
    ['苹果', false], ['梨', false], ['胡萝卜', true], ['桃子', false],
  ]),
  quizQuestion('intelligence-verbal-04', '如果所有“沉默”都不等于“同意”，那么“没有反对”意味着？', 'verbal', [
    ['一定同意', false], ['一定反对', false], ['不能直接判断同意', true], ['必须马上决定', false],
  ]),
  quizQuestion('intelligence-verbal-05', '“温度计”最主要的功能是？', 'verbal', [
    ['制造温度', false], ['测量温度', true], ['改变天气', false], ['储存热量', false],
  ]),
  quizQuestion('intelligence-verbal-06', '“种子—植物—森林”的关系最接近？', 'verbal', [
    ['部分到更大整体的层级', true], ['三个完全无关的词', false], ['三个反义词', false], ['同一个物品的别名', false],
  ]),
  quizQuestion('intelligence-numeric-01', '数列 3、6、12、24、？的下一项是？', 'numeric', [
    ['36', false], ['42', false], ['48', true], ['54', false],
  ]),
  quizQuestion('intelligence-numeric-02', '一件商品 80 元，打 75 折后价格是多少？', 'numeric', [
    ['55 元', false], ['60 元', true], ['65 元', false], ['70 元', false],
  ]),
  quizQuestion('intelligence-numeric-03', '如果 4 支笔 12 元，7 支同价笔多少钱？', 'numeric', [
    ['18 元', false], ['21 元', true], ['24 元', false], ['28 元', false],
  ]),
  quizQuestion('intelligence-numeric-04', '数列 1、4、9、16、？最合理的下一项是？', 'numeric', [
    ['20', false], ['24', false], ['25', true], ['30', false],
  ]),
  quizQuestion('intelligence-numeric-05', '一个班有 30 人，其中 40% 参加了活动，参加人数是？', 'numeric', [
    ['10', false], ['12', true], ['14', false], ['18', false],
  ]),
  quizQuestion('intelligence-numeric-06', '时钟现在是 2:40，35 分钟后是？', 'numeric', [
    ['3:05', false], ['3:15', true], ['3:25', false], ['4:15', false],
  ]),
  quizQuestion('intelligence-deductive-01', '所有 A 都是 B，所有 B 都是 C。下面一定正确的是？', 'deductive', [
    ['所有 A 都是 C', true], ['所有 C 都是 A', false], ['所有 B 都不是 A', false], ['A 与 C 无关', false],
  ]),
  quizQuestion('intelligence-deductive-02', '小周比小林早到，小林比小陈早到。谁最后到？', 'deductive', [
    ['小周', false], ['小林', false], ['小陈', true], ['无法判断任何人', false],
  ]),
  quizQuestion('intelligence-deductive-03', '四个盒子中只有一个有奖品。奖品不在 1 号或 4 号；如果在 2 号提示灯会亮，但提示灯没有亮。奖品一定在？', 'deductive', [
    ['1 号', false], ['2 号', false], ['3 号', true], ['4 号', false],
  ]),
  quizQuestion('intelligence-deductive-04', '如果下雨，地面会湿。地面没有湿，可以推出？', 'deductive', [
    ['一定下雨了', false], ['一定没有下雨', true], ['地面一定干燥', false], ['无法推出任何事', false],
  ]),
  quizQuestion('intelligence-deductive-05', '甲、乙、丙三人中只有一人拿了钥匙。甲说“不是我”，乙说“是丙”，丙说“乙在说假话”。若只有一人说真话，谁拿了钥匙？', 'deductive', [
    ['甲', true], ['乙', false], ['丙', false], ['无法判断', false],
  ]),
  quizQuestion('intelligence-deductive-06', '一个密码由三位数字组成，第一位比第二位大，第二位比第三位大。下列哪组可能？', 'deductive', [
    ['123', false], ['321', true], ['212', false], ['231', false],
  ]),
  quizQuestion('intelligence-spatial-01', '正方形顺时针旋转 90° 后，形状会？', 'spatial', [
    ['变成长方形', false], ['仍是正方形，只是方向改变', true], ['变成三角形', false], ['消失', false],
  ]),
  quizQuestion('intelligence-spatial-02', '你面向北方，向右转 90°，再向右转 90°，现在面向？', 'spatial', [
    ['东方', false], ['南方', true], ['西方', false], ['北方', false],
  ]),
  quizQuestion('intelligence-spatial-03', '一个立方体相对的两个面不能同时相邻。若顶面是红色，底面最可能是？', 'spatial', [
    ['红色', false], ['与红色相对的另一种颜色', true], ['任何颜色都能与顶面相邻', false], ['无法形成立方体', false],
  ]),
  quizQuestion('intelligence-spatial-04', '纸张先左右对折，再上下对折，展开后折痕将纸分成几块？', 'spatial', [
    ['2 块', false], ['3 块', false], ['4 块', true], ['8 块', false],
  ]),
  quizQuestion('intelligence-spatial-05', '从起点向东走 3 步，再向北走 2 步，终点相对起点在？', 'spatial', [
    ['东南方', false], ['东北方', true], ['西北方', false], ['正北方', false],
  ]),
  quizQuestion('intelligence-spatial-06', '一个箭头“↑”先旋转 180°，再左右镜像，最后方向是？', 'spatial', [
    ['↑', false], ['→', false], ['↓', true], ['←', false],
  ]),
];

export const intelligenceDefinition = makeCognitiveDefinition({
  id: 'intelligence-test',
  title: '综合智力挑战',
  subtitle: '语言、数字、逻辑与空间四类题目的综合热身',
  group: 'fun',
  mode: 'dimensions',
  scoreType: 'quiz',
  sensitive: false,
  intro: '这是一份偏游戏化的综合题，不使用年龄常模，也不生成 IQ 分数。把它当作一次多角度的思维热身，关注过程比标签更重要。',
  disclaimer: '结果仅供娱乐和自我挑战，不等同于标准化 IQ、临床评估、升学测验或能力认证。',
  minAnsweredRatio: 1,
  dimensions: intelligenceDimensions,
  results: [],
}, intelligenceQuestions, 8, 4);
