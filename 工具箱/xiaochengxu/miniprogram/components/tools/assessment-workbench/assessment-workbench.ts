import {
  getAssessmentDefinition,
  NativeAssessmentDefinition,
  scoreAssessment,
} from '../../../data/assessmentData';

Component({
  properties: {
    toolId: {
      type: String,
      value: 'mbti-test',
    },
  },

  data: {
    definition: null as NativeAssessmentDefinition | null,
    question: null as NativeAssessmentDefinition['questions'][number] | null,
    questionIndex: 0,
    progress: 0,
    selectedId: '',
    answers: {} as Record<string, string>,
    phase: 'questions',
    error: '',
    resultTitle: '',
    resultText: '',
    resultPercentage: 0,
  },

  lifetimes: {
    attached() {
      const definition = getAssessmentDefinition(this.properties.toolId as string);
      this.setData({ definition });
      this.showQuestion(definition, 0, {});
    },
  },

  methods: {
    showQuestion(definition: NativeAssessmentDefinition, index: number, answers: Record<string, string>) {
      const question = definition.questions[index];
      this.setData({
        question,
        questionIndex: index,
        progress: Math.round(((index + 1) / definition.questions.length) * 100),
        selectedId: answers[question.id] ?? '',
        answers,
        error: '',
      });
    },

    selectOption(event: WechatMiniprogram.CustomEvent<WechatMiniprogram.IAnyObject>) {
      const question = this.data.question as NativeAssessmentDefinition['questions'][number] | null;
      if (!question) return;
      const optionId = String(event.currentTarget.dataset.optionId ?? '');
      const answers = { ...(this.data.answers as Record<string, string>), [question.id]: optionId };
      this.setData({ selectedId: optionId, answers, error: '' });
    },

    nextQuestion() {
      const definition = this.data.definition as NativeAssessmentDefinition | null;
      const question = this.data.question as NativeAssessmentDefinition['questions'][number] | null;
      if (!definition || !question) return;
      if (!(this.data.selectedId as string)) {
        this.setData({ error: '请先选择一个最符合你的选项。' });
        return;
      }

      const index = this.data.questionIndex as number;
      const answers = this.data.answers as Record<string, string>;
      if (index < definition.questions.length - 1) {
        this.showQuestion(definition, index + 1, answers);
        return;
      }

      const result = scoreAssessment(definition, answers);
      const primary = definition.dimensions.find((dimension) => dimension.id === result.primaryDimension);
      this.setData({
        phase: 'result',
        resultTitle: primary?.label ?? '你的倾向',
        resultText: `已完成 ${result.answered}/${definition.questions.length} 题\n主要倾向：${primary?.label ?? '待观察'}\n综合完成度：${result.percentage}%`,
        resultPercentage: result.percentage,
        error: '',
      });
    },

    restart() {
      const definition = this.data.definition as NativeAssessmentDefinition | null;
      if (!definition) return;
      this.setData({ phase: 'questions' });
      this.showQuestion(definition, 0, {});
    },

    copyResult() {
      const resultText = this.data.resultText as string;
      if (!resultText) return;
      wx.setClipboardData({
        data: resultText,
        success: () => wx.showToast({ title: '已复制', icon: 'success' }),
      });
    },
  },
});
