import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  ImageDropzone,
  ImageWorkbench,
} from '../image-workbench';
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

export function calculateInferenceSize(
  width: number,
  height: number,
  maximumEdge = 1024,
): { width: number; height: number } {
  if (width <= 0 || height <= 0 || maximumEdge <= 0) throw new Error('Image dimensions must be positive');
  const scale = Math.min(1, maximumEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

const IdPhotoBgColor: React.FC<{ onClose: () => void }> = ({ onClose }) => {
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

      const inferenceSize = calculateInferenceSize(width, height);
      const inferenceCanvas = document.createElement('canvas');
      inferenceCanvas.width = inferenceSize.width;
      inferenceCanvas.height = inferenceSize.height;
      const inferenceContext = inferenceCanvas.getContext('2d');
      if (!inferenceContext) throw new Error('浏览器无法创建 AI 推理画布');
      inferenceContext.drawImage(image, 0, 0, inferenceSize.width, inferenceSize.height);
      sourceCanvas.width = 1;
      sourceCanvas.height = 1;

      stage = 'model';
      setProcessing({ status: 'segmenting', message: 'AI 人像分割中，首次使用需加载约 16.4 MB 模型…' });
      const nextSnapshot = await segmentPortrait(inferenceCanvas);
      if (runId !== runIdRef.current) return;

      setPhoto({ name: selectedFile.name, width, height, canvas: inferenceCanvas, pixels });
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
    <ImageWorkbench
      upload={(
        <>
          {!file ? (
            <ImageDropzone
              accept="image/jpeg,image/png,image/webp"
              multiple={false}
              onFiles={(files) => setFile(files[0] ?? null)}
              disabled={busy}
              title="上传证件照"
              description="支持 JPG、PNG、WebP，可点击或拖入照片"
            />
          ) : (
            <div className="image-workbench__special-file">
              <span>{file.name}</span>
              <button type="button" className="image-workbench__button image-workbench__button--secondary" onClick={clearPhoto}>移除照片</button>
            </div>
          )}
        </>
      )}
      controls={(
        <>
          {!ready ? (
            <p className="image-workbench__parameter-description">完成本地人像分割后，可在这里调整背景和蒙版。</p>
          ) : (
            <>
              <fieldset className="image-workbench__control" disabled={busy}>
                <legend className="image-workbench__control-label">背景颜色</legend>
                <div className="image-workbench__preset-options">
                  {BACKGROUNDS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="image-workbench__preset"
                      aria-pressed={backgroundId === item.id}
                      onClick={() => setBackgroundId(item.id)}
                    >
                      <span className="image-workbench__color-swatch" style={{ background: item.swatch }} aria-hidden="true" />
                      {item.label}
                    </button>
                  ))}
                  <label className="image-workbench__preset">
                    <input
                      type="color"
                      aria-label="自定义背景颜色"
                      value={customColor}
                      onChange={(event) => { setCustomColor(event.target.value); setBackgroundId('custom'); }}
                    />
                    自定义
                  </label>
                </div>
              </fieldset>
              <label className="image-workbench__control">
                <span className="image-workbench__control-label">人物判定阈值 · {threshold.toFixed(2)}</span>
                <input type="range" min="0.2" max="0.8" step="0.01" value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} />
              </label>
              <label className="image-workbench__control">
                <span className="image-workbench__control-label">边缘柔化 · {feather}px</span>
                <input type="range" min="0" max="12" step="1" value={feather} onChange={(event) => setFeather(Number(event.target.value))} />
              </label>
              <label className="image-workbench__control">
                <span className="image-workbench__control-label">画笔大小 · {brushRadius}px</span>
                <input type="range" min="1" max="32" step="1" value={brushRadius} onChange={(event) => setBrushRadius(Number(event.target.value))} />
              </label>
              <fieldset className="image-workbench__control">
                <legend className="image-workbench__control-label">手工修正</legend>
                <div className="image-workbench__preset-options">
                  <button type="button" className="image-workbench__preset" aria-pressed={brushMode === 'erase'} onClick={() => { setBrushMode('erase'); setPreviewTab('mask'); }}>擦除人物</button>
                  <button type="button" className="image-workbench__preset" aria-pressed={brushMode === 'restore'} onClick={() => { setBrushMode('restore'); setPreviewTab('mask'); }}>恢复人物</button>
                  <button type="button" className="image-workbench__preset" disabled={history.length === 0} onClick={() => {
                    const previous = undoMaskHistory(history);
                    if (!previous) return;
                    setOverrides(previous.mask);
                    setHistory(previous.history);
                  }}>撤销</button>
                  <button type="button" className="image-workbench__preset" onClick={() => {
                    setHistory((current) => pushMaskHistory(current, overrides, 20));
                    setOverrides(new Int8Array(overrides.length));
                  }}>重置蒙版</button>
                </div>
                <label className="image-workbench__control-help">
                  <input type="checkbox" checked={showOverlay} onChange={(event) => setShowOverlay(event.target.checked)} />
                  显示蒙版叠层
                </label>
              </fieldset>
            </>
          )}
        </>
      )}
      preview={(
        <div className="image-workbench__special-preview">
          {ready ? (
            <>
              <div role="tablist" aria-label="照片预览" className="image-workbench__preset-options">
                {([
                  ['result', '换底结果'],
                  ['source', '原图'],
                  ['mask', '蒙版修正'],
                ] as const).map(([id, label]) => (
                  <button key={id} type="button" role="tab" aria-selected={previewTab === id} className="image-workbench__preset" onClick={() => setPreviewTab(id)}>{label}</button>
                ))}
              </div>
              <div className="image-workbench__special-preview-stage">
                {previewTab === 'source' && <img src={fileUrl} alt="原始证件照" />}
                {previewTab === 'result' && <canvas ref={resultCanvasRef} aria-label="换底结果预览" />}
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
            </>
          ) : (
            <p className="image-workbench__preview-empty">上传照片后将在这里显示 AI 换底结果</p>
          )}
        </div>
      )}
      actions={(
        <section className="image-workbench__action-bar" aria-label="证件照换底操作">
          <div className="image-workbench__action-status" aria-live="polite">
            {busy ? <span className="image-workbench__busy-dot" aria-hidden="true" /> : null}
            {processing.message}
          </div>
          <div className="image-workbench__action-buttons">
            <button type="button" className="image-workbench__button image-workbench__button--secondary" disabled={!file} onClick={clearPhoto}>重置</button>
            <button type="button" className="image-workbench__button image-workbench__button--primary" disabled={!file || busy} onClick={() => void retry()}>重新分割</button>
            <button type="button" className="image-workbench__button image-workbench__button--secondary" disabled={!ready} onClick={() => void exportPhoto('png')}>下载 PNG</button>
            <button type="button" className="image-workbench__button image-workbench__button--secondary" disabled={!ready} onClick={() => void exportPhoto('jpeg')}>下载 JPG</button>
            <button type="button" className="image-workbench__button image-workbench__button--secondary" onClick={onClose}>关闭</button>
          </div>
        </section>
      )}
      notice={(
        <div className="image-workbench__special-heading">
          <strong>AI 人像分割 · 证件照智能换底色</strong>
          <span>照片仅在当前浏览器处理，不会上传到服务器；首次使用需加载本地模型。</span>
          {processing.status === 'error' && file ? (
            <button type="button" className="image-workbench__button image-workbench__button--secondary" onClick={() => void retry()}>重试</button>
          ) : null}
        </div>
      )}
    />
  );
};

export default IdPhotoBgColor;
