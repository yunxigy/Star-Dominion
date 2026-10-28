import { useState, useRef } from 'react'
import { useFileUpload, UploadZone, Btn, formatFileSize, downloadBlob } from '../shared'

type AudioFormat = 'mp3' | 'wav' | 'ogg' | 'webm'

interface ConvertResult {
  name: string
  blob: Blob
  url: string
  size: number
  format: AudioFormat
}

export default function AudioConverter({ onClose }: { onClose: () => void }) {
  const { files, inputProps, triggerUpload, clearFiles } = useFileUpload('audio/*')
  const [targetFormat, setTargetFormat] = useState<AudioFormat>('mp3')
  const [converting, setConverting] = useState(false)
  const [result, setResult] = useState<ConvertResult | null>(null)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState(0)
  const audioCtxRef = useRef<AudioContext | null>(null)

  const getAudioContext = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    }
    return audioCtxRef.current
  }

  const handleConvert = async () => {
    if (files.length === 0) return
    setConverting(true)
    setError('')
    setProgress(0)
    setResult(null)

    try {
      const file = files[0]
      setProgress(10)

      const arrayBuffer = await file.arrayBuffer()
      setProgress(30)

      const ctx = getAudioContext()
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
      setProgress(60)

      const blob = await encodeAudio(audioBuffer, targetFormat)
      setProgress(90)

      const baseName = file.name.replace(/\.[^.]+$/, '')
      const url = URL.createObjectURL(blob)

      setResult({
        name: `${baseName}.${targetFormat}`,
        blob,
        url,
        size: blob.size,
        format: targetFormat,
      })
      setProgress(100)
    } catch (e) {
      setError(`转换失败: ${(e as Error).message}`)
    } finally {
      setConverting(false)
    }
  }

  const encodeAudio = async (buffer: AudioBuffer, format: AudioFormat): Promise<Blob> => {
    if (format === 'wav') {
      return encodeWav(buffer)
    }

    // For mp3/ogg/webm, use MediaRecorder
    const ctx = getAudioContext()
    const source = ctx.createBufferSource()
    source.buffer = buffer

    const destination = ctx.createMediaStreamDestination()
    source.connect(destination)

    const mimeType = format === 'mp3' ? 'audio/mpeg' : `audio/${format}`
    const supportedType = MediaRecorder.isTypeSupported(mimeType) ? mimeType : 'audio/webm'

    return new Promise((resolve, reject) => {
      const chunks: Blob[] = []
      const recorder = new MediaRecorder(destination.stream, { mimeType: supportedType })

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }

      recorder.onstop = () => {
        resolve(new Blob(chunks, { type: supportedType }))
      }

      recorder.onerror = () => reject(new Error('MediaRecorder error'))

      source.start(0)
      recorder.start()

      const duration = buffer.duration * 1000
      setTimeout(() => {
        recorder.stop()
        source.stop()
      }, duration + 100)
    })
  }

  const encodeWav = (buffer: AudioBuffer): Blob => {
    const numChannels = buffer.numberOfChannels
    const sampleRate = buffer.sampleRate
    const format = 1 // PCM
    const bitsPerSample = 16

    const samples = interleave(buffer)
    const dataLength = samples.length * (bitsPerSample / 8)
    const headerLength = 44
    const totalLength = headerLength + dataLength

    const arrayBuffer = new ArrayBuffer(totalLength)
    const view = new DataView(arrayBuffer)

    // WAV header
    writeString(view, 0, 'RIFF')
    view.setUint32(4, totalLength - 8, true)
    writeString(view, 8, 'WAVE')
    writeString(view, 12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, format, true)
    view.setUint16(22, numChannels, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true)
    view.setUint16(32, numChannels * (bitsPerSample / 8), true)
    view.setUint16(34, bitsPerSample, true)
    writeString(view, 36, 'data')
    view.setUint32(40, dataLength, true)

    // Write samples
    let offset = 44
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]))
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
      offset += 2
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' })
  }

  const interleave = (buffer: AudioBuffer): Float32Array => {
    const numChannels = buffer.numberOfChannels
    if (numChannels === 1) return buffer.getChannelData(0)

    const length = buffer.length
    const result = new Float32Array(length * numChannels)
    const channels = []
    for (let i = 0; i < numChannels; i++) {
      channels.push(buffer.getChannelData(i))
    }

    let index = 0
    for (let i = 0; i < length; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        result[index++] = channels[ch][i]
      }
    }
    return result
  }

  const writeString = (view: DataView, offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i))
    }
  }

  const handleDownload = () => {
    if (result) downloadBlob(result.blob, result.name)
  }

  return (
    <div style={{ padding: 24, maxWidth: 600, margin: '0 auto' }}>
      <h2 style={{ margin: '0 0 8px', fontSize: 20 }}>🎵 音频格式转换</h2>
      <p style={{ color: '#888', margin: '0 0 20px', fontSize: 14 }}>
        支持 MP3、WAV、OGG、WebM 格式互转，纯浏览器处理。
      </p>

      <UploadZone
        onUpload={triggerUpload}
        onDropFiles={(fileList) => { inputProps.onChange?.({ target: { files: fileList } } as unknown as React.ChangeEvent<HTMLInputElement>) }}
        accept="audio/*"
        label="拖拽音频文件到此处，或点击上传"
      />

      <input {...inputProps} />

      {files.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <span style={{ fontSize: 14, color: '#666' }}>源文件: <strong>{files[0].name}</strong> ({formatFileSize(files[0].size)})</span>
            <button onClick={clearFiles} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 13 }}>✕ 清除</button>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {(['mp3', 'wav', 'ogg', 'webm'] as AudioFormat[]).map((fmt) => (
              <button
                key={fmt}
                onClick={() => setTargetFormat(fmt)}
                style={{
                  padding: '6px 16px',
                  border: `2px solid ${targetFormat === fmt ? '#7c8aff' : '#e0e0e0'}`,
                  borderRadius: 8,
                  background: targetFormat === fmt ? '#eef0ff' : '#fff',
                  color: targetFormat === fmt ? '#5a6ae0' : '#666',
                  fontWeight: targetFormat === fmt ? 600 : 400,
                  cursor: 'pointer',
                  fontSize: 13,
                  textTransform: 'uppercase',
                }}
              >
                {fmt}
              </button>
            ))}
          </div>

          <Btn onClick={handleConvert} disabled={converting}>
            {converting ? `转换中... ${progress}%` : '开始转换'}
          </Btn>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 16, padding: 12, background: '#fef2f2', borderRadius: 8, color: '#991b1b', fontSize: 13 }}>
          {error}
        </div>
      )}

      {result && (
        <div style={{ marginTop: 16, padding: 16, background: '#f0fdf4', borderRadius: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#166534', marginBottom: 8 }}>✅ 转换完成</div>
          <div style={{ fontSize: 13, color: '#555', marginBottom: 12 }}>
            {result.name} · {formatFileSize(result.size)}
          </div>
          <audio controls src={result.url} style={{ width: '100%', marginBottom: 12 }} />
          <Btn onClick={handleDownload}>⬇ 下载文件</Btn>
        </div>
      )}

      <div style={{ marginTop: 24, textAlign: 'right' }}>
        <button onClick={onClose} style={{ background: 'none', border: '1px solid #d0d0d0', padding: '6px 16px', borderRadius: 6, cursor: 'pointer' }}>关闭</button>
      </div>
    </div>
  )
}
