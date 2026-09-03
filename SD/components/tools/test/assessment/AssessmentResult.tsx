import React from 'react';
import { AlertCircle, Check, Compass, RotateCcw, Share2, Sparkles, X } from 'lucide-react';

import { AssessmentRadarChart } from './AssessmentRadarChart';
import type { AssessmentDefinition, AssessmentScoreResult, AssessmentVariant } from './types';

interface AssessmentResultProps {
  definition: AssessmentDefinition;
  score: AssessmentScoreResult;
  variant?: AssessmentVariant;
  onRestart: () => void;
  onClose: () => void;
}

const groupStyles = {
  fun: {
    chart: '#a34d24',
    eyebrow: 'text-[#a34d24]',
    wash: 'from-[#fff0d8] via-[#fff8ed] to-[#f3eadf]',
    border: 'border-[#e6bd8c]',
    button: 'bg-[#a34d24] hover:bg-[#853b1a]',
  },
  personality: {
    chart: '#6d4c8d',
    eyebrow: 'text-[#6d4c8d]',
    wash: 'from-[#f2e9f7] via-[#fffaf2] to-[#e9eee2]',
    border: 'border-[#cbb4d8]',
    button: 'bg-[#6d4c8d] hover:bg-[#573b72]',
  },
  orientation: {
    chart: '#8d5265',
    eyebrow: 'text-[#8d5265]',
    wash: 'from-[#f7e8eb] via-[#fffaf2] to-[#e4efea]',
    border: 'border-[#d6b3bd]',
    button: 'bg-[#8d5265] hover:bg-[#744153]',
  },
} as const;

export function AssessmentResult({
  definition,
  score,
  variant,
  onRestart,
  onClose,
}: AssessmentResultProps) {
  const style = groupStyles[definition.group];
  const [copied, setCopied] = React.useState(false);
  const profilesById = new Map(definition.results.map((profile) => [profile.id, profile]));
  const highlightedIds = definition.mode === 'dimensions'
    ? score.rankedDimensionIds.slice(0, 2)
    : definition.mode === 'mbti'
      ? [score.mbtiType ?? '']
      : [score.primaryResultId ?? '', score.secondaryResultId ?? ''];
  const highlightedProfiles = highlightedIds
    .map((id) => profilesById.get(id))
    .filter((profile): profile is NonNullable<typeof profile> => Boolean(profile));

  const copyResult = async () => {
    const primaryLabel = score.mbtiType ?? highlightedProfiles[0]?.title ?? '多维度探索结果';
    const lines = [
      `${definition.title}${variant ? ` · ${variant.label}` : ''}`,
      `我的结果：${primaryLabel}`,
      score.overallPercentage !== undefined ? `综合正确率：${score.overallPercentage}%` : '',
      '来自 SD 工具箱，仅供娱乐和自我探索。',
    ].filter(Boolean);

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className={`relative overflow-hidden rounded-[2rem] border ${style.border} bg-gradient-to-br ${style.wash} p-6 sm:p-9`}>
        <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full border border-white/80 bg-white/35" />
        <div className="relative text-center">
          <div className={`mb-3 inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.24em] ${style.eyebrow}`}>
            <Sparkles className="h-4 w-4" />
            测评结果
          </div>
          {variant && (
            <span className="mb-4 inline-flex rounded-full border border-white/80 bg-white/65 px-3 py-1 text-xs font-bold text-[#6d5a47]">
              本次完成：{variant.label} · {variant.questions.length} 题
            </span>
          )}
          {definition.mode === 'mbti' && (
            <div className="mb-3 font-serif text-6xl font-black tracking-[0.08em] text-[#2f241b] sm:text-7xl">
              {score.mbtiType}
            </div>
          )}
          {definition.scoreType === 'quiz' && (
            <div className="mx-auto mb-5 max-w-sm rounded-2xl border border-white/80 bg-white/60 px-5 py-4 shadow-sm">
              <p className="text-xs font-black tracking-[0.18em] text-[#8b735c]">综合正确率</p>
              <p className="mt-1 font-serif text-5xl font-black text-[#2f241b]">
                {score.overallPercentage ?? '—'}%
              </p>
              <p className="mt-1 text-sm leading-6 text-[#6d5a47]">这是本次题目的答题表现，不代表固定智力或标准化分数。</p>
            </div>
          )}
          {highlightedProfiles.length > 0 ? (
            <div className="space-y-4">
              {highlightedProfiles.map((profile, index) => (
                <div key={profile.id}>
                  <p className="text-xs font-bold tracking-[0.18em] text-[#8b735c]">
                    {definition.mode === 'dimensions'
                      ? index === 0 ? '较突出的维度' : '同样值得留意'
                      : index === 0 ? '主要倾向' : '相邻倾向'}
                  </p>
                  <h2 className="mt-1 font-serif text-3xl font-black text-[#2f241b]">
                    {profile.title}
                  </h2>
                  <p className="mx-auto mt-3 max-w-2xl text-base leading-7 text-[#5f4c3a]">
                    {profile.description}
                  </p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    {profile.keywords.map((keyword) => (
                      <span key={keyword} className="rounded-full border border-white/80 bg-white/65 px-3 py-1 text-sm font-semibold text-[#5f4c3a] shadow-sm">
                        {keyword}
                      </span>
                    ))}
                  </div>
                  {profile.suggestion && (
                    <p className="mx-auto mt-4 max-w-2xl rounded-2xl bg-white/55 px-4 py-3 text-sm leading-6 text-[#6d5a47]">
                      {profile.suggestion}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[#6d5a47]">下面是你的多维度探索结果。</p>
          )}
        </div>
      </section>

      <section className="rounded-[1.75rem] border border-[#ddc8af] bg-[#fffaf2]/90 p-5 sm:p-7">
        <div className="mb-5 flex items-center gap-3">
          <span className="rounded-xl bg-[#f1dcc2] p-2 text-[#7a421b]"><Compass className="h-5 w-5" /></span>
          <div>
            <h3 className="font-serif text-xl font-black text-[#2f241b]">维度地图</h3>
            <p className="text-sm text-[#7b6854]">分数用于比较本次回答中的相对倾向</p>
          </div>
        </div>

        {definition.mode !== 'mbti' && definition.dimensions.length >= 3 && (
          <div className="mb-7 rounded-2xl border border-[#ead9c5] bg-white/60 px-2 py-4 sm:px-4">
            <AssessmentRadarChart
              title={definition.title}
              dimensions={definition.dimensions}
              scores={score.dimensionScores}
              accentColor={style.chart}
            />
            <p className="px-3 text-center text-xs leading-5 text-[#8b735c]">
              百分比表示本次回答中的相对倾向，不是人群百分位；下方柱状图可查看准确数值与说明。
            </p>
          </div>
        )}

        {definition.mode === 'mbti' && definition.mbtiPairs ? (
          <div className="grid gap-4 md:grid-cols-2">
            {definition.mbtiPairs.map((pair) => {
              const left = score.dimensionScores[pair.left];
              const right = score.dimensionScores[pair.right];
              return (
                <div key={pair.id} className="rounded-2xl border border-[#ead9c5] bg-white/70 p-4">
                  <div className="flex items-center justify-between font-bold text-[#4b3a2d]">
                    <span>{pair.left} · {left ?? '—'}</span>
                    <span>{pair.right} · {right ?? '—'}</span>
                  </div>
                  <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-[#eadfce]">
                    <span className="bg-[#9a5a28] transition-all motion-reduce:transition-none" style={{ width: `${left ?? 0}%` }} />
                    <span className="bg-[#6d4c8d] transition-all motion-reduce:transition-none" style={{ width: `${right ?? 0}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-4">
            {definition.dimensions.map((dimension) => {
              const value = score.dimensionScores[dimension.id];
              return (
                <div key={dimension.id}>
                  <div className="mb-1.5 flex items-center justify-between gap-4 text-sm">
                    <span className="font-bold text-[#4b3a2d]">{dimension.label}</span>
                    <span className="text-[#7b6854]">{value === null ? '信息不足' : `${value}%`}</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-[#eadfce]">
                    <div
                      className="h-full rounded-full transition-all duration-700 motion-reduce:transition-none"
                      style={{ width: `${value ?? 0}%`, backgroundColor: dimension.color }}
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-[#8b735c]">{dimension.description}</p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {(score.closeDimensionIds.length > 0 || score.insufficientDimensionIds.length > 0) && (
        <div className="flex gap-3 rounded-2xl border border-[#dfc8a8] bg-[#fff4df] p-4 text-sm leading-6 text-[#6d5337]">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <p>
            {score.closeDimensionIds.length > 0 && '部分维度非常接近，相邻结果也可能符合你。'}
            {score.closeDimensionIds.length > 0 && score.insufficientDimensionIds.length > 0 && ' '}
            {score.insufficientDimensionIds.length > 0 && '部分维度因有效回答不足，暂不生成倾向描述。'}
          </p>
        </div>
      )}

      <p className="text-center text-sm leading-6 text-[#7b6854]">{definition.disclaimer}</p>

      <div className="grid gap-3 sm:grid-cols-3">
        <button
          type="button"
          onClick={copyResult}
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#c9d5bd] bg-[#edf2e6] px-5 py-3.5 font-bold text-[#4d6036] transition hover:bg-[#e2ead9] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#8da472]/35"
        >
          {copied ? <Check className="h-5 w-5" /> : <Share2 className="h-5 w-5" />}
          {copied ? '已复制结果' : '复制结果分享'}
        </button>
        <button
          type="button"
          onClick={onRestart}
          className={`inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3.5 font-bold text-white shadow-sm transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#c89a70]/35 motion-reduce:transform-none ${style.button}`}
        >
          <RotateCcw className="h-5 w-5" />
          重新测试
        </button>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#d8b58e] bg-[#fff4e6] px-5 py-3.5 font-bold text-[#6f3714] transition hover:bg-[#f1dcc2] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#c89a70]/30"
        >
          <X className="h-5 w-5" />
          关闭
        </button>
      </div>
    </div>
  );
}
