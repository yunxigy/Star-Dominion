import { useState } from 'react'
import { useFileUpload, UploadZone, Btn, formatFileSize, downloadBlob } from '../shared'
import { decryptNcmData } from './ncm'

interface NcmResult {
  name: string
  blob: Blob
  url: string
  size: number
  format: string
}

export default function NcmConverter({ onClose }: { onClose: () => void }) {
  const { files, inputProps, triggerUpload, clearFiles } = useFileUpload('.ncm')
  const [converting, setConverting] = useState(false)
  const [results, setResults] = useState<NcmResult[]>([])
  const [error, setError] = useState('')
  const [progress, setProgress] = useState({ current: 0, total: 0 })

  const handleConvert = async () => {
    if (files.length === 0) return
    setConverting(true)
    setError('')
    setResults([])
    setProgress({ current: 0, total: files.length })

    const newResults: NcmResult[] = []

    for (let i = 0; i < files.length; i++) {
      setProgress({ current: i + 1, total: files.length })
      try {
        const result = await decryptNcm(files[i])
        newResults.push(result)
      } catch (e) {
        setError(`"${files[i].name}" 解密失败: ${(e as Error).message}`)
      }
    }

    setResults(newResults)
    setConverting(false)
  }

  const decryptNcm = async (file: File): Promise<NcmResult> => {
    const decoded = await decryptNcmData(new Uint8Array(await file.arrayBuffer()))
    const title = String(decoded.metadata.musicName || file.name.replace(/\.ncm$/i, ''))
    const artistValue = decoded.metadata.artist
    const artist = Array.isArray(artistValue)
      ? String(Array.isArray(artistValue[0]) ? artistValue[0][0] : (artistValue[0] as { name?: string })?.name || '')
      : String(artistValue || '')
    const baseName = artist ? `${artist} - ${title}` : title

    const ext = decoded.format
    const audioBuffer = decoded.audioData.buffer.slice(
      decoded.audioData.byteOffset,
      decoded.audioData.byteOffset + decoded.audioData.byteLength,
    ) as ArrayBuffer
    const blob = new Blob([audioBuffer], { type: ext === 'flac' ? 'audio/flac' : ext === 'ogg' ? 'audio/ogg' : 'audio/mpeg' })
    const url = URL.createObjectURL(blob)

    return {
      name: `${sanitizeFilename(baseName)}.${ext}`,
      blob,
      url,
      size: blob.size,
      format: ext,
    }
  }

  const sanitizeFilename = (name: string): string => name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 200)

  const handleDownload = (result: NcmResult) => {
    downloadBlob(result.blob, result.name)
  }

  const handleDownloadAll = () => {
    results.forEach((r) => downloadBlob(r.blob, r.name))
  }

  return (
    <div style={{ padding: 24, maxWidth: 600, margin: '0 auto' }}>
      <h2 style={{ margin: '0 0 8px', fontSize: 20 }}>🔓 NCM 转换器</h2>
      <p style={{ color: '#888', margin: '0 0 20px', fontSize: 14 }}>
        将网易云音乐 NCM 加密文件转换为 MP3/FLAC 格式。纯浏览器端解密，数据不上传。
      </p>

      <UploadZone
        onUpload={triggerUpload}
        onDropFiles={(fileList) => { inputProps.onChange?.({ target: { files: fileList } } as unknown as React.ChangeEvent<HTMLInputElement>) }}
        accept=".ncm"
        label="拖拽 NCM 文件到此处，或点击上传（支持批量）"
      />

      <input {...inputProps} />

      {files.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <span style={{ fontSize: 14, color: '#666' }}>
              已选择 <strong>{files.length}</strong> 个文件
              ({formatFileSize(files.reduce((s, f) => s + f.size, 0))})
            </span>
            <button onClick={clearFiles} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 13 }}>✕ 清除</button>
          </div>

          <div style={{ maxHeight: 120, overflowY: 'auto', marginBottom: 12 }}>
            {files.map((f, i) => (
              <div key={i} style={{ fontSize: 12, color: '#888', padding: '2px 0' }}>
                {f.name} ({formatFileSize(f.size)})
              </div>
            ))}
          </div>

          <Btn onClick={handleConvert} disabled={converting}>
            {converting ? `解密中 ${progress.current}/${progress.total}...` : `开始解密 (${files.length} 个文件)`}
          </Btn>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 16, padding: 12, background: '#fef2f2', borderRadius: 8, color: '#991b1b', fontSize: 13 }}>
          {error}
        </div>
      )}

      {results.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#166534' }}>
              ✅ 解密完成 ({results.length} 个)
            </span>
            {results.length > 1 && (
              <Btn onClick={handleDownloadAll}>⬇ 全部下载</Btn>
            )}
          </div>

          {results.map((r, i) => (
            <div key={i} style={{ padding: 12, background: '#f0fdf4', borderRadius: 8, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{r.name}</div>
                <div style={{ fontSize: 11, color: '#888' }}>{r.format.toUpperCase()} · {formatFileSize(r.size)}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <audio controls src={r.url} style={{ height: 32 }} />
                <Btn onClick={() => handleDownload(r)}>⬇</Btn>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 16, padding: 12, background: '#f8f9fa', borderRadius: 8, fontSize: 12, color: '#888' }}>
        <strong>说明：</strong>NCM 是网易云音乐的加密格式。本工具在浏览器端直接解密，不上传任何数据。
        解密后的音频质量与原始文件一致。
      </div>

      <div style={{ marginTop: 24, textAlign: 'right' }}>
        <button onClick={onClose} style={{ background: 'none', border: '1px solid #d0d0d0', padding: '6px 16px', borderRadius: 6, cursor: 'pointer' }}>关闭</button>
      </div>
    </div>
  )
}
