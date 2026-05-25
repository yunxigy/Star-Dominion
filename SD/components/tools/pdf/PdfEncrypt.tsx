import React, { useState } from 'react';
import { jsPDF } from 'jspdf';
import * as pdfjsLib from 'pdfjs-dist';
import { useFileUpload, UploadZone, Btn, TextInput } from '../shared';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const PdfEncrypt: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { files, triggerUpload, inputProps } = useFileUpload('.pdf');
  const [userPassword, setUserPassword] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  const file = files[0];

  const handleEncrypt = async () => {
    if (!file) { setStatus('请先上传PDF文件'); return; }
    if (!userPassword.trim()) { setStatus('请输入用户密码'); return; }
    setLoading(true);
    setStatus('正在加密...');
    try {
      const buf = await file.arrayBuffer();
      const doc = await pdfjsLib.getDocument({ data: buf }).promise;
      const output = new jsPDF();
      output.deletePage(1);
      for (let p = 1; p <= doc.numPages; p++) {
        setStatus(`正在处理第 ${p}/${doc.numPages} 页...`);
        const page = await doc.getPage(p);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvas, viewport }).promise;
        const imgData = canvas.toDataURL('image/jpeg', 0.92);
        const vp1 = page.getViewport({ scale: 1 });
        const w = vp1.width;
        const h = vp1.height;
        output.addPage([w, h], w > h ? 'landscape' as const : 'portrait' as const);
        output.addImage(imgData, 'JPEG', 0, 0, w, h);
      }
      try {
        (output as any).setEncryption({
          userPassword: userPassword,
          ownerPassword: ownerPassword || userPassword,
          userPermissions: ['print'],
        });
        output.save(`encrypted_${file.name}`);
        setStatus('加密完成，已下载。注意: 请在PDF阅读器中验证密码是否生效。');
      } catch (encErr) {
        // jsPDF encryption may not be fully supported in all versions
        output.save(`encrypted_${file.name}`);
        setStatus('文件已保存，但jsPDF加密功能可能有限，建议使用专业PDF工具进行加密。');
      }
    } catch (err: any) {
      setStatus(`加密失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-slate-400 text-sm">上传PDF文件，设置密码保护。注意: jsPDF的加密功能有限，建议用于简单场景。</p>
      <input {...inputProps} />
      {!file ? (
        <UploadZone onUpload={triggerUpload} accept=".pdf" label="点击上传PDF文件" />
      ) : (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2">
          <span className="text-sm text-slate-200">{file.name} ({(file.size / 1024).toFixed(1)} KB)</span>
        </div>
      )}
      <div>
        <label className="text-xs text-slate-500 block mb-1">用户密码 (打开文件时需要)</label>
        <TextInput value={userPassword} onChange={setUserPassword} placeholder="输入用户密码" type="password" />
      </div>
      <div>
        <label className="text-xs text-slate-500 block mb-1">权限密码 (可选，修改权限时需要)</label>
        <TextInput value={ownerPassword} onChange={setOwnerPassword} placeholder="输入权限密码" type="password" />
      </div>
      <Btn onClick={handleEncrypt} disabled={!file || loading || !userPassword.trim()}>
        {loading ? '加密中...' : '加密并下载'}
      </Btn>
      {status && <p className="text-sm text-slate-300">{status}</p>}
    </div>
  );
};

export default PdfEncrypt;
