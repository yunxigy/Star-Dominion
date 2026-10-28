import type { FC } from 'react';
import {
  BatchImageTool,
  PresetControl,
  RangeControl,
  ToggleControl,
} from '../image-workbench';
import {
  screenshotBeautifyImageProcessor,
  type ScreenshotParams,
} from './processors/creative';

const GRADIENT_PRESETS = [
  { label: '纯黑', value: 'solid:#111111' },
  { label: '深灰', value: 'solid:#1e293b' },
  { label: '紫蓝渐变', value: 'linear:#667eea,#764ba2' },
  { label: '粉橙渐变', value: 'linear:#f093fb,#f5576c' },
  { label: '青蓝渐变', value: 'linear:#4facfe,#00f2fe' },
  { label: '绿青渐变', value: 'linear:#43e97b,#38f9d7' },
  { label: '橙红渐变', value: 'linear:#fa709a,#fee140' },
] as const;

const ScreenshotBeautify: FC<{ onClose: () => void }> = () => (
  <BatchImageTool<ScreenshotParams>
    processor={screenshotBeautifyImageProcessor}
    parameterTitle="截图美化"
    parameterDescription="为截图添加浅色背景、圆角和阴影，支持批量处理并统一导出 PNG。"
    maxFileSizeBytes={50 * 1024 * 1024}
    zipFilename="beautified-screenshots.zip"
    renderControls={({ selectedParams, setSelectedParams }) => (
      <>
        <PresetControl
          label="背景样式"
          value={selectedParams.background}
          options={GRADIENT_PRESETS}
          onChange={(background) => setSelectedParams({ ...selectedParams, background })}
        />
        <div className="image-workbench__control-grid">
          <RangeControl
            label="内边距"
            value={selectedParams.padding}
            min={20}
            max={150}
            unit="px"
            onChange={(padding) => setSelectedParams({ ...selectedParams, padding })}
          />
          <RangeControl
            label="圆角"
            value={selectedParams.borderRadius}
            min={0}
            max={80}
            unit="px"
            onChange={(borderRadius) => setSelectedParams({ ...selectedParams, borderRadius })}
          />
        </div>
        <ToggleControl
          label="添加阴影"
          checked={selectedParams.shadow}
          onChange={(shadow) => setSelectedParams({ ...selectedParams, shadow })}
        />
      </>
    )}
  />
);

export default ScreenshotBeautify;
