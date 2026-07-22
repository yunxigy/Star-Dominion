import React, { useState, useCallback } from 'react';
import { Upload, FileText, Loader2, AlertCircle, CheckCircle2, ArrowRight } from 'lucide-react';

interface PlagiarismResult {
  similarity: number;
  matches: Array<{
    text1: string;
    text2: string;
    similarity: number;
  }>;
  stats: {
    totalSentences1: number;
    totalSentences2: number;
    matchedSentences: number;
  };
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;

function acceptedFile(file: File): string | null {
  const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (!['.txt', '.docx', '.pdf'].includes(extension)) return '仅支持 txt、docx、pdf 文件';
  if (file.size > MAX_FILE_BYTES) return '单个文件不能超过 10 MB';
  return null;
}

export default function PlagiarismCheck({ onClose }: { onClose: () => void }) {
  const [file1, setFile1] = useState<File | null>(null);
  const [file2, setFile2] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PlagiarismResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile1Change = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reason = acceptedFile(file);
    if (reason) {
      setError(reason);
      e.target.value = '';
      return;
    }
    setError(null);
    setFile1(file);
  }, []);

  const handleFile2Change = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reason = acceptedFile(file);
    if (reason) {
      setError(reason);
      e.target.value = '';
      return;
    }
    setError(null);
    setFile2(file);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!file1 || !file2) {
      setError('请选择两个文件');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file1', file1);
      formData.append('file2', file2);

      const response = await fetch('/plagiarism/api/plagiarism/compare', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null) as { detail?: unknown } | null;
        throw new Error(typeof body?.detail === 'string' ? body.detail : '查重失败，请重试');
      }

      const data = await response.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '查重失败');
    } finally {
      setLoading(false);
    }
  }, [file1, file2]);

  const getSimilarityColor = (similarity: number) => {
    if (similarity >= 80) return 'text-red-400';
    if (similarity >= 50) return 'text-yellow-400';
    return 'text-green-400';
  };

  return (
    <div className="space-y-6">
      {/* Upload Area */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* File 1 */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-300">论文 1</label>
          <div className="relative">
            <input
              type="file"
              accept=".txt,.docx,.pdf"
              onChange={handleFile1Change}
              className="hidden"
              id="file1"
            />
            <label
              htmlFor="file1"
              className="flex items-center justify-center gap-2 p-4 border-2 border-dashed border-white/20 rounded-xl cursor-pointer hover:border-white/40 transition-colors"
            >
              {file1 ? (
                <>
                  <FileText className="w-5 h-5 text-blue-400" />
                  <span className="text-sm text-slate-300 truncate">{file1.name}</span>
                </>
              ) : (
                <>
                  <Upload className="w-5 h-5 text-slate-400" />
                  <span className="text-sm text-slate-400">选择文件 (txt/docx/pdf)</span>
                </>
              )}
            </label>
          </div>
        </div>

        {/* File 2 */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-300">论文 2</label>
          <div className="relative">
            <input
              type="file"
              accept=".txt,.docx,.pdf"
              onChange={handleFile2Change}
              className="hidden"
              id="file2"
            />
            <label
              htmlFor="file2"
              className="flex items-center justify-center gap-2 p-4 border-2 border-dashed border-white/20 rounded-xl cursor-pointer hover:border-white/40 transition-colors"
            >
              {file2 ? (
                <>
                  <FileText className="w-5 h-5 text-blue-400" />
                  <span className="text-sm text-slate-300 truncate">{file2.name}</span>
                </>
              ) : (
                <>
                  <Upload className="w-5 h-5 text-slate-400" />
                  <span className="text-sm text-slate-400">选择文件 (txt/docx/pdf)</span>
                </>
              )}
            </label>
          </div>
        </div>
      </div>

      {/* Submit Button */}
      <button
        onClick={handleSubmit}
        disabled={loading || !file1 || !file2}
        className="w-full py-3 px-4 bg-gradient-to-r from-indigo-600 to-blue-600 text-white rounded-xl font-medium hover:from-indigo-700 hover:to-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            查重中...
          </>
        ) : (
          <>
            开始查重
            <ArrowRight className="w-5 h-5" />
          </>
        )}
      </button>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="space-y-4">
          {/* Similarity Score */}
          <div className="p-6 bg-white/5 rounded-xl text-center">
            <div className="text-sm text-slate-400 mb-2">整体相似度</div>
            <div className={`text-5xl font-bold ${getSimilarityColor(result.similarity)}`}>
              {result.similarity.toFixed(1)}%
            </div>
            <div className="mt-4 flex justify-center gap-6 text-sm text-slate-400">
              <div>论文1: {result.stats.totalSentences1} 句</div>
              <div>论文2: {result.stats.totalSentences2} 句</div>
              <div>匹配: {result.stats.matchedSentences} 句</div>
            </div>
          </div>

          {/* Matches */}
          {result.matches.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-slate-300">相似片段</h3>
              {result.matches.slice(0, 10).map((match, index) => (
                <div key={index} className="p-4 bg-white/5 rounded-xl">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs px-2 py-1 bg-red-500/20 text-red-400 rounded">
                      相似度: {(match.similarity * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="p-3 bg-red-500/10 rounded-lg">
                      <div className="text-xs text-red-400 mb-1">论文1</div>
                      <p className="text-sm text-slate-300 line-clamp-3">{match.text1}</p>
                    </div>
                    <div className="p-3 bg-orange-500/10 rounded-lg">
                      <div className="text-xs text-orange-400 mb-1">论文2</div>
                      <p className="text-sm text-slate-300 line-clamp-3">{match.text2}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Success Message */}
          <div className="flex items-center gap-2 p-4 bg-green-500/10 border border-green-500/30 rounded-xl text-green-400">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <span className="text-sm">查重完成</span>
          </div>
        </div>
      )}
    </div>
  );
}
