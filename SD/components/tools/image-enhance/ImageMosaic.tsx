import { useRef, useState } from 'react';
import type { FC, PointerEvent as ReactPointerEvent } from 'react';
import {
  BatchImageTool,
  RangeControl,
  SelectControl,
  ToggleControl,
  type BatchItem,
} from '../image-workbench';
import {
  mosaicImageProcessor,
  type MosaicParams,
  type MosaicSelection,
} from './processors/creative';

interface Point {
  x: number;
  y: number;
}

interface MosaicRegionEditorProps {
  selected: BatchItem<MosaicParams> | null;
  params: MosaicParams;
  setParams(params: MosaicParams): void;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function createSelection(start: Point, end: Point): MosaicSelection {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    x,
    y,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function MosaicRegionEditor({ selected, params, setParams }: MosaicRegionEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<Point | null>(null);
  const draftRef = useRef<MosaicSelection | null>(null);
  const [draft, setDraft] = useState<MosaicSelection | null>(null);

  const getPoint = (event: ReactPointerEvent<HTMLDivElement>): Point | null => {
    const metadata = selected?.metadata;
    const container = containerRef.current;
    if (!metadata || !container) return null;
    const rect = container.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: clamp((event.clientX - rect.left) / rect.width),
      y: clamp((event.clientY - rect.top) / rect.height),
    };
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const point = getPoint(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    startRef.current = point;
    draftRef.current = { x: point.x, y: point.y, width: 0, height: 0 };
    setDraft(draftRef.current);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = startRef.current;
    const point = getPoint(event);
    if (!start || !point) return;
    const next = createSelection(start, point);
    draftRef.current = next;
    setDraft(next);
  };

  const finishSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = draftRef.current;
    if (current && current.width >= 0.01 && current.height >= 0.01) {
      setParams({ ...params, regions: [...params.regions, current] });
    }
    startRef.current = null;
    draftRef.current = null;
    setDraft(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <section className="image-workbench__mosaic-editor" aria-label="选择区域">
      <div className="image-workbench__control-label">选择区域</div>
      {selected?.sourceUrl ? (
        <div
          ref={containerRef}
          className="image-workbench__mosaic-canvas"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishSelection}
          onPointerCancel={finishSelection}
          role="application"
          aria-label="在图片上拖拽选择马赛克区域"
        >
          <img src={selected.sourceUrl} alt="待处理图片" />
          {params.regions.map((region, index) => (
            <span
              key={`${region.x}-${region.y}-${index}`}
              className="image-workbench__mosaic-region"
              style={{
                left: `${region.x * 100}%`,
                top: `${region.y * 100}%`,
                width: `${region.width * 100}%`,
                height: `${region.height * 100}%`,
              }}
              aria-hidden="true"
            />
          ))}
          {draft ? (
            <span
              className="image-workbench__mosaic-region image-workbench__mosaic-region--draft"
              style={{
                left: `${draft.x * 100}%`,
                top: `${draft.y * 100}%`,
                width: `${draft.width * 100}%`,
                height: `${draft.height * 100}%`,
              }}
              aria-hidden="true"
            />
          ) : null}
        </div>
      ) : (
        <p className="image-workbench__parameter-description">上传图片后可在这里拖拽框选区域。</p>
      )}
      <div className="image-workbench__action-buttons">
        <button
          type="button"
          className="image-workbench__button image-workbench__button--secondary"
          disabled={params.regions.length === 0}
          onClick={() => setParams({ ...params, regions: [] })}
        >
          重置选区
        </button>
      </div>
    </section>
  );
}

const ImageMosaic: FC<{ onClose: () => void }> = () => (
  <BatchImageTool<MosaicParams>
    processor={mosaicImageProcessor}
    parameterTitle="马赛克区域处理"
    parameterDescription="在预览图上拖拽选择一个或多个区域，浏览器本地完成打码。"
    maxFileSizeBytes={50 * 1024 * 1024}
    zipFilename="mosaic-images.zip"
    notice={<span>选择区域会按比例应用到批量图片；勾选“整张图片”可直接处理全图。</span>}
    renderControls={({ selected, selectedParams, setSelectedParams }) => (
      <>
        <MosaicRegionEditor
          selected={selected}
          params={selectedParams}
          setParams={setSelectedParams}
        />
        <RangeControl
          label="马赛克块大小"
          value={selectedParams.blockSize}
          min={5}
          max={80}
          unit="px"
          onChange={(blockSize) => setSelectedParams({ ...selectedParams, blockSize })}
        />
        <ToggleControl
          label="整张图片"
          checked={selectedParams.wholeImage}
          helpText="忽略已框选区域，直接将整张图片打码。"
          onChange={(wholeImage) => setSelectedParams({ ...selectedParams, wholeImage })}
        />
        <SelectControl
          label="输出格式"
          value={selectedParams.outputFormat}
          options={[{ label: 'PNG', value: 'png' }, { label: 'JPEG', value: 'jpeg' }, { label: 'WebP', value: 'webp' }]}
          onChange={(outputFormat) => setSelectedParams({ ...selectedParams, outputFormat })}
        />
        <RangeControl
          label="输出质量"
          value={Math.round(selectedParams.quality * 100)}
          min={60}
          max={100}
          unit="%"
          onChange={(quality) => setSelectedParams({ ...selectedParams, quality: quality / 100 })}
        />
      </>
    )}
  />
);

export default ImageMosaic;
