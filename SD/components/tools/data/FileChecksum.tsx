import React, { useState, useRef, useCallback } from 'react';
import { Btn, ResultBox, copyToClipboard, formatFileSize } from '../shared';
import { UploadZone } from '../shared';
import { Shield, CheckCircle, AlertTriangle, Trash2 } from 'lucide-react';

interface FileHash {
  name: string;
  size: number;
  md5: string;
  sha256: string;
  duplicate?: boolean;
}

const FileChecksum: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [files, setFiles] = useState<FileHash[]>([]);
  const [loading, setLoading] = useState(false);
  const [compareHash, setCompareHash] = useState('');
  const [result, setResult] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const computeHash = async (file: File, algorithm: string): Promise<string> => {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest(algorithm, buffer);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const handleFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList) return;
    setLoading(true);
    try {
      const newHashes: FileHash[] = [];
      for (const file of Array.from(fileList)) {
        // SHA-256 is natively supported
        const sha256 = await computeHash(file, 'SHA-256');
        // MD5 not supported by Web Crypto API, use SHA-1 as fallback
        const md5 = await computeHash(file, 'SHA-1');
        newHashes.push({ name: file.name, size: file.size, md5, sha256 });
      }
      setFiles(prev => {
        const all = [...prev, ...newHashes];
        // Check for duplicates
        const shaSet = new Set<string>();
        all.forEach(f => {
          if (shaSet.has(f.sha256)) f.duplicate = true;
          else shaSet.add(f.sha256);
        });
        return all;
      });
    } catch (e: any) {
      setResult('计算失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const checkCompare = () => {
    if (!compareHash || files.length === 0) return;
    const found = files.some(f => f.sha256.toLowerCase() === compareHash.toLowerCase() || f.md5.toLowerCase() === compareHash.toLowerCase());
    setResult(found ? '匹配: 输入的哈希值与某个文件匹配' : '不匹配: 输入的哈希值与所有文件都不匹配');
  };

  const modes: { key: string; label: string }[] = [
    { key: 'hash', label: '哈希计算' },
    { key: 'compare', label: '校验码比较' },
    { key: 'duplicate', label: '重复文件识别' },
  ];
  const [activeTab, setActiveTab] = useState('hash');

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b735c]">SHA256/SHA1 文件哈希、校验码比较、重复文件识别</p>
      <p className="text-xs text-yellow-600/80">注意: 浏览器不支持 MD5，使用 SHA-1 替代显示</p>

      <div className="flex gap-2">
        {modes.map(m => (
          <button key={m.key} onClick={() => setActiveTab(m.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${activeTab === m.key ? 'bg-[#7a421b] text-[#fff8ef]' : 'bg-[#f1dcc2] text-[#6f3714] hover:bg-[#ead0ad]'}`}>
            {m.label}
          </button>
        ))}
      </div>

      <UploadZone onUpload={() => inputRef.current?.click()} onDropFiles={handleFiles} accept="*/*" label="上传文件计算哈希" sublabel="支持多文件" />
      <input ref={inputRef} type="file" multiple className="hidden" onChange={e => handleFiles(e.target.files)} />

      {files.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-[#6d5a47]">已计算 {files.length} 个文件</span>
            <button onClick={() => setFiles([])} className="text-red-500 text-xs hover:underline">清空</button>
          </div>

          <div className="max-h-60 overflow-y-auto space-y-2">
            {files.map((f, i) => (
              <div key={i} className={`rounded-lg border p-3 ${f.duplicate ? 'border-amber-300 bg-amber-50' : 'border-[#c79f72]/30 bg-[#fff4e6]'}`}>
                <div className="flex items-center gap-2 mb-1">
                  {f.duplicate ? <AlertTriangle className="w-4 h-4 text-amber-500" /> : <CheckCircle className="w-4 h-4 text-green-500" />}
                  <span className="text-sm font-medium text-[#6d5a47]">{f.name}</span>
                  <span className="text-xs text-[#8b735c]">({formatFileSize(f.size)})</span>
                  {f.duplicate && <span className="text-xs text-amber-600">重复文件</span>}
                </div>
                <div className="space-y-1 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-[#8b735c] w-16">SHA-256:</span>
                    <code className="text-[#6d5a47] break-all flex-1">{f.sha256}</code>
                    <button onClick={() => copyToClipboard(f.sha256)} className="text-[#7a421b] hover:underline text-xs">复制</button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[#8b735c] w-16">SHA-1:</span>
                    <code className="text-[#6d5a47] break-all flex-1">{f.md5}</code>
                    <button onClick={() => copyToClipboard(f.md5)} className="text-[#7a421b] hover:underline text-xs">复制</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'compare' && (
        <div className="space-y-2">
          <input value={compareHash} onChange={e => setCompareHash(e.target.value)} placeholder="输入要比较的哈希值..." className="w-full px-3 py-2 rounded-lg border border-[#c79f72] bg-white text-sm font-mono" />
          <Btn onClick={checkCompare} disabled={!compareHash || files.length === 0}>比较校验码</Btn>
        </div>
      )}

      {activeTab === 'duplicate' && files.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-[#6d5a47]">
            {files.some(f => f.duplicate)
              ? `发现 ${files.filter(f => f.duplicate).length} 个重复文件`
              : '未发现重复文件'}
          </p>
        </div>
      )}

      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>

      {result && <ResultBox label="结果" value={result} onCopy={() => copyToClipboard(result)} />}
    </div>
  );
};

export default FileChecksum;