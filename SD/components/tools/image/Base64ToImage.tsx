import { useState } from 'react';
import type { FC } from 'react';
import { ImageWorkbench } from '../image-workbench';
import { dataUrlToBlob } from './processors/conversion';
import { downloadDataUrl } from '../shared';

function normalizeDataUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('data:')) return trimmed;
  const compact = trimmed.replace(/\s+/g, '');
  const mime = compact.startsWith('/9j/')
    ? 'image/jpeg'
    : compact.startsWith('iVBOR')
      ? 'image/png'
      : compact.startsWith('R0lGOD')
        ? 'image/gif'
        : compact.startsWith('UklGR')
          ? 'image/webp'
          : 'image/png';
  return `data:${mime};base64,${compact}`;
}

function extensionForMime(mime: string): string {
  if (mime.includes('jpeg')) return 'jpg';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('webp')) return 'webp';
  return 'png';
}

const Base64ToImage: FC<{ onClose: () => void }> = ({ onClose }) => {
  const [input, setInput] = useState('');
  const [preview, setPreview] = useState('');
  const [mime, setMime] = useState('image/png');
  const [error, setError] = useState('');

  const handleConvert = () => {
    setError('');
    if (!input.trim()) {
      setError('请输入 Base64 字符串');
      return;
    }

    try {
      const dataUrl = normalizeDataUrl(input);
      const blob = dataUrlToBlob(dataUrl);
      if (!blob.type.startsWith('image/')) throw new Error('不是图片类型');
      const image = new Image();
      image.onload = () => {
        setPreview(dataUrl);
        setMime(blob.type);
      };
      image.onerror = () => {
        setPreview('');
        setError('无效的 Base64 图片数据');
      };
      image.src = dataUrl;
    } catch {
      setPreview('');
      setError('无效的 Base64 图片数据');
    }
  };

  const reset = () => {
    setInput('');
    setPreview('');
    setMime('image/png');
    setError('');
  };

  return (
    <ImageWorkbench
      upload={(
        <div className="image-workbench__control">
          <label className="image-workbench__control-label" htmlFor="base64-input">输入 Base64 字符串</label>
          <textarea
            id="base64-input"
            value={input}
            onChange={(event) => { setInput(event.currentTarget.value); setError(''); }}
            placeholder="粘贴带 data: 前缀或纯 Base64 字符串"
            rows={10}
            spellCheck={false}
          />
          <p className="image-workbench__control-help">支持 JPEG、PNG、GIF、WebP；纯 Base64 会根据文件头自动识别。</p>
        </div>
      )}
      controls={(
        <div className="image-workbench__control">
          <h2 className="image-workbench__parameter-title">转换说明</h2>
          <p className="image-workbench__parameter-description">转换会先在本地校验 Data URL 和图片解码，再生成可预览的图片。</p>
          {error ? <p className="image-workbench__action-error" role="alert">{error}</p> : null}
          {preview ? <p className="image-workbench__parameter-description">当前格式：{mime}</p> : null}
        </div>
      )}
      preview={(
        <section className="image-workbench__special-preview" aria-label="图片预览">
          {preview ? <img src={preview} alt="Base64 转换结果" className="image-workbench__special-preview-image" /> : <p className="image-workbench__preview-empty">转换后图片会显示在这里</p>}
        </section>
      )}
      actions={(
        <section className="image-workbench__action-bar" aria-label="Base64 转图片操作">
          <div className="image-workbench__action-status" aria-live="polite">{preview ? '图片已生成' : '等待转换'}</div>
          <div className="image-workbench__action-buttons">
            <button type="button" className="image-workbench__button image-workbench__button--primary" onClick={handleConvert}>转换为图片</button>
            <button type="button" className="image-workbench__button image-workbench__button--secondary" disabled={!preview} onClick={() => downloadDataUrl(preview, `converted.${extensionForMime(mime)}`)}>下载图片</button>
            <button type="button" className="image-workbench__button image-workbench__button--secondary" disabled={!input && !preview} onClick={reset}>重置</button>
            <button type="button" className="image-workbench__button image-workbench__button--secondary" onClick={onClose}>关闭</button>
          </div>
        </section>
      )}
      notice={<span>所有解析和预览都在当前浏览器内完成。</span>}
    />
  );
};

export default Base64ToImage;
