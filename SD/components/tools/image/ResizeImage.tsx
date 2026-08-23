import type { FC } from 'react';
import {
  BatchImageTool,
  NumberControl,
  PresetControl,
  RangeControl,
  SelectControl,
  ToggleControl,
} from '../image-workbench';
import {
  resizeImageProcessor,
  type ResizeParams,
} from './processors/basic';

const MAX_FILE_SIZE = 50 * 1024 * 1024;

const ResizeImage: FC<{ onClose: () => void }> = () => (
  <BatchImageTool<ResizeParams>
    processor={resizeImageProcessor}
    parameterTitle="尺寸与导出"
    parameterDescription="先选择队列中的图片，再设置目标尺寸；保持比例可避免画面变形。"
    maxFileSizeBytes={MAX_FILE_SIZE}
    zipFilename="resized-images.zip"
    notice={<span>单图参数会在约 200ms 后生成预览；多图队列需点击“处理全部”。</span>}
    renderControls={({ selected, selectedParams, setSelectedParams }) => {
      const sourceWidth = selected?.metadata?.width ?? 0;
      const sourceHeight = selected?.metadata?.height ?? 0;
      const shownWidth = selectedParams.width ?? sourceWidth;
      const shownHeight = selectedParams.height ?? sourceHeight;
      const updateWidth = (width: number) => {
        const height = selectedParams.keepAspectRatio && sourceWidth > 0
          ? Math.max(1, Math.round(width * sourceHeight / sourceWidth))
          : selectedParams.height;
        setSelectedParams({ ...selectedParams, width, height });
      };
      const updateHeight = (height: number) => {
        const width = selectedParams.keepAspectRatio && sourceHeight > 0
          ? Math.max(1, Math.round(height * sourceWidth / sourceHeight))
          : selectedParams.width;
        setSelectedParams({ ...selectedParams, width, height });
      };
      const applyScale = (percent: number) => {
        if (!sourceWidth || !sourceHeight) return;
        setSelectedParams({
          ...selectedParams,
          width: Math.max(1, Math.round(sourceWidth * percent / 100)),
          height: Math.max(1, Math.round(sourceHeight * percent / 100)),
        });
      };

      return (
        <>
          <PresetControl
            label="尺寸预设"
            value={100}
            options={[25, 50, 75, 100].map((value) => ({
              label: value === 100 ? '原尺寸' : `${value}%`,
              value,
              disabled: !selected?.metadata,
            }))}
            onChange={applyScale}
          />
          <NumberControl label="宽度" value={shownWidth} min={1} step={1} unit="px" onChange={updateWidth} />
          <NumberControl label="高度" value={shownHeight} min={1} step={1} unit="px" onChange={updateHeight} />
          <ToggleControl
            label="保持比例"
            checked={selectedParams.keepAspectRatio}
            onChange={(keepAspectRatio) => setSelectedParams({ ...selectedParams, keepAspectRatio })}
          />
          <button
            type="button"
            className="image-workbench__button image-workbench__button--secondary"
            disabled={!shownWidth || !shownHeight}
            onClick={() => setSelectedParams({ ...selectedParams, width: shownHeight, height: shownWidth })}
          >
            互换宽高
          </button>
          <SelectControl
            label="输出格式"
            value={selectedParams.format}
            options={[
              { label: '保持原格式', value: 'original' },
              { label: 'JPEG', value: 'jpeg' },
              { label: 'PNG', value: 'png' },
              { label: 'WebP', value: 'webp' },
            ]}
            onChange={(format) => setSelectedParams({ ...selectedParams, format })}
          />
          <RangeControl
            label="输出质量"
            value={Math.round(selectedParams.quality * 100)}
            min={10}
            max={100}
            unit="%"
            onChange={(quality) => setSelectedParams({ ...selectedParams, quality: quality / 100 })}
          />
        </>
      );
    }}
  />
);

export default ResizeImage;
