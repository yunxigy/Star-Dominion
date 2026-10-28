import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Btn, copyToClipboard, UploadZone } from '../shared';
import { QrCode, Barcode, Download, Camera, Copy, CheckCircle } from 'lucide-react';

type QrMode = 'alphanumeric' | 'numeric' | 'byte' | 'kanji';
type EcLevel = 'L' | 'M' | 'Q' | 'H';

const generateQrCanvas = async (text: string, size: number, ecLevel: EcLevel): Promise<string> => {
  const QRCode = await import('qrcode');
  const canvas = document.createElement('canvas');
  await QRCode.toCanvas(canvas, text, {
    width: size,
    margin: 2,
    errorCorrectionLevel: ecLevel,
    color: { dark: '#000000', light: '#ffffff' },
  });
  return canvas.toDataURL('image/png');
};

// Generate Code128 barcode on canvas
const generateBarcodeCanvas = (text: string, width: number, height: number): string => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Simple Code128 encoding (subset B for ASCII)
  const CODE128_B_START = 104;
  const CODE128_B_STOP = 106;
  const PATTERNS = [
    '11011001100', '11001101100', '11001100110', '10010011000', '10010001100',
    '10001001100', '10011001000', '10011000100', '10001100100', '11001001000',
    '11001000100', '11000100100', '10110011100', '10011011100', '10011001110',
    '10111001100', '10011101100', '10011100110', '11001110010', '11001011100',
    '11001001110', '11011100100', '11001110100', '11101101110', '11101001100',
    '11100101100', '11100100110', '11101100100', '11100110100', '11100110010',
    '11011011000', '11011000110', '11000110110', '10100011000', '10001011000',
    '10001000110', '10110001000', '10001101000', '10001100010', '11010001000',
    '11000101000', '11000100010', '10110111000', '10110001110', '10001101110',
    '10111011000', '10111000110', '10001110110', '11101110110', '11010001110',
    '11000101110', '11011101000', '11011100010', '11011101110', '11101011000',
    '11101000110', '11100010110', '11101101000', '11101100010', '11100011010',
    '11101111010', '11001000010', '11110001010', '10100110000', '10100001100',
    '10010110000', '10010000110', '10000101100', '10000100110', '10110010000',
    '10110000100', '10011010000', '10011000010', '10000110100', '10000110010',
    '11000010010', '11001010000', '11110111010', '11000010100', '10001111010',
    '10100111100', '10010111100', '10010011110', '10111100100', '10011110100',
    '10011110010', '11110100100', '11110010100', '11110010010', '11011011110',
    '11011110110', '11110110110', '10010000010', '11110000010', '11110100010',
    '11010000010', '11010001000', '11000010100', '11000010010',
  ];

  // Encode
  const values: number[] = [CODE128_B_START];
  let checksum = CODE128_B_START;

  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i);
    if (charCode < 32 || charCode > 127) continue;
    const value = charCode - 32;
    values.push(value);
    checksum += value * (i + 1);
  }

  checksum = checksum % 103;
  values.push(checksum);
  values.push(CODE128_B_STOP);

  // Draw bars
  const totalModules = values.reduce((sum, v) => sum + PATTERNS[v].length, 0) + PATTERNS[CODE128_B_STOP].length;
  const moduleWidth = Math.max(1, (width - 40) / totalModules);
  const barHeight = height - 40;
  let x = 20;

  ctx.fillStyle = '#000000';
  for (const value of values) {
    const pattern = PATTERNS[value] || PATTERNS[0];
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i] === '1') {
        ctx.fillRect(x, 10, moduleWidth, barHeight);
      }
      x += moduleWidth;
    }
  }

  // Draw text
  ctx.fillStyle = '#000000';
  ctx.font = '12px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(text, width / 2, height - 8);

  return canvas.toDataURL('image/png');
};

const QR_PRESETS = [
  { label: '网址', prefix: 'https://', placeholder: 'https://example.com' },
  { label: '邮箱', prefix: 'mailto:', placeholder: 'user@example.com' },
  { label: '电话', prefix: 'tel:', placeholder: '+8613800138000' },
  { label: 'WiFi', prefix: 'WIFI:T:WPA;S:', placeholder: 'WIFI:T:WPA;S:网络名;P:密码;;' },
  { label: '文本', prefix: '', placeholder: '输入任意文本' },
];

const BarcodeQr: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [mode, setMode] = useState<'qr' | 'barcode'>('qr');
  const [text, setText] = useState('');
  const [qrSize, setQrSize] = useState(256);
  const [ecLevel, setEcLevel] = useState<EcLevel>('M');
  const [preset, setPreset] = useState(4);
  const [barcodeWidth, setBarcodeWidth] = useState(400);
  const [barcodeHeight, setBarcodeHeight] = useState(100);
  const [resultUrl, setResultUrl] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState('');
  const [copied, setCopied] = useState(false);
  const [scanResult, setScanResult] = useState('');
  const [scanImage, setScanImage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleGenerate = async () => {
    if (!text.trim()) return;
    setGenerating(true);
    setGenerationError('');
    try {
      if (mode === 'qr') {
        const url = await generateQrCanvas(text, qrSize, ecLevel);
        setResultUrl(url);
      } else {
        const url = generateBarcodeCanvas(text, barcodeWidth, barcodeHeight);
        setResultUrl(url);
      }
    } catch (e) {
      console.error(e);
      setResultUrl('');
      setGenerationError('二维码生成库加载失败，请刷新页面后重试。');
    }
    setGenerating(false);
  };

  const handleDownload = () => {
    if (!resultUrl) return;
    const a = document.createElement('a');
    a.href = resultUrl;
    a.download = mode === 'qr' ? 'qrcode.png' : 'barcode.png';
    a.click();
  };

  const handleScanFile = (file: File) => {
    const url = URL.createObjectURL(file);
    setScanImage(url);

    const img = document.createElement('img');
    img.onload = async () => {
      try {
        const jsQR = await import('jsqr');
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR.default(imageData.data, imageData.width, imageData.height);
          if (code) {
            setScanResult(code.data);
          } else {
            setScanResult('未检测到二维码');
          }
        }
      } catch {
        setScanResult('二维码扫描库未安装，请安装 jsqr 依赖');
      }
    };
    img.src = url;
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b735c]">条码/二维码生成与扫描</p>

      {/* Mode toggle */}
      <div className="flex gap-2">
        <button onClick={() => { setMode('qr'); setResultUrl(''); }}
          className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border transition-all
            ${mode === 'qr' ? 'bg-[#7a421b] text-white border-[#7a421b]' : 'bg-white text-[#6d5a47] border-[#ead0ad]'}`}>
          <QrCode className="w-3 h-3" />二维码
        </button>
        <button onClick={() => { setMode('barcode'); setResultUrl(''); }}
          className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border transition-all
            ${mode === 'barcode' ? 'bg-[#7a421b] text-white border-[#7a421b]' : 'bg-white text-[#6d5a47] border-[#ead0ad]'}`}>
          <Barcode className="w-3 h-3" />条形码
        </button>
      </div>

      {generationError && <p className="text-xs text-red-600">{generationError}</p>}

      {/* QR presets */}
      {mode === 'qr' && (
        <div className="flex flex-wrap gap-1">
          {QR_PRESETS.map((p, i) => (
            <button key={i} onClick={() => { setPreset(i); setText(p.prefix); }}
              className={`px-2 py-1 text-xs rounded border transition-all
                ${preset === i ? 'bg-[#f1dcc2] border-[#c79f72] text-[#6f3714]' : 'bg-white border-[#ead0ad] text-[#8b735c]'}`}>
              {p.label}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div>
        <label className="text-xs font-medium text-[#6d5a47] mb-1 block">
          {mode === 'qr' ? '二维码内容' : '条形码内容（ASCII字符）'}
        </label>
        <textarea value={text} onChange={e => setText(e.target.value)}
          className="w-full h-20 text-sm font-mono border border-[#ead0ad] rounded-lg px-3 py-2 bg-white resize-y focus:border-[#7a421b] focus:outline-none"
          placeholder={mode === 'qr' ? QR_PRESETS[preset].placeholder : '输入条形码文本（仅ASCII字符）'} />
      </div>

      {/* Options */}
      {mode === 'qr' ? (
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-xs text-[#8b735c]">尺寸:</label>
            <select value={qrSize} onChange={e => setQrSize(Number(e.target.value))}
              className="text-xs border border-[#ead0ad] rounded px-2 py-1 bg-white">
              {[128, 256, 512, 1024].map(s => <option key={s} value={s}>{s}px</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-[#8b735c]">容错:</label>
            <select value={ecLevel} onChange={e => setEcLevel(e.target.value as EcLevel)}
              className="text-xs border border-[#ead0ad] rounded px-2 py-1 bg-white">
              <option value="L">L (7%)</option>
              <option value="M">M (15%)</option>
              <option value="Q">Q (25%)</option>
              <option value="H">H (30%)</option>
            </select>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-xs text-[#8b735c]">宽度:</label>
            <input type="range" min={200} max={800} value={barcodeWidth} onChange={e => setBarcodeWidth(Number(e.target.value))}
              className="flex-1" />
            <span className="text-xs font-mono text-[#6d5a47]">{barcodeWidth}px</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-[#8b735c]">高度:</label>
            <input type="range" min={50} max={200} value={barcodeHeight} onChange={e => setBarcodeHeight(Number(e.target.value))}
              className="flex-1" />
            <span className="text-xs font-mono text-[#6d5a47]">{barcodeHeight}px</span>
          </div>
        </div>
      )}

      {/* Generate */}
      <div className="flex gap-2">
        <Btn onClick={handleGenerate} disabled={!text.trim() || generating}>
          {generating ? '生成中...' : '生成'}
        </Btn>
        {resultUrl && (
          <>
            <Btn onClick={handleDownload} variant="ghost">
              <Download className="w-3 h-3 mr-1" />下载
            </Btn>
            <button onClick={async () => { await copyToClipboard(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
              className="flex items-center gap-1 px-2 py-1 text-xs text-[#7a421b] hover:text-[#6f3714]">
              {copied ? <CheckCircle className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
              复制内容
            </button>
          </>
        )}
      </div>

      {/* Result preview */}
      {resultUrl && (
        <div className="border border-[#ead0ad] rounded-lg p-4 flex items-center justify-center bg-white">
          <img src={resultUrl} alt={mode === 'qr' ? 'QR Code' : 'Barcode'} className="max-w-full max-h-64" />
        </div>
      )}

      {/* QR Scanner */}
      <div className="bg-[#fff4e6] border border-[#ead0ad] rounded-lg p-3">
        <div className="flex items-center gap-2 mb-2">
          <Camera className="w-4 h-4 text-[#7a421b]" />
          <span className="text-xs font-medium text-[#6f3714]">二维码扫描</span>
        </div>
        <div className="flex gap-2">
          <UploadZone onUpload={() => fileInputRef.current?.click()} accept="image/*" />
        </div>
        {scanResult && (
          <div className="mt-2 bg-white border border-[#ead0ad] rounded p-2">
            <span className="text-[10px] text-[#8b735c]">扫描结果：</span>
            <div className="text-xs font-mono text-[#6d5a47] break-all">{scanResult}</div>
            {scanResult !== '未检测到二维码' && !scanResult.startsWith('二维码扫描库') && (
              <button onClick={async () => { await copyToClipboard(scanResult); }}
                className="text-[10px] text-[#7a421b] hover:text-[#6f3714] mt-1">复制结果</button>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    </div>
  );
};

export default BarcodeQr;
