import { useState, useRef, useEffect } from 'react'
import { useFileUpload, UploadZone, Btn, formatFileSize, downloadBlob } from '../shared'

interface VoiceEffect {
  name: string
  icon: string
  pitch: number
  speed: number
  description: string
}

const VOICE_EFFECTS: VoiceEffect[] = [
  { name: '原声', icon: '🎤', pitch: 1.0, speed: 1.0, description: '原始音频' },
  { name: '萝莉', icon: '👧', pitch: 1.6, speed: 1.1, description: '高音可爱' },
  { name: '大叔', icon: '👨', pitch: 0.7, speed: 0.9, description: '低沉浑厚' },
  { name: '机器人', icon: '🤖', pitch: 0.5, speed: 1.0, description: '机械音效' },
  { name: '加速', icon: '⚡', pitch: 1.0, speed: 1.5, description: '1.5x 速度' },
  { name: '慢速', icon: '🐢', pitch: 1.0, speed: 0.7, description: '0.7x 速度' },
  { name: '花栗鼠', icon: '🐿️', pitch: 2.0, speed: 1.0, description: '超高音' },
  { name: '巨人', icon: '🗿', pitch: 0.4, speed: 0.8, description: '超低音慢速' },
]

export default function VoiceChanger({ onClose }: { onClose: () => void }) {
  const { files, inputProps, triggerUpload, clearFiles } = useFileUpload('audio/*')
  const [selectedEffect, setSelectedEffect] = useState<VoiceEffect>(VOICE_EFFECTS[0])
  const [customPitch, setCustomPitch] = useState(1.0)
  const [customSpeed, setCustomSpeed] = useState(1.0)
  const [useCustom, setUseCustom] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [resultName, setResultName] = useState('')
  const [resultBlob, setResultBlob] = useState<Blob | null>(null)
  const [error, setError] = useState('')
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)

  useEffect(() => {
    if (files.length > 0) {
      const url = URL.createObjectURL(files[0])
      setSourceUrl(url)
      return () => URL.revokeObjectURL(url)
    }
    setSourceUrl(null)
  }, [files])

  const getAudioContext = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    }
    return audioCtxRef.current
  }

  const handleProcess = async () => {
    if (files.length === 0) return
    setProcessing(true)
    setError('')
    setResultUrl(null)

    try {
      const file = files[0]
      const arrayBuffer = await file.arrayBuffer()
      const ctx = getAudioContext()
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer)

      const pitch = useCustom ? customPitch : selectedEffect.pitch
      const speed = useCustom ? customSpeed : selectedEffect.speed

      const processedBlob = await processAudio(audioBuffer, pitch, speed)

      const baseName = file.name.replace(/\.[^.]+$/, '')
      const effectName = useCustom ? 'custom' : selectedEffect.name
      const outName = `${baseName}_${effectName}.wav`
      const url = URL.createObjectURL(processedBlob)

      setResultUrl(url)
      setResultName(outName)
      setResultBlob(processedBlob)
    } catch (e) {
      setError(`处理失败: ${(e as Error).message}`)
    } finally {
      setProcessing(false)
    }
  }

  const processAudio = async (buffer: AudioBuffer, pitch: number, speed: number): Promise<Blob> => {
    const ctx = getAudioContext()
    const numChannels = buffer.numberOfChannels
    const sampleRate = buffer.sampleRate
    const duration = buffer.duration / speed
    const newLength = Math.floor(buffer.length / speed)

    // Create offline context for rendering
    const offlineCtx = new OfflineAudioContext(numChannels, newLength, sampleRate)

    // Create source
    const source = offlineCtx.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = pitch * speed

    // Connect directly to destination
    source.connect(offlineCtx.destination)
    source.start(0)

    const rendered = await offlineCtx.startRendering()

    // Convert to WAV
    return audioBufferToWav(rendered)
  }

  const audioBufferToWav = (buffer: AudioBuffer): Blob => {
    const numChannels = buffer.numberOfChannels
    const sampleRate = buffer.sampleRate
    const bitsPerSample = 16
    const samples = interleave(buffer)
    const dataLength = samples.length * (bitsPerSample / 8)
    const totalLength = 44 + dataLength

    const arrayBuffer = new ArrayBuffer(totalLength)
    const view = new DataView(arrayBuffer)

    writeString(view, 0, 'RIFF')
    view.setUint32(4, totalLength - 8, true)
    writeString(view, 8, 'WAVE')
    writeString(view, 12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, numChannels, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true)
    view.setUint16(32, numChannels * (bitsPerSample / 8), true)
    view.setUint16(34, bitsPerSample, true)
    writeString(view, 36, 'data')
    view.setUint32(40, dataLength, true)

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
    if (resultBlob) downloadBlob(resultBlob, resultName)
  }

  const pitch = useCustom ? customPitch : selectedEffect.pitch
  const speed = useCustom ? customSpeed : selectedEffect.speed

  return (
    <div style={{ padding: 24, maxWidth: 600, margin: '0 auto' }}>
      <h2 style={{ margin: '0 0 8px', fontSize: 20 }}>🎙️ 音频变声器</h2>
      <p style={{ color: '#888', margin: '0 0 20px', fontSize: 14 }}>
        调节音调和速度，实现变声效果。纯浏览器处理。
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <span style={{ fontSize: 14, color: '#666' }}>
              <strong>{files[0].name}</strong> ({formatFileSize(files[0].size)})
            </span>
            <button onClick={clearFiles} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 13 }}>✕ 清除</button>
          </div>

          {sourceUrl && (
            <audio controls src={sourceUrl} style={{ width: '100%', marginBottom: 16 }} />
          )}

          {/* Preset effects */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 8 }}>预设效果</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {VOICE_EFFECTS.map((effect) => (
                <button
                  key={effect.name}
                  onClick={() => { setSelectedEffect(effect); setUseCustom(false) }}
                  style={{
                    padding: '8px 4px',
                    border: `2px solid ${!useCustom && selectedEffect.name === effect.name ? '#7c8aff' : '#e0e0e0'}`,
                    borderRadius: 8,
                    background: !useCustom && selectedEffect.name === effect.name ? '#eef0ff' : '#fff',
                    cursor: 'pointer',
                    fontSize: 12,
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: 20 }}>{effect.icon}</div>
                  <div style={{ fontWeight: 500, marginTop: 2 }}>{effect.name}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Custom controls */}
          <div style={{ marginBottom: 16, padding: 12, background: useCustom ? '#eef0ff' : '#f8f9fa', borderRadius: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginBottom: useCustom ? 12 : 0 }}>
              <input type="checkbox" checked={useCustom} onChange={(e) => setUseCustom(e.target.checked)} />
              <span style={{ fontWeight: 600 }}>自定义参数</span>
            </label>

            {useCustom && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#666', marginBottom: 4 }}>
                    <span>音调 (Pitch)</span>
                    <span>{customPitch.toFixed(2)}x</span>
                  </div>
                  <input
                    type="range" min={0.25} max={3} step={0.05} value={customPitch}
                    onChange={(e) => setCustomPitch(parseFloat(e.target.value))}
                    style={{ width: '100%' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#aaa' }}>
                    <span>低</span><span>高</span>
                  </div>
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#666', marginBottom: 4 }}>
                    <span>速度 (Speed)</span>
                    <span>{customSpeed.toFixed(2)}x</span>
                  </div>
                  <input
                    type="range" min={0.25} max={3} step={0.05} value={customSpeed}
                    onChange={(e) => setCustomSpeed(parseFloat(e.target.value))}
                    style={{ width: '100%' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#aaa' }}>
                    <span>慢</span><span>快</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <Btn onClick={handleProcess} disabled={processing}>
              {processing ? '处理中...' : `🎤 应用变声 (${pitch.toFixed(1)}x 音调, ${speed.toFixed(1)}x 速度)`}
            </Btn>
          </div>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 16, padding: 12, background: '#fef2f2', borderRadius: 8, color: '#991b1b', fontSize: 13 }}>
          {error}
        </div>
      )}

      {resultUrl && (
        <div style={{ marginTop: 16, padding: 16, background: '#f0fdf4', borderRadius: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#166534', marginBottom: 8 }}>✅ 变声完成</div>
          <audio controls src={resultUrl} style={{ width: '100%', marginBottom: 12 }} />
          <Btn onClick={handleDownload}>⬇ 下载变声音频</Btn>
        </div>
      )}

      <div style={{ marginTop: 24, textAlign: 'right' }}>
        <button onClick={onClose} style={{ background: 'none', border: '1px solid #d0d0d0', padding: '6px 16px', borderRadius: 6, cursor: 'pointer' }}>关闭</button>
      </div>
    </div>
  )
}
