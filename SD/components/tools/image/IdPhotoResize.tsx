import React, { useState } from 'react';
import { useFileUpload, UploadZone, Btn, loadImage, canvasToBlob, downloadBlob } from '../shared';

interface PhotoSize {
  name: string;
  width: number;
  height: number;
  label: string;
}

const PHOTO_SIZES: PhotoSize[] = [
  { name: 'one-inch', width: 295, height: 413, label: '一寸 (25x35mm)' },
  { name: 'two-inch', width: 413, height: 579, label: '二寸 (35x49mm)' },
  { name: 'small-one', width: 260, height: 378, label: '小一寸 (22x32mm)' },
  { name: 'small-two', width: 378, height: 522, label: '小二寸 (33x45mm)' },
  { name: 'passport', width: 390, height: 567, label: '护照 (33x48mm)' },
  { name: 'visa-us', width: 600, height: 600, label: '美国签证 (51x51mm)' },
  { name: 'visa-japan', width: 413, height: 531, label: '日本签证 (35x45mm)' },
  { name: 'id-card', width: 358, height: 441, label: '身份证 (26x32mm)' },
];

const IdPhotoResize: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { files, inputProps, triggerUpload, clearFiles } = useFileUpload('image/*');
  const [selectedSize, setSelectedSize] = useState<PhotoSize>(PHOTO_SIZES[0]);
  const [preview, setPreview] = useState('');
  const [processing, setProcessing] = useState(false);

  const handleCrop = async () => {
    if (!files[0]) return;
    setProcessing(true);
    try {
      const img = await loadImage(URL.createObjectURL(files[0]));
      const canvas = document.createElement('canvas');
      canvas.width = selectedSize.width;
      canvas.height = selectedSize.height;
      const ctx = canvas.getContext('2d')!;

      // Fill with white background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Calculate crop to fill the target size while maintaining aspect ratio
      const targetRatio = selectedSize.width / selectedSize.height;
      const imgRatio = img.width / img.height;

      let sx = 0, sy = 0, sw = img.width, sh = img.height;
      if (imgRatio > targetRatio) {
        // Image is wider - crop sides
        sw = img.height * targetRatio;
        sx = (img.width - sw) / 2;
      } else {
        // Image is taller - crop top/bottom
        sh = img.width / targetRatio;
        sy = (img.height - sh) / 2;
      }

      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      const blob = await canvasToBlob(canvas, 'image/jpeg', 0.95);
      setPreview(URL.createObjectURL(blob));
    } catch (e: any) {
      alert('裁剪失败: ' + e.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = async () => {
    if (!files[0]) return;
    const img = await loadImage(URL.createObjectURL(files[0]));
    const canvas = document.createElement('canvas');
    canvas.width = selectedSize.width;
    canvas.height = selectedSize.height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const targetRatio = selectedSize.width / selectedSize.height;
    const imgRatio = img.width / img.height;
    let sx = 0, sy = 0, sw = img.width, sh = img.height;
    if (imgRatio > targetRatio) {
      sw = img.height * targetRatio;
      sx = (img.width - sw) / 2;
    } else {
      sh = img.width / targetRatio;
      sy = (img.height - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.95);
    const name = files[0].name.replace(/\.[^.]+$/, '') + `_${selectedSize.name}.jpg`;
    downloadBlob(blob, name);
  };

  return (
    <div className="space-y-3">
      <input {...inputProps} />
      {files.length === 0 ? (
        <UploadZone onUpload={triggerUpload} accept="image/*" label="上传照片" sublabel="上传证件照或正面免冠照片" />
      ) : (
        <>
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <span className="truncate">{files[0].name}</span>
            <button onClick={() => { clearFiles(); setPreview(''); }} className="text-red-400 hover:text-red-300 text-xs">移除</button>
          </div>

          <div>
            <label className="text-sm text-slate-400 mb-2 block">选择证件照尺寸</label>
            <div className="grid grid-cols-2 gap-2">
              {PHOTO_SIZES.map(size => (
                <button
                  key={size.name}
                  onClick={() => setSelectedSize(size)}
                  className={`px-3 py-2 text-xs rounded-lg text-left ${selectedSize.name === size.name ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                >
                  <div className="font-medium">{size.label}</div>
                  <div className="text-[10px] opacity-70">{size.width}x{size.height}px</div>
                </button>
              ))}
            </div>
          </div>

          <Btn onClick={handleCrop} disabled={processing}>{processing ? '处理中...' : '裁剪预览'}</Btn>

          {preview && (
            <div>
              <p className="text-xs text-slate-500 mb-1">{selectedSize.label} ({selectedSize.width}x{selectedSize.height})</p>
              <div className="flex justify-center">
                <img src={preview} className="rounded-lg border border-slate-700" style={{ maxHeight: 200 }} />
              </div>
              <Btn onClick={handleDownload}>下载证件照</Btn>
            </div>
          )}
        </>
      )}
      <Btn onClick={onClose} variant="ghost">关闭</Btn>
    </div>
  );
};

export default IdPhotoResize;
