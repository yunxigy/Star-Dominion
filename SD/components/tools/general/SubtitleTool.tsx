import React, { useState, useRef } from 'react';
import { Btn, copyToClipboard, UploadZone } from '../shared';
import { Subtitles, Clock, Copy, CheckCircle, ArrowRight, ArrowLeft } from 'lucide-react';

interface SubtitleEntry {
  index: number;
  startTime: number; // ms
  endTime: number; // ms
  text: string;
}

const timeToMs = (time: string): number => {
  // SRT: 00:01:23,456 or VTT: 00:01:23.456
  const match = time.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!match) return 0;
  return (parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3])) * 1000 + parseInt(match[4].padEnd(3, '0').slice(0, 3));
};

const msToSrtTime = (ms: number): string => {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mil = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(mil).padStart(3, '0')}`;
};

const msToVttTime = (ms: number): string => {
  return msToSrtTime(ms).replace(',', '.');
};

const msToAssTime = (ms: number): string => {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
};

const parseSrt = (content: string): SubtitleEntry[] => {
  const blocks = content.trim().replace(/\r\n/g, '\n').split(/\n\n+/);
  const entries: SubtitleEntry[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length < 3) continue;
    const timeMatch = lines[1].match(/(\d+:\d+:\d+[,.]\d+)\s*-->\s*(\d+:\d+:\d+[,.]\d+)/);
    if (!timeMatch) continue;
    entries.push({
      index: parseInt(lines[0]) || entries.length + 1,
      startTime: timeToMs(timeMatch[1]),
      endTime: timeToMs(timeMatch[2]),
      text: lines.slice(2).join('\n'),
    });
  }
  return entries;
};

const parseVtt = (content: string): SubtitleEntry[] => {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const entries: SubtitleEntry[] = [];
  let i = 0;
  while (i < lines.length) {
    const timeMatch = lines[i].match(/(\d+:\d+:\d+\.\d+)\s*-->\s*(\d+:\d+:\d+\.\d+)/);
    if (timeMatch) {
      const textLines: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() && !lines[i].includes('-->')) {
        textLines.push(lines[i]);
        i++;
      }
      entries.push({
        index: entries.length + 1,
        startTime: timeToMs(timeMatch[1]),
        endTime: timeToMs(timeMatch[2]),
        text: textLines.join('\n'),
      });
    } else {
      i++;
    }
  }
  return entries;
};

const parseAss = (content: string): SubtitleEntry[] => {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const entries: SubtitleEntry[] = [];
  for (const line of lines) {
    if (!line.startsWith('Dialogue:')) continue;
    const parts = line.substring(9).split(',');
    if (parts.length < 10) continue;
    // ASS time: H:MM:SS.CS
    const startMs = timeToMs(parts[1].trim().replace(/\./g, ',').replace(/^(\d):/, '0$1:'));
    const endMs = timeToMs(parts[2].trim().replace(/\./g, ',').replace(/^(\d):/, '0$1:'));
    const text = parts.slice(9).join(',').replace(/\{[^}]*\}/g, '').replace(/\\N/g, '\n').replace(/\\n/g, '\n').trim();
    if (text) {
      entries.push({ index: entries.length + 1, startTime: startMs, endTime: endMs, text });
    }
  }
  return entries;
};

const toSrt = (entries: SubtitleEntry[]): string => {
  return entries.map((e, i) => `${i + 1}\n${msToSrtTime(e.startTime)} --> ${msToSrtTime(e.endTime)}\n${e.text}`).join('\n\n');
};

const toVtt = (entries: SubtitleEntry[]): string => {
  return 'WEBVTT\n\n' + entries.map((e, i) => `${i + 1}\n${msToVttTime(e.startTime)} --> ${msToVttTime(e.endTime)}\n${e.text}`).join('\n\n');
};

const toAss = (entries: SubtitleEntry[]): string => {
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,10,10,10,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const dialogues = entries.map(e => `Dialogue: 0,${msToAssTime(e.startTime)},${msToAssTime(e.endTime)},Default,,0,0,0,,${e.text.replace(/\n/g, '\\N')}`).join('\n');
  return header + dialogues;
};

const detectFormat = (content: string): 'srt' | 'vtt' | 'ass' | null => {
  if (content.trim().startsWith('WEBVTT')) return 'vtt';
  if (content.includes('[Script Info]') || content.includes('Dialogue:')) return 'ass';
  if (/^\d+\s*\n\d+:\d+:\d+[,.]\d+\s*-->/.test(content.trim())) return 'srt';
  return null;
};

const SubtitleTool: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [entries, setEntries] = useState<SubtitleEntry[]>([]);
  const [sourceFormat, setSourceFormat] = useState<string>('');
  const [targetFormat, setTargetFormat] = useState<'srt' | 'vtt' | 'ass'>('srt');
  const [offsetMs, setOffsetMs] = useState(0);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [fileName, setFileName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    setFileName(file.name);
    setError('');
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      const format = detectFormat(content);
      if (!format) {
        setError('无法识别字幕格式，支持 SRT、VTT、ASS 格式');
        return;
      }
      setSourceFormat(format.toUpperCase());
      const parsed = format === 'srt' ? parseSrt(content) : format === 'vtt' ? parseVtt(content) : parseAss(content);
      if (parsed.length === 0) {
        setError('未找到有效的字幕条目');
        return;
      }
      setEntries(parsed);
      setResult('');
    };
    reader.readAsText(file);
  };

  const handleConvert = () => {
    if (entries.length === 0) return;
    const adjusted = offsetMs !== 0
      ? entries.map(e => ({ ...e, startTime: Math.max(0, e.startTime + offsetMs), endTime: Math.max(0, e.endTime + offsetMs) }))
      : entries;
    setResult(targetFormat === 'srt' ? toSrt(adjusted) : targetFormat === 'vtt' ? toVtt(adjusted) : toAss(adjusted));
  };

  const handleCopy = async () => {
    if (!result) return;
    await copyToClipboard(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!result) return;
    const ext = targetFormat;
    const blob = new Blob([result], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName.replace(/\.[^.]+$/, '')}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b735c]">字幕文件工具 — SRT/VTT/ASS 格式互转、时间轴偏移</p>

      <UploadZone onUpload={() => inputRef.current?.click()} accept=".srt,.vtt,.ass,.ssa" />
      <input ref={inputRef} type="file" accept=".srt,.vtt,.ass,.ssa" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />

      {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">{error}</div>}

      {entries.length > 0 && (
        <>
          <div className="bg-[#fff4e6] border border-[#ead0ad] rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <Subtitles className="w-4 h-4 text-[#7a421b]" />
              <span className="text-xs font-medium text-[#6f3714]">{fileName}</span>
              <span className="text-[10px] text-[#8b735c]">源格式: {sourceFormat}</span>
            </div>
            <div className="text-xs text-[#6d5a47]">共 {entries.length} 条字幕</div>
          </div>

          {/* Preview */}
          <div className="border border-[#ead0ad] rounded-lg max-h-40 overflow-y-auto bg-white">
            {entries.slice(0, 20).map((e, i) => (
              <div key={i} className="flex items-start gap-2 px-3 py-1 text-xs border-b border-[#ead0ad] last:border-0">
                <span className="text-[10px] text-[#c79f72] w-6 shrink-0">{e.index}</span>
                <span className="text-[10px] text-[#8b735c] w-36 shrink-0 font-mono">
                  {msToSrtTime(e.startTime)} → {msToSrtTime(e.endTime)}
                </span>
                <span className="text-[#6d5a47] truncate">{e.text}</span>
              </div>
            ))}
            {entries.length > 20 && <div className="text-center text-[10px] text-[#8b735c] py-1">... 还有 {entries.length - 20} 条</div>}
          </div>

          {/* Convert options */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[#6d5a47] mb-1 block">目标格式</label>
              <select value={targetFormat} onChange={e => setTargetFormat(e.target.value as 'srt' | 'vtt' | 'ass')}
                className="w-full text-xs border border-[#ead0ad] rounded-lg px-3 py-1.5 bg-white">
                <option value="srt">SRT</option>
                <option value="vtt">WebVTT</option>
                <option value="ass">ASS/SSA</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-[#6d5a47] mb-1 block">时间偏移 (毫秒)</label>
              <div className="flex gap-1">
                <button onClick={() => setOffsetMs(o => o - 500)} className="px-2 py-1 text-xs border border-[#ead0ad] rounded bg-white hover:bg-[#fff4e6]">
                  <ArrowLeft className="w-3 h-3" />
                </button>
                <input type="number" value={offsetMs} onChange={e => setOffsetMs(parseInt(e.target.value) || 0)}
                  className="flex-1 text-xs border border-[#ead0ad] rounded px-2 py-1 bg-white text-center" />
                <button onClick={() => setOffsetMs(o => o + 500)} className="px-2 py-1 text-xs border border-[#ead0ad] rounded bg-white hover:bg-[#fff4e6]">
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
              <div className="text-[10px] text-[#8b735c] mt-0.5">
                {offsetMs > 0 ? `延后 ${offsetMs}ms` : offsetMs < 0 ? `提前 ${Math.abs(offsetMs)}ms` : '无偏移'}
              </div>
            </div>
          </div>

          <Btn onClick={handleConvert} className="w-full">转换</Btn>
        </>
      )}

      {result && (
        <>
          <div className="border border-[#ead0ad] rounded-lg p-3 bg-white">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-[#6f3714]">转换结果 ({targetFormat.toUpperCase()})</span>
              <div className="flex gap-1">
                <button onClick={handleCopy} className="p-1 text-[#7a421b] hover:text-[#6f3714]">
                  {copied ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                </button>
                <button onClick={handleDownload} className="p-1 text-[#7a421b] hover:text-[#6f3714]">
                  <Clock className="w-4 h-4" />
                </button>
              </div>
            </div>
            <pre className="text-[10px] text-[#6d5a47] max-h-48 overflow-y-auto whitespace-pre-wrap font-mono">{result.slice(0, 3000)}{result.length > 3000 ? '\n...' : ''}</pre>
          </div>
        </>
      )}

      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    </div>
  );
};

export default SubtitleTool;