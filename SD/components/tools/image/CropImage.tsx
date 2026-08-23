import type { FC } from 'react';
import {
  BatchImageTool,
  NumberControl,
  PresetControl,
  SelectControl,
} from '../image-workbench';
import {
  cropImageProcessor,
  type CropParams,
} from './processors/basic';

type CropRatio = 'free' | '1:1' | '4:3' | '16:9' | '3:4';

function ratioValue(ratio: CropRatio): number | null {
  if (ratio === 'free') return null;
  const [width, height] = ratio.split(':').map(Number);
  return width / height;
}

const CropImage: FC<{ onClose: () => void }> = () => (
  <BatchImageTool<CropParams>
    processor={cropImageProcessor}
    parameterTitle="裁剪区域"
    parameterDescription="使用比例预设快速居中取景，或精确输入裁剪坐标和尺寸。"
    maxFileSizeBytes={50 * 1024 * 1024}
    zipFilename="cropped-images.zip"
    notice={<span>裁剪坐标按每张图片独立保存；应用到全部前请确认图片尺寸接近。</span>}
    renderControls={({ selected, selectedParams, setSelectedParams }) => {
      const sourceWidth = selected?.metadata?.width ?? 0;
      const sourceHeight = selected?.metadata?.height ?? 0;
      const width = selectedParams.width > 0 ? selectedParams.width : sourceWidth;
      const height = selectedParams.height > 0 ? selectedParams.height : sourceHeight;
      const applyRatio = (ratio: CropRatio) => {
        const targetRatio = ratioValue(ratio);
        if (!targetRatio || !sourceWidth || !sourceHeight) return;
        let nextWidth = sourceWidth;
        let nextHeight = Math.round(nextWidth / targetRatio);
        if (nextHeight > sourceHeight) {
          nextHeight = sourceHeight;
          nextWidth = Math.round(nextHeight * targetRatio);
        }
        setSelectedParams({
          ...selectedParams,
          x: Math.round((sourceWidth - nextWidth) / 2),
          y: Math.round((sourceHeight - nextHeight) / 2),
          width: nextWidth,
          height: nextHeight,
        });
      };
      return (
        <>
          <PresetControl<CropRatio>
            label="裁剪比例"
            value="free"
            options={[
              { label: '自由', value: 'free' },
              { label: '1:1', value: '1:1', disabled: !selected?.metadata },
              { label: '4:3', value: '4:3', disabled: !selected?.metadata },
              { label: '16:9', value: '16:9', disabled: !selected?.metadata },
              { label: '3:4', value: '3:4', disabled: !selected?.metadata },
            ]}
            onChange={applyRatio}
          />
          <NumberControl label="X 坐标" value={selectedParams.x} min={0} max={Math.max(0, sourceWidth - 1)} unit="px" onChange={(x) => setSelectedParams({ ...selectedParams, x })} />
          <NumberControl label="Y 坐标" value={selectedParams.y} min={0} max={Math.max(0, sourceHeight - 1)} unit="px" onChange={(y) => setSelectedParams({ ...selectedParams, y })} />
          <NumberControl label="裁剪宽度" value={width} min={1} max={sourceWidth || undefined} unit="px" onChange={(nextWidth) => setSelectedParams({ ...selectedParams, width: nextWidth })} />
          <NumberControl label="裁剪高度" value={height} min={1} max={sourceHeight || undefined} unit="px" onChange={(nextHeight) => setSelectedParams({ ...selectedParams, height: nextHeight })} />
          <SelectControl
            label="输出格式"
            value={selectedParams.format}
            options={[
              { label: 'PNG', value: 'png' },
              { label: 'JPEG', value: 'jpeg' },
              { label: 'WebP', value: 'webp' },
            ]}
            onChange={(format) => setSelectedParams({ ...selectedParams, format })}
          />
        </>
      );
    }}
  />
);

export default CropImage;
