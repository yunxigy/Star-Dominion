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
  textWatermarkImageProcessor,
  type TextWatermarkParams,
} from './processors/creative';
import type { NineGridPosition } from './processors/overlay';

const POSITIONS: readonly { value: NineGridPosition; label: string }[] = [
  { value: 'top-left', label: '左上' },
  { value: 'top-center', label: '上中' },
  { value: 'top-right', label: '右上' },
  { value: 'center-left', label: '左中' },
  { value: 'center', label: '居中' },
  { value: 'center-right', label: '右中' },
  { value: 'bottom-left', label: '左下' },
  { value: 'bottom-center', label: '下中' },
  { value: 'bottom-right', label: '右下' },
];

const ImageEnhanceWatermark: FC<{ onClose: () => void }> = () => (
  <BatchImageTool<TextWatermarkParams>
    processor={textWatermarkImageProcessor}
    parameterTitle="文字水印"
    parameterDescription="批量添加文字水印，支持九宫格定位、平铺、旋转和透明度调整。"
    maxFileSizeBytes={50 * 1024 * 1024}
    zipFilename="watermarked-images.zip"
    renderControls={({ selectedParams, setSelectedParams }) => (
      <>
        <div className="image-workbench__control">
          <label className="image-workbench__control-label" htmlFor="image-watermark-text">水印文字</label>
          <input
            id="image-watermark-text"
            value={selectedParams.text}
            placeholder="输入水印文字"
            onChange={(event) => setSelectedParams({ ...selectedParams, text: event.currentTarget.value })}
          />
        </div>
        <PresetControl
          label="位置"
          value={selectedParams.position}
          options={POSITIONS}
          onChange={(position) => setSelectedParams({ ...selectedParams, position })}
        />
        <div className="image-workbench__control-grid">
          <RangeControl
            label="透明度"
            value={Math.round(selectedParams.opacity * 100)}
            min={10}
            max={100}
            unit="%"
            onChange={(opacity) => setSelectedParams({ ...selectedParams, opacity: opacity / 100 })}
          />
          <RangeControl
            label="字号"
            value={selectedParams.fontSize}
            min={12}
            max={160}
            unit="px"
            onChange={(fontSize) => setSelectedParams({ ...selectedParams, fontSize })}
          />
        </div>
        <div className="image-workbench__control-grid">
          <NumberControl
            label="旋转"
            value={selectedParams.rotation}
            min={-180}
            max={180}
            step={1}
            unit="°"
            onChange={(rotation) => setSelectedParams({ ...selectedParams, rotation })}
          />
          <div className="image-workbench__control">
            <label className="image-workbench__control-label" htmlFor="image-watermark-color">颜色</label>
            <input
              id="image-watermark-color"
              type="color"
              value={selectedParams.color}
              aria-label="水印颜色"
              onChange={(event) => setSelectedParams({ ...selectedParams, color: event.currentTarget.value })}
            />
          </div>
        </div>
        <ToggleControl
          label="平铺水印"
          checked={selectedParams.tiled}
          helpText="在整张图片上重复铺满水印。"
          onChange={(tiled) => setSelectedParams({ ...selectedParams, tiled })}
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

export default ImageEnhanceWatermark;
