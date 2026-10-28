import type { FC } from 'react';
import {
  BatchImageTool,
  PresetControl,
  RangeControl,
  SelectControl,
} from '../image-workbench';
import {
  createFilterProcessor,
  type FilterParams,
} from './processors/filters';

const processor = createFilterProcessor({
  brightness: 0,
  contrast: 0,
  saturation: 0,
  sharpen: 0.6,
  outputMime: 'image/png',
  quality: 0.92,
});

const ImageSharpen: FC<{ onClose: () => void }> = () => (
  <BatchImageTool<FilterParams>
    processor={processor}
    parameterTitle="锐化设置"
    parameterDescription="增强边缘对比，适合轻微模糊的照片；过高强度可能出现光晕。"
    maxFileSizeBytes={50 * 1024 * 1024}
    zipFilename="sharpened-images.zip"
    notice={<span>建议先用低强度预览，再逐步增加；边缘像素会安全保留。</span>}
    renderControls={({ selectedParams, setSelectedParams }) => (
      <>
        <PresetControl
          label="锐化预设"
          value={selectedParams.sharpen}
          options={[
            { label: '轻微', value: 0.25 },
            { label: '标准', value: 0.6 },
            { label: '强烈', value: 1.1 },
          ]}
          onChange={(sharpen) => setSelectedParams({ ...selectedParams, sharpen })}
        />
        <RangeControl label="锐化强度" value={selectedParams.sharpen} min={0} max={2} step={0.05} onChange={(sharpen) => setSelectedParams({ ...selectedParams, sharpen })} />
        <SelectControl
          label="输出格式"
          value={selectedParams.outputMime}
          options={[{ label: 'PNG', value: 'image/png' }, { label: 'JPEG', value: 'image/jpeg' }, { label: 'WebP', value: 'image/webp' }]}
          onChange={(outputMime) => setSelectedParams({ ...selectedParams, outputMime })}
        />
        <RangeControl label="输出质量" value={Math.round(selectedParams.quality * 100)} min={10} max={100} unit="%" onChange={(quality) => setSelectedParams({ ...selectedParams, quality: quality / 100 })} />
      </>
    )}
  />
);

export default ImageSharpen;
