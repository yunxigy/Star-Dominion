import type { FC } from 'react';
import {
  BatchImageTool,
  RangeControl,
  SelectControl,
} from '../image-workbench';
import {
  addTextImageProcessor,
  type AddTextParams,
} from './processors/creative';

const ImageAddText: FC<{ onClose: () => void }> = () => (
  <BatchImageTool<AddTextParams>
    processor={addTextImageProcessor}
    parameterTitle="图片文字"
    parameterDescription="在图片上添加可定位的文字；坐标使用百分比，批量图片会按各自尺寸自动适配。"
    maxFileSizeBytes={50 * 1024 * 1024}
    zipFilename="text-images.zip"
    notice={<span>文字坐标以图片左上角为原点；不填文字时会保留原图并生成副本。</span>}
    renderControls={({ selectedParams, setSelectedParams }) => (
      <>
        <div className="image-workbench__control">
          <label className="image-workbench__control-label" htmlFor="image-add-text-content">文字内容</label>
          <input
            id="image-add-text-content"
            value={selectedParams.text}
            placeholder="输入文字"
            onChange={(event) => setSelectedParams({ ...selectedParams, text: event.currentTarget.value })}
          />
        </div>
        <div className="image-workbench__control-grid">
          <RangeControl
            label="X 坐标"
            value={selectedParams.xPercent}
            min={0}
            max={100}
            unit="%"
            onChange={(xPercent) => setSelectedParams({ ...selectedParams, xPercent })}
          />
          <RangeControl
            label="Y 坐标"
            value={selectedParams.yPercent}
            min={0}
            max={100}
            unit="%"
            onChange={(yPercent) => setSelectedParams({ ...selectedParams, yPercent })}
          />
        </div>
        <div className="image-workbench__control-grid">
          <div className="image-workbench__control">
            <label className="image-workbench__control-label" htmlFor="image-add-text-color">文字颜色</label>
            <input
              id="image-add-text-color"
              type="color"
              value={selectedParams.color}
              aria-label="文字颜色"
              onChange={(event) => setSelectedParams({ ...selectedParams, color: event.currentTarget.value })}
            />
          </div>
          <RangeControl
            label="字号"
            value={selectedParams.fontSize}
            min={12}
            max={160}
            unit="px"
            onChange={(fontSize) => setSelectedParams({ ...selectedParams, fontSize })}
          />
        </div>
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

export default ImageAddText;
