import type { FC } from 'react';
import {
  BatchImageTool,
  NumberControl,
  RangeControl,
  SelectControl,
} from '../image-workbench';
import {
  mergeImageProcessor,
  type MergeParams,
} from './processors/composition';

const MergeImages: FC<{ onClose: () => void }> = () => (
  <BatchImageTool<MergeParams>
    processor={mergeImageProcessor}
    parameterTitle="合并布局"
    parameterDescription="队列顺序就是合并顺序，可用上移、下移调整。"
    maxFileSizeBytes={50 * 1024 * 1024}
    zipFilename="merged-images.zip"
    allowReorder
    notice={<span>横向、纵向或网格合并均在本地完成；超大画布会被安全拦截。</span>}
    renderControls={({ selectedParams, setSelectedParams }) => (
      <>
        <SelectControl
          label="合并布局"
          value={selectedParams.layout}
          options={[
            { label: '横向拼接', value: 'horizontal' },
            { label: '纵向拼接', value: 'vertical' },
            { label: '网格排列', value: 'grid' },
          ]}
          onChange={(layout) => setSelectedParams({ ...selectedParams, layout })}
        />
        <NumberControl
          label="列数"
          value={selectedParams.columns}
          min={1}
          max={10}
          step={1}
          disabled={selectedParams.layout !== 'grid'}
          onChange={(columns) => setSelectedParams({ ...selectedParams, columns })}
        />
        <RangeControl
          label="间距"
          value={selectedParams.gap}
          min={0}
          max={200}
          unit="px"
          onChange={(gap) => setSelectedParams({ ...selectedParams, gap })}
        />
        <SelectControl
          label="图片对齐"
          value={selectedParams.align}
          options={[
            { label: '起始对齐', value: 'start' },
            { label: '居中对齐', value: 'center' },
            { label: '末端对齐', value: 'end' },
          ]}
          onChange={(align) => setSelectedParams({ ...selectedParams, align })}
        />
        <div className="image-workbench__control">
          <label className="image-workbench__control-label" htmlFor="merge-background">背景色</label>
          <input id="merge-background" type="color" value={selectedParams.backgroundColor} onChange={(event) => setSelectedParams({ ...selectedParams, backgroundColor: event.currentTarget.value })} />
        </div>
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
        <RangeControl
          label="输出质量"
          value={Math.round(selectedParams.quality * 100)}
          min={10}
          max={100}
          unit="%"
          onChange={(quality) => setSelectedParams({ ...selectedParams, quality: quality / 100 })}
        />
      </>
    )}
  />
);

export default MergeImages;
