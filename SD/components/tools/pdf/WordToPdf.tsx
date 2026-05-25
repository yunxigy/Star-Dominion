import React, { useState, useRef } from 'react';
import { jsPDF } from 'jspdf';
import { useFileUpload, UploadZone, Btn } from '../shared';

const WordToPdf: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { files, triggerUpload, inputProps } = useFileUpload('.docx');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const hiddenRef = useRef<HTMLDivElement>(null);

  const file = files[0];

  const handleConvert = async () => {
    if (!file) { setStatus('请先上传Word文件'); return; }
    setLoading(true);
    setStatus('正在转换...');
    try {
      // Dynamically import mammoth and html2canvas
      let mammoth: any, html2canvas: any;
      try {
        mammoth = await import('mammoth');
      } catch {
        throw new Error('需要安装 mammoth 库: npm install mammoth');
      }
      try {
        html2canvas = (await import('html2canvas')).default;
      } catch {
        throw new Error('需要安装 html2canvas 库: npm install html2canvas');
      }

      setStatus('正在解析Word文档...');
      const arrayBuf = await file.arrayBuffer();
      const result = await mammoth.convertToHtml({ arrayBuffer: arrayBuf });
      const html = result.value;

      if (!html.trim()) {
        throw new Error('文档内容为空');
      }

      // Render HTML to hidden div
      setStatus('正在渲染页面...');
      const container = hiddenRef.current!;
      container.innerHTML = `
        <div style="padding: 40px; width: 794px; font-family: 'SimSun', 'Times New Roman', serif; font-size: 14px; line-height: 1.8; color: #000;">
          ${html}
        </div>
      `;

      // Wait for rendering
      await new Promise(resolve => setTimeout(resolve, 500));

      const canvas = await html2canvas(container.firstChild as HTMLElement, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
      });

      setStatus('正在生成PDF...');
      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      const imgWidth = 210; // A4 width in mm
      const pageHeight = 297; // A4 height in mm
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;

      const pdf = new jsPDF('p', 'mm', 'a4');
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      pdf.save(`${file.name.replace(/\.docx$/i, '')}.pdf`);
      container.innerHTML = '';
      setStatus('转换完成，已下载PDF');
    } catch (err: any) {
      setStatus(`转换失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-slate-400 text-sm">上传 .docx 文件，转换为PDF。需要安装 mammoth 和 html2canvas 依赖。</p>
      <input {...inputProps} />
      {!file ? (
        <UploadZone onUpload={triggerUpload} accept=".docx" label="点击上传Word文件" sublabel="支持 .docx 格式" />
      ) : (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2">
          <span className="text-sm text-slate-200">{file.name} ({(file.size / 1024).toFixed(1)} KB)</span>
        </div>
      )}
      <Btn onClick={handleConvert} disabled={!file || loading}>
        {loading ? '转换中...' : '转换为PDF'}
      </Btn>
      {status && <p className="text-sm text-slate-300">{status}</p>}
      {/* Hidden container for rendering HTML */}
      <div ref={hiddenRef} className="fixed top-[-9999px] left-[-9999px] opacity-0 pointer-events-none" />
    </div>
  );
};

export default WordToPdf;
