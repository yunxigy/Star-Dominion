import React, { useEffect, useMemo, useReducer, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  Clock3,
  History,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';

import { AssessmentResult } from './AssessmentResult';
import {
  getAssessmentProgress,
  removeAssessmentProgress,
  saveAssessmentProgress,
  saveAssessmentResult,
} from './assessmentHistory';
import { getAssessmentVariant, getAssessmentVariants } from './modes';
import { scoreAssessment } from './scoring';
import {
  assessmentReducer,
  canAdvance,
  createAssessmentState,
} from './state';
import type { AssessmentDefinition, AssessmentVariantId } from './types';

export interface AssessmentRunnerProps {
  definition?: AssessmentDefinition;
  onClose: () => void;
}

const groupStyles = {
  fun: {
    eyebrow: 'text-[#a34d24]',
    icon: 'from-[#c96f35] to-[#9d3f23]',
    selected: 'border-[#c96f35] bg-[#fff0df] text-[#6f3714]',
    progress: 'from-[#c96f35] to-[#e3a14f]',
    button: 'bg-[#a34d24] hover:bg-[#853b1a]',
  },
  personality: {
    eyebrow: 'text-[#6d4c8d]',
    icon: 'from-[#8663a3] to-[#5c426f]',
    selected: 'border-[#8f6aa8] bg-[#f2eaf6] text-[#573b72]',
    progress: 'from-[#8663a3] to-[#b6788d]',
    button: 'bg-[#6d4c8d] hover:bg-[#573b72]',
  },
  orientation: {
    eyebrow: 'text-[#8d5265]',
    icon: 'from-[#a86578] to-[#4d7b70]',
    selected: 'border-[#a86578] bg-[#f7e9ed] text-[#744153]',
    progress: 'from-[#a86578] to-[#5c8e82]',
    button: 'bg-[#8d5265] hover:bg-[#744153]',
  },
} as const;

export function AssessmentRunner({ definition, onClose }: AssessmentRunnerProps) {
  const [state, dispatch] = useReducer(assessmentReducer, undefined, createAssessmentState);
  const [variantId, setVariantId] = useState<AssessmentVariantId>('complete');
  const [resumeDismissed, setResumeDismissed] = useState(false);
  const variants = definition ? getAssessmentVariants(definition) : [];
  const variant = definition ? getAssessmentVariant(definition, variantId) : null;
  const savedProgress = useMemo(
    () => definition ? getAssessmentProgress(definition.id, variantId) : null,
    [definition, variantId],
  );
  const score = useMemo(
    () => definition && variant && state.phase === 'result'
      ? scoreAssessment(definition, state.answers, variant.questions)
      : null,
    [definition, state.answers, state.phase, variant],
  );

  useEffect(() => {
    if (!definition || !variant || state.phase !== 'questions') return;
    saveAssessmentProgress({
      definitionId: definition.id,
      variantId: variant.id,
      currentIndex: state.currentIndex,
      totalQuestions: variant.questions.length,
      answers: state.answers,
    });
  }, [definition, state.answers, state.currentIndex, state.phase, variant]);

  useEffect(() => {
    if (!definition || !variant || !score || state.phase !== 'result') return;

    const profilesById = new Map(definition.results.map((profile) => [profile.id, profile]));
    const resultLabel = score.mbtiType
      ?? (score.primaryResultId ? profilesById.get(score.primaryResultId)?.title : undefined)
      ?? (score.rankedDimensionIds[0]
        ? definition.dimensions.find((dimension) => dimension.id === score.rankedDimensionIds[0])?.label
        : undefined);
    const secondaryResultLabel = score.secondaryResultId
      ? profilesById.get(score.secondaryResultId)?.title
      : undefined;

    saveAssessmentResult({
      definitionId: definition.id,
      variantId: variant.id,
      totalQuestions: variant.questions.length,
      answers: state.answers,
      resultLabel,
      secondaryResultLabel,
      mbtiType: score.mbtiType,
      overallPercentage: score.overallPercentage,
    });
  }, [definition, score, state.answers, state.phase, variant]);

  if (!definition) {
    return (
      <div className="mx-auto flex min-h-[420px] max-w-xl items-center justify-center p-6">
        <div className="w-full rounded-[2rem] border border-[#e0b8ae] bg-[#fff7f3] p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f2d7d0] text-[#9a4b3f]">
            <X className="h-6 w-6" />
          </div>
          <h2 className="font-serif text-2xl font-black text-[#2f241b]">测评配置加载失败</h2>
          <p className="mt-2 text-[#6d5a47]">当前测评内容不完整，请关闭后稍后重试。</p>
          <button type="button" onClick={onClose} className="mt-6 rounded-xl bg-[#7a421b] px-5 py-2.5 font-bold text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#c89a70]/35">
            关闭
          </button>
        </div>
      </div>
    );
  }

  const style = groupStyles[definition.group];
  const hasSelectableVariants = variants.length > 1;

  const startFresh = () => {
    if (!variant) return;
    removeAssessmentProgress(definition.id, variant.id);
    setResumeDismissed(true);
    dispatch({ type: 'start' });
  };

  const resumeSavedProgress = () => {
    if (!variant || !savedProgress) return;
    dispatch({
      type: 'restore',
      currentIndex: Math.min(savedProgress.currentIndex, Math.max(variant.questions.length - 1, 0)),
      answers: savedProgress.answers,
    });
    setResumeDismissed(true);
  };

  if (state.phase === 'intro') {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-7">
        <section className="relative overflow-hidden rounded-[2.25rem] border border-[#ddc4a8] bg-[radial-gradient(circle_at_top_left,#fff8e8_0,#fffaf4_42%,#f3eadf_100%)] p-6 shadow-[0_24px_70px_rgba(99,67,39,0.10)] sm:p-10">
          <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full border border-white/80 bg-white/35" />
          <div className="relative">
            <div className={`mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${style.icon} text-white shadow-lg`}>
              <Sparkles className="h-7 w-7" />
            </div>
            <p className={`text-xs font-black uppercase tracking-[0.24em] ${style.eyebrow}`}>自我探索 · 本地完成</p>
            <h1 className="mt-3 max-w-2xl font-serif text-4xl font-black leading-tight text-[#2f241b] sm:text-5xl">
              {definition.title}
            </h1>
            <p className="mt-3 text-lg font-semibold text-[#695541]">{definition.subtitle}</p>
            <p className="mt-6 max-w-2xl text-base leading-7 text-[#6d5a47]">{definition.intro}</p>

            <div className="mt-7 flex flex-wrap gap-3">
              <span className="inline-flex items-center gap-2 rounded-full border border-[#dec4a6] bg-white/70 px-4 py-2 text-sm font-bold text-[#5f4935]">
                <Clock3 className="h-4 w-4" /> {variant?.questions.length ?? definition.questionCount} 题 · 约 {variant?.estimatedMinutes ?? definition.estimatedMinutes} 分钟
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-[#c7d5bd] bg-[#edf2e6]/80 px-4 py-2 text-sm font-bold text-[#4d6036]">
                <ShieldCheck className="h-4 w-4" /> 答案仅在当前页面处理
              </span>
            </div>

            {hasSelectableVariants && (
              <div className="mt-7">
                <div className="mb-3 flex items-end justify-between gap-3">
                  <div>
                    <p className="text-sm font-black text-[#4f3928]">选择测试长度</p>
                    <p className="mt-1 text-xs leading-5 text-[#806b56]">先快速体验，或一次完成更完整的题目。</p>
                  </div>
                  <span className="rounded-full bg-[#f6e8d8] px-3 py-1 text-xs font-bold text-[#8b6545]">可随时重测</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="选择测试长度">
                  {variants.map((candidate) => {
                    const selected = candidate.id === variant?.id;
                    return (
                      <button
                        key={candidate.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => {
                          setVariantId(candidate.id);
                          setResumeDismissed(false);
                        }}
                        className={`rounded-2xl border-2 p-4 text-left transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#c89a70]/30 motion-reduce:transition-none ${selected ? style.selected : 'border-[#e5d6c3] bg-white/65 text-[#574536] hover:border-[#c9a77f] hover:bg-[#fff6e9]'}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-black">{candidate.label}</span>
                          <span className="text-xs font-bold opacity-80">{candidate.questions.length} 题 · {candidate.estimatedMinutes} 分钟</span>
                        </div>
                        <p className="mt-2 text-sm leading-6 opacity-85">{candidate.description}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {savedProgress && !resumeDismissed && (
              <div className="mt-6 rounded-2xl border border-[#c7d5bd] bg-[#edf2e6]/85 p-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/80 text-[#4d6036]">
                    <History className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="font-black text-[#4d6036]">发现未完成的测评</p>
                    <p className="mt-1 text-sm leading-6 text-[#62734e]">
                      上次做到第 {Math.min(savedProgress.currentIndex + 1, variant?.questions.length ?? savedProgress.totalQuestions)} 题，答案会继续保存在当前浏览器。
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={resumeSavedProgress}
                    className="rounded-xl bg-[#5d7543] px-4 py-2.5 text-sm font-black text-white transition hover:bg-[#4d6036] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#8da472]/35"
                  >
                    继续上次进度
                  </button>
                  <button
                    type="button"
                    onClick={startFresh}
                    className="rounded-xl border border-[#b9c7ab] bg-white/70 px-4 py-2.5 text-sm font-bold text-[#62734e] transition hover:bg-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#8da472]/35"
                  >
                    重新开始
                  </button>
                </div>
              </div>
            )}

            {definition.sensitive && (
              <div className="mt-6 flex gap-3 rounded-2xl border border-[#d9bdc5] bg-[#f9edf0]/85 p-4 text-sm leading-6 text-[#704858]">
                <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0" />
                <p>建议 16 岁以上参与。你可以暂不回答任何题目，也可以随时关闭；测评不会替你确认身份。</p>
              </div>
            )}

            <p className="mt-6 text-sm leading-6 text-[#806b56]">{definition.disclaimer}</p>
            <button
              type="button"
              onClick={startFresh}
              className={`mt-7 inline-flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-4 text-lg font-black text-white shadow-lg transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#c89a70]/35 motion-reduce:transform-none sm:w-auto ${style.button}`}
            >
              {hasSelectableVariants ? `开始${variant?.label ?? '测评'}` : '开始测评'} <ArrowRight className="h-5 w-5" />
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (state.phase === 'result' && score) {
    return (
      <div className="mx-auto max-w-4xl p-4 sm:p-7">
        <AssessmentResult
          definition={definition}
          score={score}
          variant={variant ?? undefined}
          onRestart={() => dispatch({ type: 'restart' })}
          onClose={onClose}
        />
      </div>
    );
  }

  const questions = variant?.questions ?? definition.questions;
  const question = questions[state.currentIndex];
  const selectedAnswer = state.answers[question.id];
  const progress = ((state.currentIndex + 1) / questions.length) * 100;
  const isLastQuestion = state.currentIndex === questions.length - 1;
  const advanceAllowed = canAdvance(state, question.id, definition.sensitive);

  const advance = () => {
    if (!advanceAllowed) return;
    if (isLastQuestion) dispatch({ type: 'finish' });
    else dispatch({ type: 'next', lastIndex: questions.length - 1 });
  };

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-7">
      <div className="mb-5 rounded-2xl border border-[#dfccb6] bg-[#fffaf2]/90 p-4 shadow-sm">
        <div className="flex items-center justify-between gap-4 text-sm font-bold text-[#6d5a47]">
          <span>{definition.title}</span>
          <span>{state.currentIndex + 1} / {questions.length}</span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#eadfce]">
          <div
            className={`h-full rounded-full bg-gradient-to-r ${style.progress} transition-all duration-500 motion-reduce:transition-none`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.fieldset
          key={question.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
          className="rounded-[2rem] border border-[#ddc4a8] bg-[#fffaf4] p-5 shadow-[0_20px_60px_rgba(99,67,39,0.08)] motion-reduce:transform-none sm:p-8"
        >
          <legend className="sr-only">第 {state.currentIndex + 1} 题</legend>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-[#9a7859]">Question {String(state.currentIndex + 1).padStart(2, '0')}</p>
          <h2 className="mt-3 font-serif text-2xl font-black leading-10 text-[#2f241b] sm:text-3xl">
            {question.prompt}
          </h2>

          <div className="mt-7 grid gap-3" role="radiogroup" aria-label={question.prompt}>
            {question.options.map((option, index) => {
              const selected = selectedAnswer === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => dispatch({ type: 'answer', questionId: question.id, optionId: option.id })}
                  className={`group flex w-full items-start gap-4 rounded-2xl border-2 p-4 text-left transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#c89a70]/30 motion-reduce:transition-none sm:p-5 ${selected ? style.selected : 'border-[#e5d6c3] bg-white/70 text-[#574536] hover:border-[#c9a77f] hover:bg-[#fff6e9]'}`}
                >
                  <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-black ${selected ? 'border-current bg-white/75' : 'border-[#ccb99f] bg-[#faf1e4] text-[#8b735c]'}`}>
                    {String.fromCharCode(65 + index)}
                  </span>
                  <span className="text-base font-semibold leading-7">{option.label}</span>
                </button>
              );
            })}
          </div>

          {definition.sensitive && (
            <button
              type="button"
              onClick={() => dispatch({ type: 'skip', questionId: question.id })}
              className={`mt-4 w-full rounded-xl border border-dashed px-4 py-3 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#c89a70]/25 ${selectedAnswer === null ? 'border-[#a86578] bg-[#f7e9ed] text-[#744153]' : 'border-[#cdb9a2] text-[#806b56] hover:bg-[#f8efe4]'}`}
            >
              {selectedAnswer === null ? '已选择暂不回答' : '暂不回答这一题'}
            </button>
          )}
        </motion.fieldset>
      </AnimatePresence>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => dispatch({ type: 'previous' })}
          disabled={state.currentIndex === 0}
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#d8b58e] bg-[#fff4e6] px-4 py-3.5 font-bold text-[#6f3714] transition hover:bg-[#f1dcc2] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#c89a70]/30 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowLeft className="h-5 w-5" /> 上一题
        </button>
        <button
          type="button"
          onClick={advance}
          disabled={!advanceAllowed}
          className={`inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3.5 font-bold text-white shadow-sm transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#c89a70]/35 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 motion-reduce:transform-none ${style.button}`}
        >
          {isLastQuestion ? '查看结果' : '下一题'} <ArrowRight className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
