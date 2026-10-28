import type { FC } from 'react';
import {
  BatchImageTool,
  PresetControl,
  RangeControl,
  SelectControl,
} from '../image-workbench';
import {
  socialMediaCoverImageProcessor,
  type SocialMediaCoverParams,
} from './processors/creative';

interface CoverTemplate {
  label: string;
  width: number;
  height: number;
  name: string;
}

const TEMPLATES: readonly CoverTemplate[] = [
  { label: 'Twitter 封面', width: 1500, height: 500, name: 'twitter' },
  { label: '微信封面', width: 900, height: 500, name: 'wechat' },
  { label: 'Instagram', width: 1080, height: 1080, name: 'instagram' },
  { label: '小红书', width: 1080, height: 1440, name: 'xiaohongshu' },
  { label: 'B站封面', width: 1146, height: 717, name: 'bilibili' },
  { label: 'YouTube', width: 1280, height: 720, name: 'youtube' },
];

const SocialMediaCover: FC<{ onClose: () => void }> = () => (
  <BatchImageTool<SocialMediaCoverParams>
    processor={socialMediaCoverImageProcessor}
    parameterTitle="社交媒体封面"
    parameterDescription="选择平台尺寸，自动裁剪图片并叠加标题；可一次为多张图片生成统一封面。"
    maxFileSizeBytes={50 * 1024 * 1024}
    zipFilename="social-covers.zip"
    renderControls={({ selectedParams, setSelectedParams }) => (
      <>
        <PresetControl
          label="平台模板"
          value={selectedParams.templateName}
          options={TEMPLATES.map((template) => ({
            label: `${template.label} · ${template.width} × ${template.height}`,
            value: template.name,
          }))}
          onChange={(templateName) => {
            const template = TEMPLATES.find((item) => item.name === templateName);
            if (template) {
              setSelectedParams({
                ...selectedParams,
                templateName: template.name,
                targetWidth: template.width,
                targetHeight: template.height,
              });
            }
          }}
        />
        <SelectControl
          label="图片适配"
          value={selectedParams.fit}
          options={[{ label: '裁剪填满', value: 'cover' }, { label: '完整显示', value: 'contain' }]}
          onChange={(fit) => setSelectedParams({ ...selectedParams, fit })}
        />
        <div className="image-workbench__control">
          <label className="image-workbench__control-label" htmlFor="social-cover-title">标题文字</label>
          <input
            id="social-cover-title"
            value={selectedParams.title}
            placeholder="输入标题"
            onChange={(event) => setSelectedParams({ ...selectedParams, title: event.currentTarget.value })}
          />
        </div>
        <div className="image-workbench__control">
          <label className="image-workbench__control-label" htmlFor="social-cover-subtitle">副标题</label>
          <input
            id="social-cover-subtitle"
            value={selectedParams.subtitle}
            placeholder="输入副标题"
            onChange={(event) => setSelectedParams({ ...selectedParams, subtitle: event.currentTarget.value })}
          />
        </div>
        <RangeControl
          label="遮罩透明度"
          value={Math.round(selectedParams.overlayOpacity * 100)}
          min={0}
          max={80}
          unit="%"
          onChange={(overlayOpacity) => setSelectedParams({ ...selectedParams, overlayOpacity: overlayOpacity / 100 })}
        />
      </>
    )}
  />
);

export default SocialMediaCover;
