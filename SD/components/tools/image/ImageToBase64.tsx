import { useEffect, useState } from 'react';
import type { FC } from 'react';
import {
  BatchImageTool,
  type OutputAsset,
} from '../image-workbench';
import { blobToDataUrl, imageToBase64Processor, type ImageToBase64Params } from './processors/conversion';

function Base64Result({ output }: { output: OutputAsset | null }) {
  const [dataUrl, setDataUrl] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');

  useEffect(() => {
    let active = true;
    setDataUrl('');
    setCopyState('idle');
    if (output) {
      void blobToDataUrl(output.blob).then((value) => {
        if (active) setDataUrl(value);
      }).catch(() => {
        if (active) setCopyState('error');
      });
    }
    return () => {
      active = false;
    };
  }, [output]);

  const copy = () => {
    if (!dataUrl) return;
    void navigator.clipboard.writeText(dataUrl).then(
      () => setCopyState('copied'),
      () => setCopyState('error'),
    );
  };

  return (
    <section className="image-workbench__base64-result" aria-label="Base64 结果">
      <h3 className="image-workbench__control-label">Base64 字符串</h3>
      {dataUrl ? (
        <>
          <textarea readOnly value={dataUrl} rows={7} aria-label="Base64 字符串内容" />
          <p className="image-workbench__parameter-description">长度：{dataUrl.length} 字符</p>
          <button type="button" className="image-workbench__button image-workbench__button--secondary" onClick={copy}>
            {copyState === 'copied' ? '已复制' : copyState === 'error' ? '复制失败，重试' : '复制完整 Base64'}
          </button>
        </>
      ) : (
        <p className="image-workbench__parameter-description">处理图片后，完整字符串会显示在这里。</p>
      )}
    </section>
  );
}

const ImageToBase64: FC<{ onClose: () => void }> = () => (
  <BatchImageTool<ImageToBase64Params>
    processor={imageToBase64Processor}
    parameterTitle="图片转 Base64"
    parameterDescription="选择一张或多张图片，在浏览器本地转换为 Data URL；不会上传文件。"
    maxFileSizeBytes={50 * 1024 * 1024}
    zipFilename="base64-source-images.zip"
    notice={<span>Base64 字符串可能比原文件大约三分之一，复制或嵌入代码前请注意文本长度。</span>}
    renderControls={({ selected }) => (
      <Base64Result output={selected?.outputs[0] ?? null} />
    )}
  />
);

export default ImageToBase64;
