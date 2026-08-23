import type { FC } from 'react';
import {
  BatchImageTool,
  NumberControl,
  PresetControl,
  RangeControl,
  SelectControl,
} from '../image-workbench';
import {
  splitGridImageProcessor,
  type SplitGridParams,
} from './processors/conversion';

const SplitImageGrid: FC<{ onClose: () => void }> = () => (
  <BatchImageTool<SplitGridParams>
    processor={splitGridImageProcessor}
    parameterTitle="网格切图"
    parameterDescription="设置独立行列数，每个网格会生成一张图片并可打包下载。"
    maxFileSizeBytes={50 * 1024 * 1024}
    zipFilename="split-images.zip"
    notice={<span>边缘像素会完整保留；行列数不能超过原图像素尺寸。</span>}
    renderControls={({ selectedParams, setSelectedParams }) => (
      <>
        <PresetControl
          label="常用网格"
          value={`${selectedParams.rows}x${selectedParams.columns}`}
          options={[
            { label: '2×2', value: '2x2' },
            { label: '3×3', value: '3x3' },
            { label: '4×4', value: '4x4' },
          ]}
          onChange={(value) => {
            const [rows, columns] = value.split('x').map(Number);
            setSelectedParams({ ...selectedParams, rows, columns });
          }}
        />
        <NumberControl label="行数" value={selectedParams.rows} min={1} max={50} step={1} onChange={(rows) => setSelectedParams({ ...selectedParams, rows })} />
        <NumberControl label="列数" value={selectedParams.columns} min={1} max={50} step={1} onChange={(columns) => setSelectedParams({ ...selectedParams, columns })} />
        <p className="image-workbench__parameter-description">预计输出 {selectedParams.rows * selectedParams.columns} 张 / 每个输入文件</p>
        <SelectControl
          label="输出格式"
          value={selectedParams.format}
          options={[{ label: 'PNG', value: 'png' }, { label: 'JPEG', value: 'jpeg' }, { label: 'WebP', value: 'webp' }]}
          onChange={(format) => setSelectedParams({ ...selectedParams, format })}
        />
        <RangeControl label="输出质量" value={Math.round(selectedParams.quality * 100)} min={10} max={100} unit="%" onChange={(quality) => setSelectedParams({ ...selectedParams, quality: quality / 100 })} />
      </>
    )}
  />
);

export default SplitImageGrid;
