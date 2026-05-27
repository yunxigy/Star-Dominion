import React, { useEffect, useState, useRef } from 'react';
import { useFileUpload, UploadZone, Btn, loadImage, loadImageFromBlob, canvasToBlob, downloadBlob , revokeUrls } from '../shared';

interface Template {
  label: string;
  width: number;
  height: number;
  name: string;
}

const TEMPLATES: Template[] = [
  { label: 'Twitter 封面', width: 1500, height: 500, name: 'twitter' },
  { label: '微信封面', width: 900, height: 500, name: 'wechat' },
  { label: 'Instagram', width: 1080, height: 1080, name: 'instagram' },
  { label: '小红书', width: 1080, height: 1440, name: 'xiaohongshu' },
  { label: 'B站封面', width: 1146, height: 717, name: 'bilibili' },
  { label: 'YouTube', width: 1280, height: 720, name: 'youtube' },
];

const SocialMediaCover: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { files, inputProps, triggerUpload, clearFiles, handleFiles } = useFileUpload('image/*');
  const [templateIdx, setTemplateIdx] = useState(0);
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [overlayOpacity, setOverlayOpacity] = useState(0.5);
  const [preview, setPreview] = useState('');
  const [processing, setProcessing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const template = TEMPLATES[templateIdx];

  const handleApply = async () => {
    if (!files[0]) return;
    setProcessing(true);
    try {
      const img = await loadImageFromBlob(files[0]);
      const canvas = canvasRef.current!;
      canvas.width = template.width;
      canvas.height = template.height;
      const ctx = canvas.getContext('2d')!;

      // Draw background image (cover fit)
      const imgRatio = img.width / img.height;
      const tplRatio = template.width / template.height;
      let sx = 0, sy = 0, sw = img.width, sh = img.height;
      if (imgRatio > tplRatio) {
        sw = img.height * tplRatio;
        sx = (img.width - sw) / 2;
      } else {
        sh = img.width / tplRatio;
        sy = (img.height - sh) / 2;
      }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, template.width, template.height);

      // Draw semi-transparent overlay
      ctx.fillStyle = `rgba(0, 0, 0, ${overlayOpacity})`;
      ctx.fillRect(0, 0, template.width, template.height);

      // Draw title
      const titleSize = Math.floor(template.width / 15);
      if (title) {
        ctx.font = `bold ${titleSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 10;
        ctx.fillText(title, template.width / 2, template.height / 2 - (subtitle ? titleSize * 0.5 : 0));
      }

      // Draw subtitle
      const subSize = Math.floor(titleSize * 0.5);
      if (subtitle) {
        ctx.font = `${subSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 8;
        ctx.fillText(subtitle, template.width / 2, template.height / 2 + (title ? subSize * 1.5 : 0));
      }

      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;

      const blob = await canvasToBlob(canvas, 'image/png');
      setPreview(URL.createObjectURL(blob));
    } catch (e: any) {
      alert('处理失败: ' + e.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = async () => {
    if (!canvasRef.current) return;
    const blob = await canvasToBlob(canvasRef.current, 'image/png');
    const name = `cover_${template.name}.png`;
    downloadBlob(blob, name);
  };

  return (
    <div className="space-y-3">
      <input {...inputProps} />
      {files.length === 0 ? (
        <UploadZone onUpload={triggerUpload} onDropFiles={handleFiles} accept="image/*" label="上传背景图片" sublabel="支持 JPG/PNG/WebP" />
      ) : (
        <>
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <span className="truncate">{files[0].name}</span>
            <button onClick={() => { clearFiles(); setPreview(''); }} className="text-red-400 hover:text-red-300 text-xs">移除</button>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 space-y-3">
            <div>
              <label className="text-sm text-slate-400 mb-1 block">平台模板</label>
              <div className="grid grid-cols-3 gap-1">
                {TEMPLATES.map((t, i) => (
                  <button key={t.name} onClick={() => setTemplateIdx(i)}
                    className={`px-2 py-1 text-xs rounded transition-colors ${templateIdx === i ? 'bg-emerald-600 text-white' : 'bg-slate-700/50 text-slate-400 hover:bg-slate-600/50'}`}>
                    {t.label}
                    <span className="block text-[10px] opacity-60">{t.width}x{t.height}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm text-slate-400 mb-1 block">标题文字</label>
              <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="输入标题"
                className="w-full bg-slate-900/50 border border-slate-600 rounded-lg p-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500/50" />
            </div>

            <div>
              <label className="text-sm text-slate-400 mb-1 block">副标题</label>
              <input type="text" value={subtitle} onChange={e => setSubtitle(e.target.value)} placeholder="输入副标题"
                className="w-full bg-slate-900/50 border border-slate-600 rounded-lg p-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500/50" />
            </div>

            <div>
              <label className="text-sm text-slate-400 mb-1 block">遮罩透明度: <span className="text-emerald-400">{overlayOpacity.toFixed(2)}</span></label>
              <input type="range" min={0} max={0.8} step={0.05} value={overlayOpacity} onChange={e => setOverlayOpacity(parseFloat(e.target.value))} className="w-full accent-emerald-500" />
            </div>
          </div>

          <Btn onClick={handleApply} disabled={processing}>{processing ? '处理中...' : '生成封面'}</Btn>

          <canvas ref={canvasRef} className="hidden" />
          {preview && (
            <div>
              <p className="text-xs text-slate-500 mb-1">预览 ({template.label} {template.width}x{template.height})</p>
              <img src={preview} className="rounded-lg max-h-48 w-full object-contain bg-slate-800" />
              <Btn onClick={handleDownload}>下载封面</Btn>
            </div>
          )}
        </>
      )}
      <Btn onClick={onClose} variant="ghost">关闭</Btn>
    </div>
  );
};

export default SocialMediaCover;
