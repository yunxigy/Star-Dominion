import type { FC } from 'react';
import {
  BatchImageTool,
  NumberControl,
  RangeControl,
  SelectControl,
} from '../image-workbench';
import {
  watermarkImageProcessor,
  type WatermarkParams,
} from './processors/basic';

const WatermarkImage: FC<{ onClose: () => void }> = () => (
  <BatchImageTool<WatermarkParams>
    processor={watermarkImageProcessor}
    parameterTitle="水印样式"
    parameterDescription="设置文字内容、九宫格位置、旋转和透明度，可批量应用到多张图片。"
    maxFileSizeBytes={50 * 1024 * 1024}
    zipFilename="watermarked-images.zip"
    notice={<span>水印绘制与图片导出均在浏览器本地完成。</span>}
    renderControls={({ selectedParams, setSelectedParams }) => (
      <>
        <div className="image-workbench__control">
          <label className="image-workbench__control-label" htmlFor="watermark-content">水印内容</label>
          <input id="watermark-content" type="text" value={selectedParams.text} onChange={(event) => setSelectedParams({ ...selectedParams, text: event.currentTarget.value })} />
        </div>
        <SelectControl
          label="位置"
          value={selectedParams.position}
          options={[
            { label: '左上', value: 'top-left' }, { label: '上中', value: 'top-center' },
            { label: '右上', value: 'top-right' }, { label: '左中', value: 'center-left' },
            { label: '居中', value: 'center' }, { label: '右中', value: 'center-right' },
            { label: '左下', value: 'bottom-left' }, { label: '下中', value: 'bottom-center' },
            { label: '右下', value: 'bottom-right' },
          ]}
          onChange={(position) => setSelectedParams({ ...selectedParams, position })}
        />
        <RangeControl label="透明度" value={Math.round(selectedParams.opacity * 100)} min={5} max={100} unit="%" onChange={(opacity) => setSelectedParams({ ...selectedParams, opacity: opacity / 100 })} />
        <NumberControl label="字号" value={selectedParams.fontSize} min={8} max={300} unit="px" onChange={(fontSize) => setSelectedParams({ ...selectedParams, fontSize })} />
        <RangeControl label="旋转角度" value={selectedParams.rotation} min={-180} max={180} unit="°" onChange={(rotation) => setSelectedParams({ ...selectedParams, rotation })} />
        <NumberControl label="边距" value={selectedParams.margin} min={0} max={500} unit="px" onChange={(margin) => setSelectedParams({ ...selectedParams, margin })} />
        <div className="image-workbench__control">
          <label className="image-workbench__control-label" htmlFor="watermark-color">文字颜色</label>
          <input id="watermark-color" type="color" value={selectedParams.color} onChange={(event) => setSelectedParams({ ...selectedParams, color: event.currentTarget.value })} />
        </div>
        <SelectControl
          label="输出格式"
          value={selectedParams.format}
          options={[{ label: 'PNG', value: 'png' }, { label: 'JPEG', value: 'jpeg' }, { label: 'WebP', value: 'webp' }]}
          onChange={(format) => setSelectedParams({ ...selectedParams, format })}
        />
      </>
    )}
  />
);

export default WatermarkImage;
