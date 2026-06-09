import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Play, Pause, Square, Volume2, Settings, Download } from 'lucide-react';

export default function TextToSpeech({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<number>(0);
  const [rate, setRate] = useState(1);
  const [pitch, setPitch] = useState(1);
  const [volume, setVolume] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    const loadVoices = () => {
      const availableVoices = speechSynthesis.getVoices();
      setVoices(availableVoices);
    };

    loadVoices();
    speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      speechSynthesis.cancel();
    };
  }, []);

  const handlePlay = useCallback(() => {
    if (!text.trim()) return;

    speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voices[selectedVoice] || null;
    utterance.rate = rate;
    utterance.pitch = pitch;
    utterance.volume = volume;

    utterance.onstart = () => {
      setIsPlaying(true);
      setIsPaused(false);
    };

    utterance.onend = () => {
      setIsPlaying(false);
      setIsPaused(false);
    };

    utterance.onerror = () => {
      setIsPlaying(false);
      setIsPaused(false);
    };

    utteranceRef.current = utterance;
    speechSynthesis.speak(utterance);
  }, [text, voices, selectedVoice, rate, pitch, volume]);

  const handlePause = useCallback(() => {
    speechSynthesis.pause();
    setIsPaused(true);
  }, []);

  const handleResume = useCallback(() => {
    speechSynthesis.resume();
    setIsPaused(false);
  }, []);

  const handleStop = useCallback(() => {
    speechSynthesis.cancel();
    setIsPlaying(false);
    setIsPaused(false);
  }, []);

  return (
    <div className="space-y-6">
      {/* Input Text */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-slate-300">输入文本</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="请输入要转换为语音的文本..."
          className="w-full h-32 p-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:border-white/20 resize-none"
        />
        <div className="text-xs text-slate-500 text-right">
          {text.length} 字
        </div>
      </div>

      {/* Settings Toggle */}
      <button
        onClick={() => setShowSettings(!showSettings)}
        className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors"
      >
        <Settings className="w-4 h-4" />
        {showSettings ? '隐藏设置' : '显示设置'}
      </button>

      {/* Settings */}
      {showSettings && (
        <div className="space-y-4 p-4 bg-white/5 rounded-xl">
          {/* Voice Selection */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-300">语音</label>
            <select
              value={selectedVoice}
              onChange={(e) => setSelectedVoice(Number(e.target.value))}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-white/20"
            >
              {voices.map((voice, index) => (
                <option key={index} value={index}>
                  {voice.name} ({voice.lang})
                </option>
              ))}
            </select>
          </div>

          {/* Rate */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-300">
              语速: {rate.toFixed(1)}x
            </label>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={rate}
              onChange={(e) => setRate(Number(e.target.value))}
              className="w-full"
            />
          </div>

          {/* Pitch */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-300">
              音调: {pitch.toFixed(1)}
            </label>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={pitch}
              onChange={(e) => setPitch(Number(e.target.value))}
              className="w-full"
            />
          </div>

          {/* Volume */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-300">
              音量: {Math.round(volume * 100)}%
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="w-full"
            />
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex gap-3">
        {!isPlaying ? (
          <button
            onClick={handlePlay}
            disabled={!text.trim()}
            className="flex-1 py-3 px-4 bg-gradient-to-r from-indigo-600 to-blue-600 text-white rounded-xl font-medium hover:from-indigo-700 hover:to-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Play className="w-5 h-5" />
            播放
          </button>
        ) : (
          <>
            {isPaused ? (
              <button
                onClick={handleResume}
                className="flex-1 py-3 px-4 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-xl font-medium hover:from-green-700 hover:to-emerald-700 transition-all flex items-center justify-center gap-2"
              >
                <Play className="w-5 h-5" />
                继续
              </button>
            ) : (
              <button
                onClick={handlePause}
                className="flex-1 py-3 px-4 bg-gradient-to-r from-yellow-600 to-orange-600 text-white rounded-xl font-medium hover:from-yellow-700 hover:to-orange-700 transition-all flex items-center justify-center gap-2"
              >
                <Pause className="w-5 h-5" />
                暂停
              </button>
            )}
            <button
              onClick={handleStop}
              className="py-3 px-4 bg-white/5 border border-white/10 text-slate-300 rounded-xl hover:bg-white/10 transition-colors"
            >
              <Square className="w-5 h-5" />
            </button>
          </>
        )}
      </div>

      {/* Status */}
      {isPlaying && (
        <div className="flex items-center gap-2 p-4 bg-blue-500/10 border border-blue-500/30 rounded-xl text-blue-400">
          <Volume2 className="w-5 h-5 animate-pulse" />
          <span className="text-sm">{isPaused ? '已暂停' : '播放中...'}</span>
        </div>
      )}
    </div>
  );
}
