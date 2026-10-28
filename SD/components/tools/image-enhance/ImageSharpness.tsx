import type { FC } from 'react';
import {
  BatchImageTool,
  RangeControl,
  SelectControl,
} from '../image-workbench';
import {
  createSharpnessAnalysisProcessor,
  type SharpnessAnalysisParams,
} from './processors/filters';

const processor = createSharpnessAnalysisProcessor();

const ImageSharpness: FC<{ onClose: () => void }> = () => (
  <BatchImageTool<SharpnessAnalysisParams>
    processor={processor}
    parameterTitle="清晰度评分"
    parameterDescription="通过拉普拉斯方差评估边缘细节，结果分为偏模糊、一般、清晰，仅作辅助参考。"
    maxFileSizeBytes={50 * 1024 * 1024}
    zipFilename="sharpness-analysis.zip"
    notice={<span>清晰度评分是辅助参考，会受图片内容、尺寸和噪点影响，不能替代人工判断。</span>}
    renderControls={({ selectedParams, setSelectedParams }) => (
      <>
        <SelectControl
          label="分析图格式"
          value={selectedParams.outputMime}
          options={[{ label: 'PNG', value: 'image/png' }, { label: 'JPEG', value: 'image/jpeg' }, { label: 'WebP', value: 'image/webp' }]}
          onChange={(outputMime) => setSelectedParams({ ...selectedParams, outputMime })}
        />
        <RangeControl label="输出质量" value={Math.round(selectedParams.quality * 100)} min={50} max={100} unit="%" onChange={(quality) => setSelectedParams({ ...selectedParams, quality: quality / 100 })} />
      </>
    )}
  />
);

export default ImageSharpness;
