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

const processor = createFilterProcessor();

const ImageBrightness: FC<{ onClose: () => void }> = () => (
  <BatchImageTool<FilterParams>
    processor={processor}
    parameterTitle="色彩调整"
    parameterDescription="亮度、对比度和饱和度会共同应用，并保留原图供并排比较。"
    maxFileSizeBytes={50 * 1024 * 1024}
    zipFilename="adjusted-images.zip"
    notice={<span>单图参数变化后自动预览；大图按块处理，可响应取消操作。</span>}
    renderControls={({ selectedParams, setSelectedParams }) => (
      <>
        <PresetControl
          label="调整预设"
          value="custom"
          options={[
            { label: '原图', value: 'original' },
            { label: '明亮', value: 'bright' },
            { label: '柔和', value: 'soft' },
            { label: '鲜艳', value: 'vivid' },
          ]}
          onChange={(preset) => {
            const adjustments = preset === 'bright'
              ? { brightness: 15, contrast: 8, saturation: 5 }
              : preset === 'soft'
                ? { brightness: 5, contrast: -10, saturation: -8 }
                : preset === 'vivid'
                  ? { brightness: 3, contrast: 12, saturation: 24 }
                  : { brightness: 0, contrast: 0, saturation: 0 };
            setSelectedParams({ ...selectedParams, ...adjustments });
          }}
        />
        <RangeControl label="亮度" value={selectedParams.brightness} min={-100} max={100} unit="%" onChange={(brightness) => setSelectedParams({ ...selectedParams, brightness })} />
        <RangeControl label="对比度" value={selectedParams.contrast} min={-100} max={100} unit="%" onChange={(contrast) => setSelectedParams({ ...selectedParams, contrast })} />
        <RangeControl label="饱和度" value={selectedParams.saturation} min={-100} max={100} unit="%" onChange={(saturation) => setSelectedParams({ ...selectedParams, saturation })} />
        <SelectControl
          label="输出格式"
          value={selectedParams.outputMime}
          options={[
            { label: 'PNG', value: 'image/png' },
            { label: 'JPEG', value: 'image/jpeg' },
            { label: 'WebP', value: 'image/webp' },
          ]}
          onChange={(outputMime) => setSelectedParams({ ...selectedParams, outputMime })}
        />
        <RangeControl label="输出质量" value={Math.round(selectedParams.quality * 100)} min={10} max={100} unit="%" onChange={(quality) => setSelectedParams({ ...selectedParams, quality: quality / 100 })} />
      </>
    )}
  />
);

export default ImageBrightness;
