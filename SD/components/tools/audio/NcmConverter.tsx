import { useState } from 'react'
import { useFileUpload, UploadZone, Btn, formatFileSize, downloadBlob } from '../shared'

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
    const buffer = await file.arrayBuffer()
    const data = new Uint8Array(buffer)

    // Verify NCM magic header
    const magic = String.fromCharCode(data[0], data[1], data[2], data[3], data[4], data[5], data[6], data[7])
    if (magic !== 'CTENFDAM') {
      throw new Error('不是有效的 NCM 文件')
    }

    // Skip header (8 bytes magic + 4 bytes unknown)
    let offset = 1024 // Standard NCM header size

    // Read key length and extract encrypted key
    const keyLen = data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)
    offset += 4

    if (keyLen <= 0 || keyLen > 1024) {
      throw new Error('无效的 NCM 密钥长度')
    }

    // Extract and decrypt the AES key
    const encryptedKey = new Uint8Array(keyLen)
    for (let i = 0; i < keyLen; i++) {
      encryptedKey[i] = data[offset + i] ^ 0x64
    }
    offset += keyLen

    // Skip 4 bytes gap
    offset += 4

    // Read metadata length
    const metaLen = data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)
    offset += 4

    // Extract metadata (JSON)
    let metadata: Record<string, unknown> = {}
    if (metaLen > 0) {
      const metaBytes = new Uint8Array(metaLen)
      for (let i = 0; i < metaLen; i++) {
        metaBytes[i] = data[offset + i] ^ 0x63
      }
      offset += metaLen

      // Skip "163 key(Don't modify):" prefix
      const metaStr = new TextDecoder().decode(metaBytes)
      const jsonStart = metaStr.indexOf('{')
      if (jsonStart >= 0) {
        try {
          // Base64 decode the inner JSON
          const b64 = metaStr.slice(jsonStart)
          const decoded = atob(b64)
          metadata = JSON.parse(decoded)
        } catch {
          // Metadata parsing failed, continue anyway
        }
      }
    }

    // Skip CRC32 gap (9 bytes)
    offset += 9

    // Build the S-box for decryption
    const key = buildSbox(encryptedKey)

    // Decrypt the audio data
    const audioData = new Uint8Array(data.length - offset)
    for (let i = 0; i < audioData.length; i++) {
      const j = (i + 1) & 0xff
      audioData[i] = data[offset + i] ^ key[key[j] + key[(key[j] + j) & 0xff] & 0xff]
    }

    // Detect format (MP3 or FLAC)
    const format = detectFormat(audioData)
    const ext = format === 'flac' ? 'flac' : 'mp3'

    // Extract title from metadata
    const musicInfo = metadata?.musicName as Record<string, unknown> | undefined
    const title = (musicInfo?.name as string) || file.name.replace(/\.ncm$/i, '')
    const artist = (musicInfo?.artist as Array<{ name: string }>)?.[0]?.name || ''
    const baseName = artist ? `${artist} - ${title}` : title

    const blob = new Blob([audioData], { type: format === 'flac' ? 'audio/flac' : 'audio/mpeg' })
    const url = URL.createObjectURL(blob)

    return {
      name: `${sanitizeFilename(baseName)}.${ext}`,
      blob,
      url,
      size: blob.size,
      format: ext,
    }
  }

  const buildSbox = (key: Uint8Array): Uint8Array => {
    // AES key derivation (NCM uses a specific key schedule)
    const AES_KEY = new Uint8Array([
      0x68, 0x7A, 0x48, 0x52, 0x41, 0x6D, 0x73, 0x6F,
      0x35, 0x6B, 0x49, 0x6E, 0x62, 0x61, 0x78, 0x57,
    ])

    // Simple XOR-based key expansion (NCM simplified AES)
    const sbox = new Uint8Array(256)
    for (let i = 0; i < 256; i++) {
      sbox[i] = i
    }

    let j = 0
    for (let i = 0; i < 256; i++) {
      j = (sbox[i] + j + AES_KEY[i % AES_KEY.length] + (key[i % key.length] || 0)) & 0xff
      const tmp = sbox[i]
      sbox[i] = sbox[j]
      sbox[j] = tmp
    }

    return sbox
  }

  const detectFormat = (data: Uint8Array): string => {
    // MP3: starts with ID3 tag or 0xFF 0xFB
    if (data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33) return 'mp3' // ID3
    if (data[0] === 0xFF && (data[1] & 0xE0) === 0xE0) return 'mp3' // Sync word
    // FLAC: starts with fLaC
    if (data[0] === 0x66 && data[1] === 0x4C && data[2] === 0x61 && data[3] === 0x43) return 'flac'
    // OGG
    if (data[0] === 0x4F && data[1] === 0x67 && data[2] === 0x67) return 'ogg'
    return 'mp3' // Default
  }

  const sanitizeFilename = (name: string): string => {
    return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 200)
  }

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
