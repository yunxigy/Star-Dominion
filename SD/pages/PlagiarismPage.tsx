import React, { useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FileSearch, Upload, FileText, AlertTriangle, CheckCircle, Loader2, X, ArrowRightLeft } from 'lucide-react'

interface Segment {
  text_a: string
  text_b: string
  similarity: number
}

interface CompareResult {
  overall_similarity: number
  level: string
  stats: {
    total_sentences_a: number
    total_sentences_b: number
    similar_sentence_count: number
  }
  segments: Segment[]
}

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
}

export const PlagiarismPage: React.FC = () => {
  const [fileA, setFileA] = useState<File | null>(null)
  const [fileB, setFileB] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<CompareResult | null>(null)
  const [error, setError] = useState('')
  const inputARef = useRef<HTMLInputElement>(null)
  const inputBRef = useRef<HTMLInputElement>(null)

  const handleDrop = useCallback((e: React.DragEvent, side: 'a' | 'b') => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) side === 'a' ? setFileA(file) : setFileB(file)
  }, [])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, side: 'a' | 'b') => {
    const file = e.target.files?.[0]
    if (file) side === 'a' ? setFileA(file) : setFileB(file)
  }

  const handleCompare = async () => {
    if (!fileA || !fileB) return
    setLoading(true)
    setError('')
    setResult(null)

    try {
      const form = new FormData()
      form.append('file_a', fileA)
      form.append('file_b', fileB)

      const res = await fetch('/plagiarism/api/plagiarism/compare', { method: 'POST', body: form })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(err.detail || '请求失败')
      }
      const data = await res.json()
      setResult(data)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const levelColor = result?.level === '高' ? 'text-red-400' : result?.level === '中' ? 'text-yellow-400' : 'text-green-400'
  const levelBg = result?.level === '高' ? 'from-red-500/20 to-red-600/20 border-red-500/30' : result?.level === '中' ? 'from-yellow-500/20 to-yellow-600/20 border-yellow-500/30' : 'from-green-500/20 to-green-600/20 border-green-500/30'

  return (
    <div className="max-w-5xl mx-auto space-y-16 pb-20">
      {/* Hero */}
      <motion.section
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="text-center pt-8 relative"
      >
        <div className="absolute inset-0 flex items-center justify-center -z-10 opacity-20">
          <div className="w-80 h-80 bg-gradient-to-r from-red-500 to-rose-600 rounded-full blur-[120px]" />
        </div>
        <div className="inline-flex p-5 rounded-2xl bg-gradient-to-br from-red-600/20 to-rose-600/20 border border-red-500/20 mb-6">
          <FileSearch className="w-14 h-14 text-red-400" />
        </div>
        <h1 className="text-4xl md:text-5xl font-bold mb-3">
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-red-300 via-rose-300 to-orange-300">
            自建库查重
          </span>
        </h1>
        <p className="text-slate-400 text-lg max-w-xl mx-auto">
          上传两篇论文，基于 TF-IDF + 余弦相似度算法，精准比对文本相似度
        </p>
      </motion.section>

      {/* Upload Area */}
      <motion.section
        initial="hidden"
        animate="visible"
        variants={{ visible: { transition: { staggerChildren: 0.15 } } }}
        className="grid grid-cols-1 md:grid-cols-2 gap-6"
      >
        {[
          { label: '论文 A', file: fileA, side: 'a' as const, ref: inputARef },
          { label: '论文 B', file: fileB, side: 'b' as const, ref: inputBRef },
        ].map(({ label, file, side, ref }) => (
          <motion.div
            key={side}
            variants={itemVariants}
            className={`relative p-8 rounded-xl border-2 border-dashed transition-all cursor-pointer ${
              file
                ? 'border-green-500/50 bg-green-500/5'
                : 'border-slate-600/50 bg-slate-900/30 hover:border-red-500/40 hover:bg-slate-900/50'
            }`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => handleDrop(e, side)}
            onClick={() => ref.current?.click()}
          >
            <input
              ref={ref}
              type="file"
              accept=".txt,.docx,.pdf"
              className="hidden"
              onChange={(e) => handleFileChange(e, side)}
            />
            <div className="flex flex-col items-center gap-3 text-center">
              {file ? (
                <>
                  <FileText className="w-10 h-10 text-green-400" />
                  <p className="text-slate-200 font-medium">{file.name}</p>
                  <p className="text-slate-500 text-sm">{(file.size / 1024).toFixed(1)} KB</p>
                  <button
                    className="absolute top-3 right-3 p-1 rounded-full hover:bg-slate-700/50"
                    onClick={(e) => {
                      e.stopPropagation()
                      side === 'a' ? setFileA(null) : setFileB(null)
                    }}
                  >
                    <X className="w-4 h-4 text-slate-400" />
                  </button>
                </>
              ) : (
                <>
                  <Upload className="w-10 h-10 text-slate-500" />
                  <p className="text-slate-300 font-medium">{label}</p>
                  <p className="text-slate-500 text-sm">拖拽或点击上传 · 支持 txt / docx / pdf</p>
                </>
              )}
            </div>
          </motion.div>
        ))}
      </motion.section>

      {/* Compare Button */}
      <div className="text-center">
        <button
          onClick={handleCompare}
          disabled={!fileA || !fileB || loading}
          className="inline-flex items-center gap-2 px-8 py-3 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 text-white font-medium text-lg transition-all hover:shadow-lg hover:shadow-red-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              分析中...
            </>
          ) : (
            <>
              <ArrowRightLeft className="w-5 h-5" />
              开始查重
            </>
          )}
        </button>
      </div>

      {/* Error */}
      {error && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center gap-3"
        >
          <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />
          <p className="text-red-300">{error}</p>
        </motion.div>
      )}

      {/* Result */}
      <AnimatePresence>
        {result && (
          <motion.section
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="space-y-8"
          >
            {/* Overall Score */}
            <div className={`p-8 rounded-2xl bg-gradient-to-br ${levelBg} border text-center`}>
              <p className="text-slate-400 text-sm mb-2">整体相似度</p>
              <div className="inline-flex items-baseline gap-1">
                <span className={`text-6xl font-bold ${levelColor}`}>
                  {result.overall_similarity}
                </span>
                <span className="text-2xl text-slate-400">%</span>
              </div>
              <p className={`mt-2 text-lg font-medium ${levelColor}`}>
                相似度等级：{result.level}
              </p>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: '论文A 句数', value: result.stats.total_sentences_a },
                { label: '论文B 句数', value: result.stats.total_sentences_b },
                { label: '相似句数', value: result.stats.similar_sentence_count },
              ].map((s) => (
                <div key={s.label} className="p-4 rounded-xl bg-slate-900/40 border border-slate-700/50 text-center">
                  <p className="text-2xl font-bold text-slate-100">{s.value}</p>
                  <p className="text-slate-500 text-sm mt-1">{s.label}</p>
                </div>
              ))}
            </div>

            {/* Similar Segments */}
            {result.segments.length > 0 && (
              <div>
                <h3 className="text-xl font-semibold text-slate-200 mb-4 flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-400" />
                  相似片段对比（前 {Math.min(result.segments.length, 20)} 条）
                </h3>
                <div className="space-y-3">
                  {result.segments.slice(0, 20).map((seg, i) => (
                    <div
                      key={i}
                      className="p-4 rounded-xl bg-slate-900/40 border border-slate-700/50"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-300">
                          相似度 {seg.similarity}%
                        </span>
                        <span className="text-xs text-slate-600">#{i + 1}</span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20">
                          <p className="text-xs text-red-400 mb-1">论文 A</p>
                          <p className="text-sm text-slate-300 leading-relaxed">{seg.text_a}</p>
                        </div>
                        <div className="p-3 rounded-lg bg-orange-500/5 border border-orange-500/20">
                          <p className="text-xs text-orange-400 mb-1">论文 B</p>
                          <p className="text-sm text-slate-300 leading-relaxed">{seg.text_b}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  )
}
