import { FormEvent, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  BadgeCheck,
  Check,
  Clipboard,
  Clock3,
  Download,
  Film,
  Gauge,
  Loader2,
  LockKeyhole,
  MousePointerClick,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TimerReset,
  UserRoundCheck,
  X,
} from 'lucide-react';

import {
  cancelDownload,
  createDownload,
  downloadFileUrl,
  getDownload,
  getHealth,
  parseVideo,
} from './api';
import {
  detectPlatform,
  errorMessage,
  formatBytes,
  formatDuration,
  initialVideoDownloadState,
  stageLabel,
  videoDownloadReducer,
} from './state';
import type {
  HealthResponse,
  JobStatusResponse,
  Platform,
  VideoApiErrorBody,
} from './types';

interface VideoDownloaderProps {
  onClose: () => void;
}

const FEATURES = [
  { icon: UserRoundCheck, title: '无需登录', copy: '仅解析无需登录即可访问的单个公开视频' },
  { icon: BadgeCheck, title: '实际清晰度', copy: '按源站实际可用档位选择，不虚标画质' },
  { icon: TimerReset, title: '临时处理', copy: '任务文件短时保存，到期后自动清理' },
  { icon: Gauge, title: '快速下载', copy: '服务端安全处理，完成后从本站保存' },
] as const;

const STEPS = [
  { icon: Clipboard, title: '复制视频链接', copy: '在抖音或 B 站打开公开视频并复制分享链接。' },
  { icon: MousePointerClick, title: '粘贴并解析', copy: '一次粘贴一个链接，等待本站识别视频信息。' },
  { icon: Download, title: '选择清晰度下载', copy: '选择实际可用档位，处理完成后保存到设备。' },
] as const;

const TERMINAL_STAGES = new Set<JobStatusResponse['stage']>([
  'completed',
  'failed',
  'cancelled',
  'expired',
]);

const platformName = (platform: Platform): string => (
  platform === 'douyin' ? '抖音' : 'B站'
);

const toErrorBody = (error: unknown): VideoApiErrorBody => {
  if (error && typeof error === 'object') {
    const candidate = error as Partial<VideoApiErrorBody>;
    if (typeof candidate.code === 'string' && typeof candidate.retryable === 'boolean') {
      return {
        code: candidate.code,
        message: typeof candidate.message === 'string' ? candidate.message : '',
        retryable: candidate.retryable,
      };
    }
  }
  return {
    code: 'DEPENDENCY_UNAVAILABLE',
    message: '',
    retryable: true,
  };
};

const isAbortError = (error: unknown): boolean => (
  error instanceof DOMException && error.name === 'AbortError'
);

export default function VideoDownloader({ onClose: _onClose }: VideoDownloaderProps) {
  const [state, dispatch] = useReducer(videoDownloadReducer, initialVideoDownloadState);
  const [url, setUrl] = useState('');
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [inputError, setInputError] = useState('');
  const [statusNote, setStatusNote] = useState('等待粘贴公开视频链接');
  const [isStarting, setIsStarting] = useState(false);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  const requestControllerRef = useRef<AbortController | null>(null);
  const pollControllerRef = useRef<AbortController | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    pollControllerRef.current?.abort();
    pollControllerRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    getHealth(controller.signal)
      .then((result) => {
        if (mountedRef.current) setHealth(result);
      })
      .catch((error: unknown) => {
        if (!isAbortError(error) && mountedRef.current) {
          setHealth({
            status: 'degraded',
            capabilities: { ytDlp: false, ffmpeg: false, douyinCookie: 'missing' },
          });
        }
      });

    return () => {
      mountedRef.current = false;
      controller.abort();
      requestControllerRef.current?.abort();
      stopPolling();
    };
  }, [stopPolling]);

  useEffect(() => {
    setThumbnailFailed(false);
  }, [state.video?.thumbnailUrl]);

  const detectedPlatform = useMemo(() => detectPlatform(url), [url]);
  const selectedQuality = state.video?.qualities.find(
    (quality) => quality.id === state.selectedQualityId,
  ) ?? null;
  const parseUnavailable = health?.capabilities.ytDlp === false;
  const isParsing = state.phase === 'parsing';
  const isJobActive = state.phase === 'downloading';

  const beginPolling = useCallback((activeJobId: string) => {
    stopPolling();
    let consecutiveFailures = 0;

    const poll = async () => {
      if (!mountedRef.current) return;
      const controller = new AbortController();
      pollControllerRef.current = controller;
      try {
        const nextJob = await getDownload(activeJobId, controller.signal);
        if (!mountedRef.current || controller.signal.aborted) return;
        consecutiveFailures = 0;
        dispatch({ type: 'jobUpdated', payload: nextJob });
        setStatusNote(stageLabel(nextJob.stage));
        if (TERMINAL_STAGES.has(nextJob.stage)) return;
      } catch (error) {
        if (!mountedRef.current || controller.signal.aborted || isAbortError(error)) return;
        consecutiveFailures += 1;
        if (consecutiveFailures > 1) {
          const failure = toErrorBody(error);
          dispatch({ type: 'jobFailed', error: failure });
          setStatusNote(errorMessage(failure));
          return;
        }
        setStatusNote('网络波动，正在重试任务状态');
      }
      pollTimerRef.current = setTimeout(poll, 1000);
    };

    void poll();
  }, [stopPolling]);

  const handleParse = async (event: FormEvent) => {
    event.preventDefault();
    const target = url.trim();
    if (!target) {
      setInputError('请输入抖音或 B 站公开视频链接。');
      inputRef.current?.focus();
      return;
    }
    if (parseUnavailable) return;

    stopPolling();
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setInputError('');
    setStatusNote('正在解析视频信息');
    dispatch({ type: 'parseStarted' });
    try {
      const result = await parseVideo(target, controller.signal);
      if (!mountedRef.current || controller.signal.aborted) return;
      dispatch({ type: 'parseSucceeded', payload: result });
      setStatusNote(`已识别${platformName(result.video.platform)}公开视频`);
    } catch (error) {
      if (!mountedRef.current || controller.signal.aborted || isAbortError(error)) return;
      const failure = toErrorBody(error);
      dispatch({ type: 'parseFailed', error: failure });
      setStatusNote(errorMessage(failure));
    } finally {
      if (requestControllerRef.current === controller) requestControllerRef.current = null;
    }
  };

  const handlePaste = async () => {
    setInputError('');
    try {
      const clipboardText = await navigator.clipboard.readText();
      if (clipboardText.trim()) {
        setUrl(clipboardText.trim());
        setStatusNote('已粘贴链接，可以开始解析');
      } else {
        setInputError('剪贴板没有可用链接，请手动粘贴。');
        inputRef.current?.focus();
      }
    } catch {
      setInputError('无法读取剪贴板，请手动粘贴链接。');
      inputRef.current?.focus();
    }
  };

  const handleStartDownload = async () => {
    if (!state.parseToken || !selectedQuality || isStarting) return;
    const controller = new AbortController();
    requestControllerRef.current?.abort();
    requestControllerRef.current = controller;
    setIsStarting(true);
    setStatusNote('正在创建下载任务');
    try {
      const created = await createDownload(
        state.parseToken,
        selectedQuality.id,
        controller.signal,
      );
      if (!mountedRef.current || controller.signal.aborted) return;
      dispatch({ type: 'jobCreated', jobId: created.jobId });
      setStatusNote('正在排队');
      beginPolling(created.jobId);
    } catch (error) {
      if (!mountedRef.current || controller.signal.aborted || isAbortError(error)) return;
      const failure = toErrorBody(error);
      dispatch({ type: 'jobFailed', error: failure });
      setStatusNote(errorMessage(failure));
    } finally {
      if (mountedRef.current) setIsStarting(false);
      if (requestControllerRef.current === controller) requestControllerRef.current = null;
    }
  };

  const handleCancel = async () => {
    if (!state.jobId) return;
    stopPolling();
    const controller = new AbortController();
    requestControllerRef.current?.abort();
    requestControllerRef.current = controller;
    try {
      const cancelled = await cancelDownload(state.jobId, controller.signal);
      if (!mountedRef.current || controller.signal.aborted) return;
      dispatch({ type: 'jobUpdated', payload: cancelled });
      setStatusNote(stageLabel(cancelled.stage));
    } catch (error) {
      if (!mountedRef.current || controller.signal.aborted || isAbortError(error)) return;
      const failure = toErrorBody(error);
      dispatch({ type: 'jobFailed', error: failure });
      setStatusNote(errorMessage(failure));
    } finally {
      if (requestControllerRef.current === controller) requestControllerRef.current = null;
    }
  };

  const resetFlow = () => {
    requestControllerRef.current?.abort();
    stopPolling();
    dispatch({ type: 'reset' });
    setUrl('');
    setInputError('');
    setStatusNote('等待粘贴公开视频链接');
    inputRef.current?.focus();
  };

  const visibleError = inputError || (state.error ? errorMessage(state.error) : '');
  const progress = Math.min(100, Math.max(0, state.job?.progress ?? 0));

  return (
    <section className="overflow-hidden rounded-[2rem] border border-[#ddc6ad] bg-[#fffaf2]/95 shadow-[0_24px_70px_rgba(113,68,35,0.12)] backdrop-blur-xl">
      <div className="px-5 py-8 sm:px-8 sm:py-10 lg:px-12 lg:py-12">
        <header className="mx-auto max-w-3xl text-center">
          <div className="mx-auto mb-5 flex w-fit items-center gap-2 whitespace-nowrap rounded-full border border-[#e6c8aa] bg-[#fff3e5] px-3 py-1.5 text-xs font-bold tracking-wide text-[#8b4b1e]">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            单个公开视频 · 临时处理
          </div>
          <h2 className="text-3xl font-black tracking-tight text-[#2f241b] sm:text-4xl lg:text-5xl">
            视频解析下载
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-[#6d5a47] sm:text-base">
            支持抖音和哔哩哔哩单个公开视频，识别实际可用清晰度后安全下载。
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2 text-xs font-semibold">
            <span className="rounded-full bg-[#2f241b] px-3 py-1.5 text-[#fffaf2]">抖音</span>
            <span className="rounded-full border border-[#d8b58e] bg-white px-3 py-1.5 text-[#6f3714]">哔哩哔哩</span>
            <span className="inline-flex items-center gap-1 rounded-full border border-[#cbd7bb] bg-[#f1f5e9] px-3 py-1.5 text-[#52643b]">
              <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />
              匿名会话保护
            </span>
          </div>
        </header>

        <form onSubmit={handleParse} className="mx-auto mt-8 max-w-4xl">
          <label htmlFor="video-url" className="mb-2 block text-sm font-bold text-[#49382a]">
            抖音或 B 站视频链接
          </label>
          <div className="overflow-hidden rounded-2xl border border-[#d9c4ad] bg-white shadow-[0_12px_35px_rgba(108,67,36,0.10)] focus-within:border-[#a76130] focus-within:ring-4 focus-within:ring-[#c88a5d]/15 sm:flex">
            <input
              ref={inputRef}
              id="video-url"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                setInputError('');
              }}
              className="min-h-12 min-w-0 flex-1 bg-transparent px-4 py-3 text-base text-[#2f241b] outline-none placeholder:text-[#a38d78] sm:px-5"
              placeholder="粘贴抖音或 B 站单个公开视频链接"
              autoComplete="url"
              inputMode="url"
            />
            <div className="flex border-t border-[#eadaca] sm:border-l sm:border-t-0">
              <button
                type="button"
                onClick={handlePaste}
                className="min-h-11 flex-1 px-5 py-3 text-sm font-bold text-[#6f4c32] transition-colors hover:bg-[#fff4e7] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#c88a5d]/30 motion-reduce:transition-none sm:flex-none"
              >
                粘贴
              </button>
              <button
                type="submit"
                disabled={isParsing || parseUnavailable}
                className="min-h-11 flex-1 whitespace-nowrap bg-[#2f241b] px-4 py-3 text-sm font-bold text-[#fff8ef] transition-colors hover:bg-[#5f3214] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#9a5a28]/30 disabled:cursor-not-allowed disabled:bg-[#a9998b] motion-reduce:transition-none sm:flex-none sm:px-6"
              >
                <span className="inline-flex items-center justify-center gap-2">
                  {isParsing && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                  {parseUnavailable ? '解析服务暂不可用' : isParsing ? '正在解析' : '解析视频'}
                </span>
              </button>
            </div>
          </div>
          <div className="mt-2 flex min-h-6 flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-[#846f5d]">
              {detectedPlatform ? `已识别：${platformName(detectedPlatform)}` : '支持 douyin.com、bilibili.com 和 b23.tv'}
            </span>
            {health?.status === 'degraded' && (
              <span className="font-semibold text-[#a64b3c]">部分处理能力暂不可用</span>
            )}
          </div>
        </form>

        <div className="mx-auto mt-3 max-w-4xl" role="status" aria-live="polite" aria-atomic="true">
          <p className="sr-only">{statusNote}</p>
        </div>
        {visibleError && (
          <div className="mx-auto mt-3 max-w-4xl rounded-xl border border-[#e6b6aa] bg-[#fff1ee] px-4 py-3 text-sm font-semibold text-[#914638]" role="alert">
            {visibleError}
          </div>
        )}

        {!state.video ? (
          <div className="mt-10 sm:mt-12">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map(({ icon: Icon, title, copy }) => (
                <article key={title} className="rounded-2xl border border-[#ead7c6] bg-[#fff7f3] p-5 text-center shadow-sm">
                  <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-[#f7ddc6] text-[#9a4f25]">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <h2 className="mt-4 font-black text-[#2f241b]">{title}</h2>
                  <p className="mt-2 text-xs leading-5 text-[#786451]">{copy}</p>
                </article>
              ))}
            </div>

            <div className="mt-10">
              <h2 className="text-center text-xl font-black text-[#2f241b] sm:text-2xl">如何使用</h2>
              <div className="mt-5 grid gap-3 lg:grid-cols-3">
                {STEPS.map(({ icon: Icon, title, copy }, index) => (
                  <article key={title} className="flex min-w-0 gap-4 rounded-2xl border border-[#e5d7c8] bg-white/80 p-5">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#ece8df] text-[#49382a]">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-[#a15e31]">步骤 {index + 1}</p>
                      <h3 className="mt-1 font-black text-[#2f241b]">{title}</h3>
                      <p className="mt-1 break-words text-sm leading-6 text-[#6d5a47]">{copy}</p>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-8 grid min-w-0 gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <article className="min-w-0 overflow-hidden rounded-3xl border border-[#ddcbb9] bg-white shadow-sm">
              <div className="aspect-video bg-[#eee5da]">
                {state.video.thumbnailUrl && !thumbnailFailed ? (
                  <img
                    src={state.video.thumbnailUrl}
                    alt={`${state.video.title}的视频封面`}
                    referrerPolicy="no-referrer"
                    onError={() => setThumbnailFailed(true)}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-3 text-[#8b735c]">
                    <Film className="h-10 w-10" aria-hidden="true" />
                    <span className="text-sm font-bold">{platformName(state.video.platform)}封面暂不可用</span>
                  </div>
                )}
              </div>
              <div className="p-5">
                <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                  <span className="rounded-full bg-[#2f241b] px-2.5 py-1 text-[#fff8ef]">{platformName(state.video.platform)}</span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#f3eadf] px-2.5 py-1 text-[#6d5038]">
                    <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                    {formatDuration(state.video.durationSeconds)}
                  </span>
                </div>
                <h2 className="mt-3 break-words text-xl font-black leading-8 text-[#2f241b]">{state.video.title}</h2>
                <p className="mt-2 break-words text-sm text-[#786451]">{state.video.author || '作者信息未提供'}</p>
              </div>
            </article>

            <section className="min-w-0 rounded-3xl border border-[#ddcbb9] bg-[#fffdf9] p-5 shadow-sm sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#9a5a28]">选择下载档位</p>
                  <h2 className="mt-1 text-xl font-black text-[#2f241b]">实际可用清晰度</h2>
                </div>
                <button
                  type="button"
                  onClick={resetFlow}
                  className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-[#dfc9b2] px-3 py-2 text-sm font-bold text-[#6f4c32] transition hover:bg-[#fff3e4] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#c88a5d]/25 motion-reduce:transition-none"
                >
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  换一个
                </button>
              </div>

              <div className="mt-5 grid gap-3" role="group" aria-label="视频清晰度">
                {state.video.qualities.map((quality) => {
                  const selected = state.selectedQualityId === quality.id;
                  const mergeUnavailable = quality.requiresMerge && health?.capabilities.ffmpeg === false;
                  const accessibleLabel = `${quality.label} · ${quality.extension.toUpperCase()} · ${formatBytes(quality.estimatedBytes)}`;
                  return (
                    <button
                      key={quality.id}
                      type="button"
                      aria-label={accessibleLabel}
                      aria-pressed={selected}
                      disabled={mergeUnavailable || isJobActive}
                      onClick={() => dispatch({ type: 'qualitySelected', qualityId: quality.id })}
                      className={`min-h-11 min-w-0 rounded-2xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#c88a5d]/25 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none ${
                        selected
                          ? 'border-[#965026] bg-[#fff0df] shadow-sm'
                          : 'border-[#e3d4c5] bg-white hover:border-[#c4946c]'
                      }`}
                    >
                      <span className="flex min-w-0 items-start justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block break-words font-black text-[#2f241b]">
                            {quality.label} · {quality.extension.toUpperCase()}
                          </span>
                          <span className="mt-1 block text-xs text-[#786451]">{formatBytes(quality.estimatedBytes)}</span>
                        </span>
                        {selected && (
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#7a421b] text-[#fff8ef]">
                            <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          </span>
                        )}
                      </span>
                      <span className="mt-2 flex flex-wrap gap-2 text-xs font-semibold">
                        {quality.requiresMerge && <span className="text-[#9a5a28]">需要合并音视频</span>}
                        {!quality.hasAudio && <span className="text-[#a64b3c]">该源不含音频</span>}
                        {mergeUnavailable && <span className="text-[#a64b3c]">服务器缺少 FFmpeg</span>}
                      </span>
                    </button>
                  );
                })}
              </div>

              {(state.job || state.jobId) && (
                <div className="mt-5 rounded-2xl border border-[#ddccb9] bg-[#f8f2ea] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-black text-[#2f241b]">{state.job ? stageLabel(state.job.stage) : statusNote}</p>
                    <span className="text-sm font-bold tabular-nums text-[#7a421b]">{Math.round(progress)}%</span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#e5d7c8]" role="progressbar" aria-label="下载进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
                    <div className="h-full rounded-full bg-[#8d4b24] transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${progress}%` }} />
                  </div>
                  {state.job && (
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#786451]">
                      <span>{formatBytes(state.job.downloadedBytes)} / {formatBytes(state.job.totalBytes)}</span>
                      {state.job.speedBytesPerSecond !== null && <span>{formatBytes(state.job.speedBytesPerSecond)}/s</span>}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                {state.job?.stage === 'completed' && state.jobId ? (
                  <a
                    download
                    href={downloadFileUrl(state.jobId)}
                    className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#2f241b] px-5 py-3 text-sm font-black text-[#fff8ef] transition hover:bg-[#5f3214] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#9a5a28]/30 motion-reduce:transition-none"
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    保存视频
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={handleStartDownload}
                    disabled={!selectedQuality || isStarting || isJobActive || (selectedQuality.requiresMerge && health?.capabilities.ffmpeg === false)}
                    className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#2f241b] px-5 py-3 text-sm font-black text-[#fff8ef] transition hover:bg-[#5f3214] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#9a5a28]/30 disabled:cursor-not-allowed disabled:bg-[#a9998b] motion-reduce:transition-none"
                  >
                    {isStarting ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
                    {isStarting ? '正在创建任务' : '开始下载'}
                  </button>
                )}
                {isJobActive && (
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#d8b58e] bg-white px-5 py-3 text-sm font-bold text-[#7a421b] transition hover:bg-[#fff4e7] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#c88a5d]/25 motion-reduce:transition-none"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                    取消下载
                  </button>
                )}
              </div>
            </section>
          </div>
        )}
      </div>

      <footer className="border-t border-[#e1cfbd] bg-[#f7efe6]/90 px-5 py-4 text-center text-xs leading-5 text-[#715d4b] sm:px-8">
        仅下载你拥有权利或已获授权的公开视频；请遵守平台条款与著作权规则。本站不保证去水印、固定清晰度或永久可用。
      </footer>
    </section>
  );
}
