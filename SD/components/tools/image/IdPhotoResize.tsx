import type { FC } from 'react';
import {
  BatchImageTool,
  NumberControl,
  PresetControl,
  RangeControl,
} from '../image-workbench';
import {
  idPhotoImageProcessor,
  millimetersToPixels,
  type IdPhotoParams,
} from './processors/conversion';

interface PhotoSize {
  name: string;
  label: string;
  widthMm: number;
  heightMm: number;
}

const PHOTO_SIZES: readonly PhotoSize[] = [
  { name: 'one-inch', label: '一寸 · 25 × 35 mm', widthMm: 25, heightMm: 35 },
  { name: 'two-inch', label: '二寸 · 35 × 49 mm', widthMm: 35, heightMm: 49 },
  { name: 'small-one', label: '小一寸 · 22 × 32 mm', widthMm: 22, heightMm: 32 },
  { name: 'small-two', label: '小二寸 · 33 × 45 mm', widthMm: 33, heightMm: 45 },
  { name: 'passport', label: '护照 · 33 × 48 mm', widthMm: 33, heightMm: 48 },
  { name: 'visa-us', label: '美国签证 · 51 × 51 mm', widthMm: 51, heightMm: 51 },
  { name: 'visa-japan', label: '日本签证 · 35 × 45 mm', widthMm: 35, heightMm: 45 },
  { name: 'id-card', label: '身份证 · 26 × 32 mm', widthMm: 26, heightMm: 32 },
];

const MAX_FILE_SIZE = 50 * 1024 * 1024;

function findPhotoPreset(params: IdPhotoParams): string {
  return PHOTO_SIZES.find(
    (size) => size.widthMm === params.widthMm && size.heightMm === params.heightMm,
  )?.name ?? 'custom';
}

const IdPhotoResize: FC<{ onClose: () => void }> = () => (
  <BatchImageTool<IdPhotoParams>
    processor={idPhotoImageProcessor}
    parameterTitle="证件照尺寸与导出"
    parameterDescription="按常用证件照规格裁剪，处理在当前浏览器本地完成，支持批量生成和 ZIP 下载。"
    maxFileSizeBytes={MAX_FILE_SIZE}
    zipFilename="id-photos.zip"
    notice={<span>默认按 300 DPI 输出白底 JPEG；像素尺寸会随毫米和 DPI 自动换算。</span>}
    renderControls={({ selectedParams, setSelectedParams }) => {
      const pixels = selectedParams.widthMm > 0 && selectedParams.heightMm > 0 && selectedParams.dpi > 0
        ? `${millimetersToPixels(selectedParams.widthMm, selectedParams.dpi)} × ${millimetersToPixels(selectedParams.heightMm, selectedParams.dpi)} px`
        : '等待有效尺寸';

      return (
        <>
          <PresetControl
            label="证件照规格"
            value={findPhotoPreset(selectedParams)}
            options={[
              ...PHOTO_SIZES.map((size) => ({ label: size.label, value: size.name })),
              { label: '自定义尺寸', value: 'custom' },
            ]}
            onChange={(name) => {
              const preset = PHOTO_SIZES.find((size) => size.name === name);
              if (preset) {
                setSelectedParams({
                  ...selectedParams,
                  widthMm: preset.widthMm,
                  heightMm: preset.heightMm,
                });
              }
            }}
          />
          <div className="image-workbench__control-grid">
            <NumberControl
              label="宽度"
              value={selectedParams.widthMm}
              min={1}
              max={200}
              step={0.1}
              unit="mm"
              onChange={(widthMm) => setSelectedParams({ ...selectedParams, widthMm })}
            />
            <NumberControl
              label="高度"
              value={selectedParams.heightMm}
              min={1}
              max={200}
              step={0.1}
              unit="mm"
              onChange={(heightMm) => setSelectedParams({ ...selectedParams, heightMm })}
            />
          </div>
          <NumberControl
            label="分辨率"
            value={selectedParams.dpi}
            min={72}
            max={1200}
            step={1}
            unit="DPI"
            helpText="打印用途通常使用 300 DPI；仅用于屏幕展示可降低分辨率。"
            onChange={(dpi) => setSelectedParams({ ...selectedParams, dpi })}
          />
          <RangeControl
            label="JPEG 质量"
            value={Math.round(selectedParams.quality * 100)}
            min={60}
            max={100}
            unit="%"
            onChange={(quality) => setSelectedParams({ ...selectedParams, quality: quality / 100 })}
          />
          <p className="image-workbench__parameter-description" aria-live="polite">
            打印尺寸：{selectedParams.widthMm} × {selectedParams.heightMm} mm · 预计像素：{pixels}
          </p>
        </>
      );
    }}
  />
);

export default IdPhotoResize;
