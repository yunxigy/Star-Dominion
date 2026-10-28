import type { FC } from 'react';
import {
  BatchImageTool,
  PresetControl,
  RangeControl,
  SelectControl,
  ToggleControl,
} from '../image-workbench';
import {
  compressImageProcessor,
  type CompressParams,
} from './processors/basic';

const MAX_FILE_SIZE = 50 * 1024 * 1024;

const CompressImage: FC<{ onClose: () => void }> = () => (
  <BatchImageTool<CompressParams>
    processor={compressImageProcessor}
    parameterTitle="压缩参数"
    parameterDescription="每张图片可使用独立参数，也可一键应用到全部队列。"
    maxFileSizeBytes={MAX_FILE_SIZE}
    zipFilename="compressed-images.zip"
    notice={<span>图片在浏览器本地重编码，不会上传；批量处理默认同时运行 2 项。</span>}
    renderControls={({ selectedParams, setSelectedParams }) => (
      <>
        <PresetControl
          label="压缩预设"
          value={Math.round(selectedParams.quality * 100)}
          options={[
            { label: '轻度 90%', value: 90 },
            { label: '均衡 80%', value: 80 },
            { label: '极致 60%', value: 60 },
          ]}
          onChange={(quality) => setSelectedParams({
            ...selectedParams,
            quality: quality / 100,
          })}
        />
        <RangeControl
          label="压缩质量"
          value={Math.round(selectedParams.quality * 100)}
          min={10}
          max={100}
          step={1}
          unit="%"
          helpText="数值越高细节越完整，文件通常也越大。"
          onChange={(quality) => setSelectedParams({
            ...selectedParams,
            quality: quality / 100,
          })}
        />
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
        <ToggleControl
          label="清理图片元数据"
          checked={true}
          disabled
          helpText="浏览器重编码会自动移除 EXIF、定位和设备信息。"
          onChange={() => undefined}
        />
      </>
    )}
  />
);

export default CompressImage;
