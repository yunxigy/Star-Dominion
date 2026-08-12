import React, { useState, useRef, useEffect } from 'react';
import { Btn, copyToClipboard } from '../shared';
import { User, Download, Copy, CheckCircle, QrCode } from 'lucide-react';

interface VcardData {
  firstName: string;
  lastName: string;
  organization: string;
  title: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  note: string;
}

const defaultVcard: VcardData = {
  firstName: '', lastName: '', organization: '', title: '',
  phone: '', email: '', website: '', address: '', city: '',
  state: '', zip: '', country: '', note: '',
};

const generateVcard = (data: VcardData): string => {
  const lines: string[] = ['BEGIN:VCARD', 'VERSION:3.0'];
  const name = [data.lastName, data.firstName].filter(Boolean).join(';');
  if (name) lines.push(`N:${name};;;`);
  const fn = [data.firstName, data.lastName].filter(Boolean).join(' ');
  if (fn) lines.push(`FN:${fn}`);
  if (data.organization) lines.push(`ORG:${data.organization}`);
  if (data.title) lines.push(`TITLE:${data.title}`);
  if (data.phone) lines.push(`TEL;TYPE=CELL:${data.phone}`);
  if (data.email) lines.push(`EMAIL;TYPE=WORK:${data.email}`);
  if (data.website) lines.push(`URL:${data.website}`);
  const addr = [data.address, data.city, data.state, data.zip, data.country].filter(Boolean).join(';');
  if (addr) lines.push(`ADR;TYPE=WORK:;;${addr}`);
  if (data.note) lines.push(`NOTE:${data.note}`);
  lines.push('END:VCARD');
  return lines.join('\n');
};

const VcardQr: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [data, setData] = useState<VcardData>(defaultVcard);
  const [vcard, setVcard] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const update = (field: keyof VcardData, value: string) => {
    setData(prev => ({ ...prev, [field]: value }));
  };

  const handleGenerate = async () => {
    const vcardText = generateVcard(data);
    setVcard(vcardText);
    setError('');
    setQrDataUrl('');

    try {
      const QRCode = await import('qrcode');
      const canvas = canvasRef.current;
      if (canvas) {
        await QRCode.toCanvas(canvas, vcardText, {
          width: 256,
          margin: 2,
          color: { dark: '#7a421b', light: '#fff4e6' },
        });
        setQrDataUrl(canvas.toDataURL('image/png'));
      }
    } catch (e) {
      setError(`QR码生成失败: ${e instanceof Error ? e.message : '未知错误'}。请确认 qrcode 库已安装。`);
    }
  };

  const handleCopyVcard = async () => {
    if (!vcard) return;
    await copyToClipboard(vcard);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!qrDataUrl) return;
    const a = document.createElement('a');
    a.href = qrDataUrl;
    a.download = `vcard_${data.firstName || 'contact'}_${data.lastName || ''}.png`.replace(/\s+/g, '_');
    a.click();
  };

  const handleDownloadVcf = () => {
    if (!vcard) return;
    const blob = new Blob([vcard], { type: 'text/vcard;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `contact_${data.firstName || ''}_${data.lastName || ''}.vcf`.replace(/\s+/g, '_');
    a.click();
    URL.revokeObjectURL(url);
  };

  const fields: { key: keyof VcardData; label: string; placeholder: string; type?: string }[][] = [
    [
      { key: 'lastName', label: '姓', placeholder: '张' },
      { key: 'firstName', label: '名', placeholder: '三' },
    ],
    [
      { key: 'organization', label: '公司/组织', placeholder: '示例科技有限公司' },
      { key: 'title', label: '职位', placeholder: '高级工程师' },
    ],
    [
      { key: 'phone', label: '手机号', placeholder: '13800138000', type: 'tel' },
      { key: 'email', label: '邮箱', placeholder: 'zhangsan@example.com', type: 'email' },
    ],
    [
      { key: 'website', label: '网站', placeholder: 'https://example.com', type: 'url' },
    ],
    [
      { key: 'address', label: '地址', placeholder: '科技路1号' },
    ],
    [
      { key: 'city', label: '城市', placeholder: '北京' },
      { key: 'state', label: '省份', placeholder: '北京市' },
    ],
    [
      { key: 'zip', label: '邮编', placeholder: '100000' },
      { key: 'country', label: '国家', placeholder: '中国' },
    ],
    [
      { key: 'note', label: '备注', placeholder: '其他信息...' },
    ],
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b735c]">二维码名片生成 — vCard 3.0 格式 + QR码编码</p>

      {/* Form */}
      <div className="bg-[#fff4e6] border border-[#ead0ad] rounded-lg p-3 space-y-2">
        <div className="flex items-center gap-2 mb-2">
          <User className="w-4 h-4 text-[#7a421b]" />
          <span className="text-xs font-medium text-[#6f3714]">联系信息</span>
        </div>
        {fields.map((row, ri) => (
          <div key={ri} className="grid grid-cols-2 gap-2">
            {row.map(f => (
              <div key={f.key}>
                <label className="text-[10px] text-[#8b735c]">{f.label}</label>
                <input value={data[f.key]} onChange={e => update(f.key, e.target.value)}
                  type={f.type || 'text'}
                  className="w-full text-xs border border-[#ead0ad] rounded px-2 py-1 bg-white focus:border-[#7a421b] focus:outline-none"
                  placeholder={f.placeholder} />
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Generate */}
      <Btn onClick={handleGenerate} className="w-full flex items-center justify-center gap-2">
        <QrCode className="w-4 h-4" /> 生成名片二维码
      </Btn>

      {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">{error}</div>}

      {/* Result */}
      {(qrDataUrl || vcard) && (
        <div className="grid grid-cols-2 gap-3">
          {/* QR Code */}
          <div className="border border-[#ead0ad] rounded-lg p-3 bg-white text-center">
            <div className="text-xs font-medium text-[#6f3714] mb-2">二维码</div>
            <canvas ref={canvasRef} className="mx-auto rounded" style={{ maxWidth: '200px' }} />
            {qrDataUrl && (
              <div className="flex justify-center gap-1 mt-2">
                <button onClick={handleDownload} className="flex items-center gap-1 text-[10px] text-[#7a421b] hover:text-[#6f3714]">
                  <Download className="w-3 h-3" /> PNG
                </button>
              </div>
            )}
          </div>

          {/* vCard text */}
          <div className="border border-[#ead0ad] rounded-lg p-3 bg-white">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-[#6f3714]">vCard 3.0</span>
              <div className="flex gap-1">
                <button onClick={handleCopyVcard} className="p-1 text-[#7a421b] hover:text-[#6f3714]">
                  {copied ? <CheckCircle className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                </button>
                <button onClick={handleDownloadVcf} className="p-1 text-[#7a421b] hover:text-[#6f3714]" title="下载 .vcf">
                  <Download className="w-3 h-3" />
                </button>
              </div>
            </div>
            <pre className="text-[10px] text-[#6d5a47] font-mono whitespace-pre-wrap break-all max-h-48 overflow-y-auto bg-[#fff4e6] rounded p-2">{vcard}</pre>
          </div>
        </div>
      )}

      {/* Preview card */}
      {vcard && (
        <div className="border border-[#ead0ad] rounded-lg p-3 bg-white">
          <div className="text-xs font-medium text-[#6f3714] mb-2">名片预览</div>
          <div className="bg-gradient-to-br from-[#7a421b] to-[#c79f72] rounded-lg p-4 text-white">
            <div className="text-lg font-bold">{[data.firstName, data.lastName].filter(Boolean).join(' ') || '姓名'}</div>
            {data.title && <div className="text-sm opacity-90">{data.title}</div>}
            {data.organization && <div className="text-sm opacity-80">{data.organization}</div>}
            <div className="mt-2 space-y-0.5 text-xs opacity-80">
              {data.phone && <div>📱 {data.phone}</div>}
              {data.email && <div>✉️ {data.email}</div>}
              {data.website && <div>🌐 {data.website}</div>}
              {[data.city, data.state, data.country].filter(Boolean).length > 0 && (
                <div>📍 {[data.city, data.state, data.country].filter(Boolean).join(', ')}</div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-[10px] text-amber-700">
        提示：生成的二维码可被手机通讯录扫描识别。vCard 3.0 格式兼容大多数设备。QR码生成依赖 qrcode 库。
      </div>

      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    </div>
  );
};

export default VcardQr;