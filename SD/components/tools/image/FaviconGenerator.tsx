import type { FC } from 'react';
import { BatchImageTool } from '../image-workbench';
import {
  faviconImageProcessor,
  type FaviconParams,
} from './processors/conversion';

const FAVICON_SIZES = [16, 32, 48, 64, 128, 180, 192, 512] as const;

const FaviconGenerator: FC<{ onClose: () => void }> = () => (
  <BatchImageTool<FaviconParams>
    processor={faviconImageProcessor}
    parameterTitle="PNG 图标包"
    parameterDescription="选择需要的标准尺寸，每个尺寸输出一张透明 PNG。"
    maxFileSizeBytes={50 * 1024 * 1024}
    zipFilename="favicon-png-package.zip"
    notice={<span>当前输出为 PNG 图标包，不会伪装成多帧 ICO 文件。</span>}
    renderControls={({ selectedParams, setSelectedParams }) => (
      <fieldset className="image-workbench__control image-workbench__control--presets">
        <legend className="image-workbench__control-label">图标尺寸</legend>
        <div className="image-workbench__preset-options">
          {FAVICON_SIZES.map((size) => {
            const selected = selectedParams.sizes.includes(size);
            return (
              <button
                key={size}
                type="button"
                className="image-workbench__preset"
                aria-pressed={selected}
                onClick={() => {
                  const sizes = selected
                    ? selectedParams.sizes.filter((value) => value !== size)
                    : [...selectedParams.sizes, size].sort((left, right) => left - right);
                  if (sizes.length > 0) setSelectedParams({ sizes });
                }}
              >
                {size}×{size}
              </button>
            );
          })}
        </div>
        <span className="image-workbench__control-help">建议至少保留 16、32、180 和 192 像素。</span>
      </fieldset>
    )}
  />
);

export default FaviconGenerator;
