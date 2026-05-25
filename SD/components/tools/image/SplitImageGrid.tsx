import React, { useState } from 'react';
import { useFileUpload, UploadZone, Btn, loadImage, canvasToBlob, downloadBlob } from '../shared';

type GridSize = 2 | 3 | 4;

const SplitImageGrid: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { files, inputProps, triggerUpload, clearFiles } = useFileUpload('image/*');
  const [gridSize, setGridSize] = useState<GridSize>(3);
  const [pieces, setPieces] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);

  const handleSplit = async () => {
    if (!files[0]) return;
    setProcessing(true);
    try {
      const img = await loadImage(URL.createObjectURL(files[0]));
      const cellW = Math.floor(img.width / gridSize);
      const cellH = Math.floor(img.height / gridSize);
      const results: string[] = [];

      for (let row = 0; row < gridSize; row++) {
        for (let col = 0; col < gridSize; col++) {
          const canvas = document.createElement('canvas');
          canvas.width = cellW;
          canvas.height = cellH;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, col * cellW, row * cellH, cellW, cellH, 0, 0, cellW, cellH);
          const blob = await canvasToBlob(canvas, 'image/png');
          results.push(URL.createObjectURL(blob));
        }
      }

      setPieces(results);
    } catch (e: any) {
      alert('切割失败: ' + e.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleDownloadOne = async (index: number) => {
    if (!pieces[index]) return;
    const blob = await fetch(pieces[index]).then(r => r.blob());
    const row = Math.floor(index / gridSize) + 1;
    const col = (index % gridSize) + 1;
    downloadBlob(blob, `split_${row}_${col}.png`);
  };

  const handleDownloadAll = async () => {
    for (let i = 0; i < pieces.length; i++) {
      await handleDownloadOne(i);
    }
  };

  return (
    <div className="space-y-3">
      <input {...inputProps} />
      {files.length === 0 ? (
        <UploadZone onUpload={triggerUpload} accept="image/*" label="上传图片" sublabel="将图片切割为网格" />
      ) : (
        <>
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <span className="truncate">{files[0].name}</span>
            <button onClick={() => { clearFiles(); setPieces([]); }} className="text-red-400 hover:text-red-300 text-xs">移除</button>
          </div>

          <div>
            <label className="text-sm text-slate-400 mb-1 block">切割方式</label>
            <div className="grid grid-cols-3 gap-2">
              {([2, 3, 4] as GridSize[]).map(size => (
                <button
                  key={size}
                  onClick={() => setGridSize(size)}
                  className={`px-3 py-2 text-sm rounded-lg ${gridSize === size ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                >
                  {size}x{size}
                </button>
              ))}
            </div>
          </div>

          <Btn onClick={handleSplit} disabled={processing}>{processing ? '切割中...' : '切割预览'}</Btn>

          {pieces.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">共 {pieces.length} 块</p>
              <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${gridSize}, 1fr)` }}>
                {pieces.map((src, i) => (
                  <div key={i} className="relative group">
                    <img src={src} className="w-full rounded border border-slate-700" />
                    <button
                      onClick={() => handleDownloadOne(i)}
                      className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center text-xs text-white transition-opacity rounded"
                    >
                      下载
                    </button>
                  </div>
                ))}
              </div>
              <Btn onClick={handleDownloadAll}>下载全部</Btn>
            </div>
          )}
        </>
      )}
      <Btn onClick={onClose} variant="ghost">关闭</Btn>
    </div>
  );
};

export default SplitImageGrid;
