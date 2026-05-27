import React, { useState, useRef } from 'react';
import { useFileUpload, UploadZone, Btn, ResultBox, copyToClipboard } from '../shared';

const ImageToBase64: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { files, inputProps, triggerUpload, clearFiles, handleFiles } = useFileUpload('image/*');
  const [base64, setBase64] = useState('');
  const [preview, setPreview] = useState('');
  const [processing, setProcessing] = useState(false);

  const handleConvert = () => {
    if (!files[0]) return;
    setProcessing(true);
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setBase64(result);
      setPreview(result);
      setProcessing(false);
    };
    reader.onerror = () => {
      alert('读取文件失败');
      setProcessing(false);
    };
    reader.readAsDataURL(files[0]);
  };

  const handleCopy = () => {
    copyToClipboard(base64);
  };

  return (
    <div className="space-y-3">
      <input {...inputProps} />
      {files.length === 0 ? (
        <UploadZone onUpload={triggerUpload} onDropFiles={handleFiles} accept="image/*" label="上传图片" sublabel="支持 JPG/PNG/WebP/GIF" />
      ) : (
        <>
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <span className="truncate">{files[0].name}</span>
            <button onClick={() => { clearFiles(); setBase64(''); setPreview(''); }} className="text-red-400 hover:text-red-300 text-xs">移除</button>
          </div>
          <Btn onClick={handleConvert} disabled={processing}>{processing ? '转换中...' : '转换为 Base64'}</Btn>
          {preview && (
            <div>
              <p className="text-xs text-slate-500 mb-1">预览</p>
              <img src={preview} className="rounded-lg max-h-48 w-full object-contain bg-slate-800" />
            </div>
          )}
          {base64 && (
            <div className="space-y-2">
              <ResultBox label="Base64 字符串" value={base64.substring(0, 200) + (base64.length > 200 ? '...' : '')} onCopy={handleCopy} />
              <p className="text-xs text-slate-500">长度: {base64.length} 字符</p>
              <Btn onClick={handleCopy}>复制完整 Base64</Btn>
            </div>
          )}
        </>
      )}
      <Btn onClick={onClose} variant="ghost">关闭</Btn>
    </div>
  );
};

export default ImageToBase64;
