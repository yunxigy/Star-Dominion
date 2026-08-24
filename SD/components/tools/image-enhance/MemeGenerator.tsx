import type { FC } from 'react';
import {
  BatchImageTool,
  RangeControl,
} from '../image-workbench';
import {
  memeImageProcessor,
  type MemeParams,
} from './processors/creative';

const MemeGenerator: FC<{ onClose: () => void }> = () => (
  <BatchImageTool<MemeParams>
    processor={memeImageProcessor}
    parameterTitle="表情包文字"
    parameterDescription="为图片添加经典上下文字布局，支持批量生成并统一下载。"
    maxFileSizeBytes={50 * 1024 * 1024}
    zipFilename="meme-images.zip"
    notice={<span>文字会自动转为大写并使用描边，适合常见表情包版式。</span>}
    renderControls={({ selectedParams, setSelectedParams }) => (
      <>
        <div className="image-workbench__control">
          <label className="image-workbench__control-label" htmlFor="meme-top-text">顶部文字</label>
          <input
            id="meme-top-text"
            value={selectedParams.topText}
            placeholder="输入顶部文字"
            onChange={(event) => setSelectedParams({ ...selectedParams, topText: event.currentTarget.value })}
          />
        </div>
        <div className="image-workbench__control">
          <label className="image-workbench__control-label" htmlFor="meme-bottom-text">底部文字</label>
          <input
            id="meme-bottom-text"
            value={selectedParams.bottomText}
            placeholder="输入底部文字"
            onChange={(event) => setSelectedParams({ ...selectedParams, bottomText: event.currentTarget.value })}
          />
        </div>
        <RangeControl
          label="字号"
          value={selectedParams.fontSize}
          min={20}
          max={160}
          unit="px"
          onChange={(fontSize) => setSelectedParams({ ...selectedParams, fontSize })}
        />
      </>
    )}
  />
);

export default MemeGenerator;
