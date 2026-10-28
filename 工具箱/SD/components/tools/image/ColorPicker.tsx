import { useCallback, useEffect, useRef, useState } from 'react';
import type { FC, MouseEvent } from 'react';
import { ImageDropzone, ImageWorkbench } from '../image-workbench';
import { copyToClipboard, loadImageFromBlob } from '../shared';

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

function rgbToHex({ r, g, b }: RgbColor): string {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function rgbToHsl({ r, g, b }: RgbColor): { h: number; s: number; l: number } {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case red: h = ((green - blue) / d + (green < blue ? 6 : 0)) / 6; break;
      case green: h = ((blue - red) / d + 2) / 6; break;
      case blue: h = ((red - green) / d + 4) / 6; break;
      default: break;
    }
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

const ColorPicker: FC<{ onClose: () => void }> = ({ onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [color, setColor] = useState<RgbColor | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [error, setError] = useState('');

  const loadToCanvas = useCallback(async () => {
    if (!file || !canvasRef.current) return;
    try {
      const image = await loadImageFromBlob(file);
      const canvas = canvasRef.current;
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('当前浏览器不支持 Canvas 2D');
      context.drawImage(image, 0, 0);
      setImgLoaded(true);
      setError('');
    } catch (loadError) {
      setImgLoaded(false);
      setError(`加载图片失败：${loadError instanceof Error ? loadError.message : '未知错误'}`);
    }
  }, [file]);

  useEffect(() => {
    setColor(null);
    setImgLoaded(false);
    if (file) void loadToCanvas();
  }, [file, loadToCanvas]);

  const handleCanvasClick = (event: MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !canvas.width || !canvas.height) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = Math.min(canvas.width - 1, Math.max(0, Math.floor((event.clientX - rect.left) * canvas.width / rect.width)));
    const y = Math.min(canvas.height - 1, Math.max(0, Math.floor((event.clientY - rect.top) * canvas.height / rect.height)));
    const pixel = context.getImageData(x, y, 1, 1).data;
    setColor({ r: pixel[0], g: pixel[1], b: pixel[2] });
  };

  const reset = () => {
    setFile(null);
    setColor(null);
    setImgLoaded(false);
    setError('');
  };
  const hex = color ? rgbToHex(color) : '--';
  const hsl = color ? rgbToHsl(color) : null;
  const rgbText = color ? `rgb(${color.r}, ${color.g}, ${color.b})` : '--';
  const hslText = hsl ? `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)` : '--';

  return (
    <ImageWorkbench
      upload={(
        file ? (
          <div className="image-workbench__special-file">
            <span>{file.name}</span>
            <button type="button" className="image-workbench__button image-workbench__button--secondary" onClick={reset}>移除</button>
          </div>
        ) : (
          <ImageDropzone
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple={false}
            onFiles={(files) => setFile(files[0] ?? null)}
            title="上传图片"
            description="点击图片预览区域取色"
          />
        )
      )}
      controls={(
        <section className="image-workbench__color-result" aria-label="颜色信息">
          <h2 className="image-workbench__parameter-title">取色结果</h2>
          <p className="image-workbench__parameter-description">点击图片上的任意位置取色，结果会同步显示为常用格式。</p>
          {color ? <span className="image-workbench__color-preview" style={{ backgroundColor: hex }} aria-label={`当前颜色 ${hex}`} /> : null}
          <dl>
            <div><dt>HEX</dt><dd>{hex}</dd><button type="button" disabled={!color} onClick={() => copyToClipboard(hex)}>复制</button></div>
            <div><dt>RGB</dt><dd>{rgbText}</dd><button type="button" disabled={!color} onClick={() => copyToClipboard(rgbText)}>复制</button></div>
            <div><dt>HSL</dt><dd>{hslText}</dd><button type="button" disabled={!color} onClick={() => copyToClipboard(hslText)}>复制</button></div>
          </dl>
          {error ? <p className="image-workbench__action-error" role="alert">{error}</p> : null}
        </section>
      )}
      preview={(
        <section className="image-workbench__special-preview" aria-label="取色图片预览">
          {file ? (
            <canvas
              ref={canvasRef}
              onClick={handleCanvasClick}
              aria-label="点击图片取色"
              className={imgLoaded ? '' : 'image-workbench__canvas--loading'}
            />
          ) : (
            <p className="image-workbench__preview-empty">上传图片后，点击图像任意位置取色</p>
          )}
        </section>
      )}
      actions={(
        <section className="image-workbench__action-bar" aria-label="取色操作">
          <div className="image-workbench__action-status" aria-live="polite">{color ? `当前颜色 ${hex}` : '等待取色'}</div>
          <div className="image-workbench__action-buttons">
            <button type="button" className="image-workbench__button image-workbench__button--secondary" disabled={!file && !color} onClick={reset}>重置</button>
            <button type="button" className="image-workbench__button image-workbench__button--secondary" onClick={onClose}>关闭</button>
          </div>
        </section>
      )}
      notice={<span>图片只在当前浏览器内读取，取色不会上传源文件。</span>}
    />
  );
};

export default ColorPicker;
