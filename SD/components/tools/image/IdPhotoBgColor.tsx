import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { canvasToBlob, downloadBlob, loadImageFromBlob, useFileObjectUrl } from '../shared';
import MaskEditorCanvas from './id-photo/MaskEditorCanvas';
import { compositeRgba, estimateCornerBackground } from './id-photo/composite';
import {
  applyOverrides,
  buildPersonAlpha,
  paintOverride,
  pushMaskHistory,
  resampleAlpha,
  undoMaskHistory,
} from './id-photo/mask';
import { resetPortraitSegmenter, segmentPortrait } from './id-photo/segmentation';
import type {
  OverrideMode,
  PhotoBackground,
  RgbColor,
  SegmentationSnapshot,
} from './id-photo/types';

type ProcessingState =
  | { status: 'idle'; message: string }
  | { status: 'loading-model'; message: string }
  | { status: 'segmenting'; message: string }
  | { status: 'ready'; message: string }
  | { status: 'error'; kind: 'model' | 'browser' | 'image' | 'person' | 'export'; message: string };

type PreviewTab = 'result' | 'source' | 'mask';
type BackgroundId = 'white' | 'blue' | 'red' | 'gradient' | 'custom';

interface LoadedPhoto {
  name: string;
  width: number;
  height: number;
  canvas: HTMLCanvasElement;
  pixels: Uint8ClampedArray;
}

const BACKGROUNDS: ReadonlyArray<{
  id: Exclude<BackgroundId, 'custom'>;
  label: string;
  value: PhotoBackground;
  swatch: string;
}> = [
  { id: 'white', label: '白底', value: { kind: 'solid', color: [255, 255, 255] }, swatch: '#ffffff' },
  { id: 'blue', label: '蓝底', value: { kind: 'solid', color: [67, 142, 219] }, swatch: '#438edb' },
  { id: 'red', label: '红底', value: { kind: 'solid', color: [208, 60, 60] }, swatch: '#d03c3c' },
  {
    id: 'gradient',
    label: '渐变蓝',
    value: { kind: 'vertical-gradient', top: [105, 180, 242], bottom: [38, 103, 184] },
    swatch: 'linear-gradient(180deg, #69b4f2, #2667b8)',
  },
];

export function parseHexColor(value: string): RgbColor {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(value);
  if (!match) throw new Error('Invalid six-digit hex color');
  return [Number.parseInt(match[1], 16), Number.parseInt(match[2], 16), Number.parseInt(match[3], 16)];
}

const IdPhotoBgColor: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const resultCanvasRef = useRef<HTMLCanvasElement>(null);
  const runIdRef = useRef(0);
  const [file, setFile] = useState<File | null>(null);
  const [photo, setPhoto] = useState<LoadedPhoto | null>(null);
  const [snapshot, setSnapshot] = useState<SegmentationSnapshot | null>(null);
  const [overrides, setOverrides] = useState<Int8Array>(() => new Int8Array());
  const [history, setHistory] = useState<Int8Array[]>([]);
  const [processing, setProcessing] = useState<ProcessingState>({
    status: 'idle',
    message: '请选择一张正面、清晰、光线均匀的证件照。',
  });
  const [threshold, setThreshold] = useState(0.5);
  const [feather, setFeather] = useState(2);
  const [brushRadius, setBrushRadius] = useState(8);
  const [brushMode, setBrushMode] = useState<OverrideMode>('erase');
  const [showOverlay, setShowOverlay] = useState(true);
  const [backgroundId, setBackgroundId] = useState<BackgroundId>('blue');
  const [customColor, setCustomColor] = useState('#438edb');
  const [previewTab, setPreviewTab] = useState<PreviewTab>('result');
  const fileUrl = useFileObjectUrl(file ?? undefined);

  const processFile = useCallback(async (selectedFile: File) => {
    const runId = ++runIdRef.current;
    let stage: 'image' | 'model' = 'image';
    setPhoto(null);
    setSnapshot(null);
    setHistory([]);
    setOverrides(new Int8Array());
    setProcessing({ status: 'loading-model', message: '正在解码照片并准备本地 AI 模型…' });

    try {
      if (typeof document === 'undefined' || typeof WebAssembly === 'undefined') {
        throw new Error('当前浏览器不支持本地 AI 图像处理');
      }
      const image = await loadImageFromBlob(selectedFile);
      if (runId !== runIdRef.current) return;
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      if (!width || !height) throw new Error('无法读取照片尺寸');
      if (width * height > 40_000_000) throw new Error('照片像素超过 4000 万，请先缩小后再试');

      const sourceCanvas = document.createElement('canvas');
      sourceCanvas.width = width;
      sourceCanvas.height = height;
      const context = sourceCanvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('浏览器无法创建图像画布');
      context.drawImage(image, 0, 0, width, height);
      const pixels = new Uint8ClampedArray(context.getImageData(0, 0, width, height).data);

      stage = 'model';
      setProcessing({ status: 'segmenting', message: 'AI 人像分割中，首次使用需加载约 16.4 MB 模型…' });
      const nextSnapshot = await segmentPortrait(image);
      if (runId !== runIdRef.current) return;

      setPhoto({ name: selectedFile.name, width, height, canvas: sourceCanvas, pixels });
      setSnapshot(nextSnapshot);
      setOverrides(new Int8Array(nextSnapshot.width * nextSnapshot.height));
      setPreviewTab('result');
      setProcessing({ status: 'ready', message: '人像分割完成，可调整边缘或直接下载。' });
    } catch (error) {
      if (runId !== runIdRef.current) return;
      const message = error instanceof Error ? error.message : '未知错误';
      const noPerson = /person|人像|人物/i.test(message);
      setProcessing({
        status: 'error',
        kind: noPerson ? 'person' : stage === 'model' ? 'model' : 'image',
        message: noPerson ? '未识别到清晰人像，请换一张正面照片。' : `处理失败：${message}`,
      });
    }
  }, []);

  useEffect(() => {
    if (file) void processFile(file);
  }, [file, processFile]);

  useEffect(() => () => {
    runIdRef.current += 1;
  }, []);

  const automaticAlpha = useMemo(() => {
    if (!snapshot) return null;
    return buildPersonAlpha({ ...snapshot, threshold, featherRadius: feather });
  }, [feather, snapshot, threshold]);

  const editedMaskAlpha = useMemo(() => {
    if (!automaticAlpha || automaticAlpha.length !== overrides.length) return null;
    return applyOverrides(automaticAlpha, overrides);
  }, [automaticAlpha, overrides]);

  const background = useMemo<PhotoBackground>(() => {
    if (backgroundId === 'custom') return { kind: 'solid', color: parseHexColor(customColor) };
    return BACKGROUNDS.find((item) => item.id === backgroundId)?.value ?? BACKGROUNDS[1].value;
  }, [backgroundId, customColor]);

  const compositeBuffer = useMemo(() => {
    if (!photo || !snapshot || !editedMaskAlpha) return null;
    const fullResolutionAlpha = resampleAlpha(
      editedMaskAlpha,
      snapshot.width,
      snapshot.height,
      photo.width,
      photo.height,
    );
    return compositeRgba({
      source: photo.pixels,
      alpha: fullResolutionAlpha,
      width: photo.width,
      height: photo.height,
      background,
      estimatedOriginalBackground: estimateCornerBackground(
        photo.pixels,
        photo.width,
        photo.height,
        Math.min(24, Math.max(1, Math.floor(Math.min(photo.width, photo.height) * 0.03))),
      ),
    });
  }, [background, editedMaskAlpha, photo, snapshot]);

  useEffect(() => {
    const canvas = resultCanvasRef.current;
    if (!canvas || !photo || !compositeBuffer) return;
    canvas.width = photo.width;
    canvas.height = photo.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.putImageData(new ImageData(new Uint8ClampedArray(compositeBuffer), photo.width, photo.height), 0, 0);
  }, [compositeBuffer, photo, previewTab]);

  const busy = processing.status === 'loading-model' || processing.status === 'segmenting';
  const ready = processing.status === 'ready' && photo && snapshot && automaticAlpha && editedMaskAlpha;

  const clearPhoto = () => {
    runIdRef.current += 1;
    setFile(null);
    setPhoto(null);
    setSnapshot(null);
    setOverrides(new Int8Array());
    setHistory([]);
    setProcessing({ status: 'idle', message: '请选择一张正面、清晰、光线均匀的证件照。' });
    if (inputRef.current) inputRef.current.value = '';
  };

  const retry = async () => {
    if (!file) return;
    await resetPortraitSegmenter();
    await processFile(file);
  };

  const exportPhoto = async (format: 'png' | 'jpeg') => {
    if (!photo || !compositeBuffer) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = photo.width;
      canvas.height = photo.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('浏览器无法创建导出画布');
      context.putImageData(new ImageData(new Uint8ClampedArray(compositeBuffer), photo.width, photo.height), 0, 0);
      const blob = await canvasToBlob(canvas, `image/${format}`, format === 'jpeg' ? 0.95 : undefined);
      const baseName = photo.name.replace(/\.[^.]+$/, '') || '证件照';
      downloadBlob(blob, `${baseName}_换底.${format === 'jpeg' ? 'jpg' : 'png'}`);
      setProcessing({ status: 'ready', message: `${format.toUpperCase()} 已生成并开始下载。` });
    } catch (error) {
      setProcessing({
        status: 'error',
        kind: 'export',
        message: `导出失败：${error instanceof Error ? error.message : '未知错误'}`,
      });
    }
  };

  return (
    <section className="space-y-5 text-[#2f241b]" aria-labelledby="id-photo-ai-title">
      <header className="rounded-xl border border-[#d8b58e] bg-[#fff4e6]/80 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8a4b1f]">AI 人像分割</p>
            <h2 id="id-photo-ai-title" className="mt-1 text-xl font-semibold">证件照智能换底色</h2>
            <p className="mt-1 text-sm text-[#6d5a47]">照片仅在当前浏览器处理，不会上传到服务器。</p>
          </div>
          <span className="rounded-full border border-[#c8a47d] bg-white/70 px-3 py-1 text-xs text-[#6f3714]">本地处理</span>
        </div>
      </header>

      <input
        ref={inputRef}
        id="id-photo-upload"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        disabled={busy}
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />

      {!file ? (
        <label
          htmlFor="id-photo-upload"
          className="block cursor-pointer rounded-xl border-2 border-dashed border-[#c79f72] bg-[#fff4e6]/70 p-10 text-center transition hover:border-[#9a5a28] hover:bg-[#f1dcc2]/70 focus-within:ring-2 focus-within:ring-[#9a5a28]"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const droppedFile = event.dataTransfer.files[0];
            if (droppedFile?.type.startsWith('image/')) setFile(droppedFile);
          }}
        >
          <span className="block text-base font-medium text-[#5f3214]">上传证件照</span>
          <span className="mt-1 block text-sm text-[#7a6654]">支持 JPG、PNG、WebP，可点击或拖入照片</span>
        </label>
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-[#d8b58e] bg-white/60 px-3 py-2 text-sm">
          <span className="min-w-0 truncate">{file.name}</span>
          <button type="button" className="shrink-0 text-red-700 hover:underline" onClick={clearPhoto}>移除照片</button>
        </div>
      )}

      <div
        aria-live="polite"
        className={`rounded-lg border px-3 py-2 text-sm ${processing.status === 'error' ? 'border-red-300 bg-red-50 text-red-800' : 'border-[#d8b58e] bg-[#fffaf4] text-[#6d5a47]'}`}
      >
        {busy && <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-[#9a5a28] border-t-transparent" aria-hidden="true" />}
        {processing.message}
        {processing.status === 'error' && file && (
          <button type="button" className="ml-3 font-medium underline" onClick={() => void retry()}>重试</button>
        )}
      </div>

      {ready && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-3">
            <div role="tablist" aria-label="照片预览" className="flex rounded-lg bg-[#ead0ad]/70 p-1">
              {([
                ['result', '换底结果'],
                ['source', '原图'],
                ['mask', '蒙版修正'],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={previewTab === id}
                  className={`flex-1 rounded-md px-3 py-2 text-sm ${previewTab === id ? 'bg-white font-medium text-[#5f3214] shadow-sm' : 'text-[#7a6654]'}`}
                  onClick={() => setPreviewTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex min-h-72 items-center justify-center overflow-hidden rounded-xl border border-[#d8b58e] bg-[linear-gradient(45deg,#eadbc8_25%,transparent_25%),linear-gradient(-45deg,#eadbc8_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#eadbc8_75%),linear-gradient(-45deg,transparent_75%,#eadbc8_75%)] bg-[length:20px_20px]">
              {previewTab === 'source' && <img src={fileUrl} alt="原始证件照" className="max-h-[32rem] max-w-full object-contain" />}
              {previewTab === 'result' && <canvas ref={resultCanvasRef} aria-label="换底结果预览" className="max-h-[32rem] max-w-full object-contain" />}
              {previewTab === 'mask' && (
                <MaskEditorCanvas
                  image={photo.canvas}
                  alpha={editedMaskAlpha}
                  overrides={overrides}
                  maskWidth={snapshot.width}
                  maskHeight={snapshot.height}
                  brushRadius={brushRadius}
                  mode={brushMode}
                  showOverlay={showOverlay}
                  onStrokeStart={() => setHistory((current) => pushMaskHistory(current, overrides, 20))}
                  onPaint={(point) => setOverrides((current) => paintOverride(current, snapshot.width, snapshot.height, {
                    ...point,
                    radius: brushRadius,
                    mode: brushMode,
                  }))}
                />
              )}
            </div>
          </div>

          <aside className="space-y-5 rounded-xl border border-[#d8b58e] bg-[#fffaf4] p-4">
            <fieldset disabled={busy}>
              <legend className="text-sm font-semibold">背景颜色</legend>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {BACKGROUNDS.map((item) => (
                  <label key={item.id} className={`cursor-pointer rounded-lg border p-2 text-center text-xs ${backgroundId === item.id ? 'border-[#7a421b] bg-[#f1dcc2]' : 'border-[#d8b58e] bg-white'}`}>
                    <input type="radio" name="photo-background" className="sr-only" checked={backgroundId === item.id} onChange={() => setBackgroundId(item.id)} />
                    <span className="mx-auto mb-1 block h-6 w-6 rounded-full border border-black/10" style={{ background: item.swatch }} />
                    {item.label}
                  </label>
                ))}
                <label className={`cursor-pointer rounded-lg border p-2 text-center text-xs ${backgroundId === 'custom' ? 'border-[#7a421b] bg-[#f1dcc2]' : 'border-[#d8b58e] bg-white'}`}>
                  <input type="radio" name="photo-background" className="sr-only" checked={backgroundId === 'custom'} onChange={() => setBackgroundId('custom')} />
                  <input
                    type="color"
                    aria-label="自定义背景颜色"
                    value={customColor}
                    className="mx-auto mb-1 block h-6 w-8 cursor-pointer border-0 bg-transparent p-0"
                    onChange={(event) => { setCustomColor(event.target.value); setBackgroundId('custom'); }}
                  />
                  自定义
                </label>
              </div>
            </fieldset>

            <div className="space-y-4">
              <label className="block text-sm font-medium">
                人物判定阈值 <span className="float-right font-normal text-[#7a6654]">{threshold.toFixed(2)}</span>
                <input type="range" min="0.2" max="0.8" step="0.01" value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} className="mt-2 w-full accent-[#7a421b]" />
              </label>
              <label className="block text-sm font-medium">
                边缘柔化 <span className="float-right font-normal text-[#7a6654]">{feather}px</span>
                <input type="range" min="0" max="12" step="1" value={feather} onChange={(event) => setFeather(Number(event.target.value))} className="mt-2 w-full accent-[#7a421b]" />
              </label>
              <label className="block text-sm font-medium">
                画笔大小 <span className="float-right font-normal text-[#7a6654]">{brushRadius}px</span>
                <input type="range" min="1" max="32" step="1" value={brushRadius} onChange={(event) => setBrushRadius(Number(event.target.value))} className="mt-2 w-full accent-[#7a421b]" />
              </label>
            </div>

            <div>
              <p className="text-sm font-semibold">手工修正</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button type="button" className={`rounded-lg border px-3 py-2 text-sm ${brushMode === 'erase' ? 'border-red-500 bg-red-50 text-red-700' : 'border-[#d8b58e]'}`} onClick={() => { setBrushMode('erase'); setPreviewTab('mask'); }}>擦除人物</button>
                <button type="button" className={`rounded-lg border px-3 py-2 text-sm ${brushMode === 'restore' ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-[#d8b58e]'}`} onClick={() => { setBrushMode('restore'); setPreviewTab('mask'); }}>恢复人物</button>
                <button
                  type="button"
                  disabled={history.length === 0}
                  className="rounded-lg border border-[#d8b58e] px-3 py-2 text-sm disabled:opacity-40"
                  onClick={() => {
                    const previous = undoMaskHistory(history);
                    if (!previous) return;
                    setOverrides(previous.mask);
                    setHistory(previous.history);
                  }}
                >撤销</button>
                <button
                  type="button"
                  className="rounded-lg border border-[#d8b58e] px-3 py-2 text-sm"
                  onClick={() => {
                    setHistory((current) => pushMaskHistory(current, overrides, 20));
                    setOverrides(new Int8Array(overrides.length));
                  }}
                >重置蒙版</button>
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm text-[#6d5a47]">
                <input type="checkbox" checked={showOverlay} onChange={(event) => setShowOverlay(event.target.checked)} className="accent-[#7a421b]" />
                显示蒙版叠层
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="rounded-lg bg-[#7a421b] px-3 py-2 text-sm font-medium text-white hover:bg-[#5f3214]" onClick={() => void exportPhoto('png')}>下载 PNG</button>
              <button type="button" className="rounded-lg bg-[#7a421b] px-3 py-2 text-sm font-medium text-white hover:bg-[#5f3214]" onClick={() => void exportPhoto('jpeg')}>下载 JPG</button>
            </div>
          </aside>
        </div>
      )}

      <button type="button" onClick={onClose} className="rounded-lg bg-[#f1dcc2] px-4 py-2 text-sm font-medium text-[#6f3714] hover:bg-[#ead0ad]">关闭</button>
    </section>
  );
};

export default IdPhotoBgColor;
