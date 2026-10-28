import type { FC } from 'react';
import {
  BatchImageTool,
  RangeControl,
  SelectControl,
} from '../image-workbench';
import {
  createExifReencodeProcessor,
  type ExifReencodeParams,
  type OutputImageMime,
} from './processors/filters';

type ExifFormat = 'original' | OutputImageMime;
const processor = createExifReencodeProcessor();

const ImageExifRemover: FC<{ onClose: () => void }> = () => (
  <BatchImageTool<ExifReencodeParams>
    processor={processor}
    parameterTitle="清理元数据"
    parameterDescription="重编码会移除拍摄时间、相机设备、GPS 定位等 EXIF 信息。"
    maxFileSizeBytes={50 * 1024 * 1024}
    zipFilename="clean-images.zip"
    notice={<span>处理可能改变文件体积；PNG、JPEG 和 WebP 均可清理，不会上传原图。</span>}
    renderControls={({ selectedParams, setSelectedParams }) => (
      <>
        <SelectControl<ExifFormat>
          label="输出格式"
          value={selectedParams.outputMime ?? 'original'}
          options={[
            { label: '保持原格式', value: 'original' },
            { label: 'PNG', value: 'image/png' },
            { label: 'JPEG', value: 'image/jpeg' },
            { label: 'WebP', value: 'image/webp' },
          ]}
          onChange={(format) => setSelectedParams({
            ...selectedParams,
            outputMime: format === 'original' ? undefined : format,
          })}
        />
        <RangeControl label="输出质量" value={Math.round(selectedParams.quality * 100)} min={50} max={100} unit="%" onChange={(quality) => setSelectedParams({ ...selectedParams, quality: quality / 100 })} />
        <p className="image-workbench__parameter-description">将清理：拍摄时间、设备型号、定位坐标、方向与其他内嵌描述。</p>
      </>
    )}
  />
);

export default ImageExifRemover;
