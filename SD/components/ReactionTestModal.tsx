import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, MousePointerClick, RotateCcw, Trophy, Zap } from 'lucide-react';

interface ReactionTestModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Phase = 'idle' | 'waiting' | 'ready' | 'result' | 'finished';

const ROUNDS = 3;

const getGrade = (ms: number) => {
  if (ms < 200) return { text: '天才级！', color: 'text-yellow-400', emoji: '⚡' };
  if (ms < 300) return { text: '非常优秀', color: 'text-green-400', emoji: '🔥' };
  if (ms < 500) return { text: '还不错', color: 'text-blue-400', emoji: '👍' };
  return { text: '需要练习', color: 'text-slate-400', emoji: '💪' };
};

export const ReactionTestModal: React.FC<ReactionTestModalProps> = ({ isOpen, onClose }) => {
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState(0);
  const [results, setResults] = useState<number[]>([]);
  const [currentMs, setCurrentMs] = useState(0);
  const [bestScore, setBestScore] = useState<number | null>(() => {
    const saved = localStorage.getItem('reaction_best');
    return saved ? parseInt(saved) : null;
  });
  const startTimeRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const cleanup = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  const startRound = useCallback(() => {
    setPhase('waiting');
    const delay = 2000 + Math.random() * 4000;
    timerRef.current = setTimeout(() => {
      setPhase('ready');
      startTimeRef.current = performance.now();
    }, delay);
  }, []);

  const handleClick = useCallback(() => {
    if (phase === 'idle' || phase === 'finished') {
      setPhase('idle');
      setRound(0);
      setResults([]);
      startRound();
      return;
    }

    if (phase === 'waiting') {
      cleanup();
      setPhase('result');
      setCurrentMs(-1); // -1 means too early
      return;
    }

    if (phase === 'ready') {
      const ms = Math.round(performance.now() - startTimeRef.current);
      setCurrentMs(ms);
      const newResults = [...results, ms];
      setResults(newResults);
      setPhase('result');

      if (round + 1 >= ROUNDS) {
        const avg = Math.round(newResults.reduce((a, b) => a + b, 0) / newResults.length);
        if (!bestScore || avg < bestScore) {
          setBestScore(avg);
          localStorage.setItem('reaction_best', String(avg));
        }
        setTimeout(() => setPhase('finished'), 1500);
      } else {
        setRound(round + 1);
        setTimeout(() => startRound(), 1500);
      }
    }
  }, [phase, round, results, bestScore, cleanup, startRound]);

  const getBgColor = () => {
    switch (phase) {
      case 'waiting': return 'bg-red-900/40 border-red-500/30';
      case 'ready': return 'bg-green-900/40 border-green-500/30';
      case 'result': return currentMs === -1 ? 'bg-yellow-900/40 border-yellow-500/30' : 'bg-blue-900/40 border-blue-500/30';
      case 'finished': return 'bg-purple-900/40 border-purple-500/30';
      default: return 'bg-slate-900/40 border-slate-700';
    }
  };

  const getMessage = () => {
    switch (phase) {
      case 'idle': return '点击任意位置开始测试';
      case 'waiting': return '等待屏幕变绿...';
      case 'ready': return '就是现在！点击！';
      case 'result':
        if (currentMs === -1) return '太早了！还没变绿就点了';
        return `${currentMs} ms`;
      case 'finished':
        const avg = Math.round(results.reduce((a, b) => a + b, 0) / results.length);
        return `平均反应: ${avg} ms`;
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-slate-950/90 backdrop-blur-sm"
        />
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 50 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 50 }}
          className="relative w-full max-w-2xl bg-gradient-to-b from-slate-900 to-black border border-orange-500/30 rounded-2xl shadow-[0_0_50px_rgba(249,115,22,0.2)] overflow-hidden"
        >
          {/* Header */}
          <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-orange-500/5">
            <h2 className="text-2xl font-bold text-orange-400 flex items-center gap-2">
              <MousePointerClick className="w-6 h-6" />
              鼠标反应测试
            </h2>
            <div className="flex items-center gap-3">
              {bestScore && (
                <span className="text-sm text-yellow-400 flex items-center gap-1">
                  <Trophy className="w-4 h-4" /> 最佳: {bestScore}ms
                </span>
              )}
              <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>

          {/* Game Area */}
          <div
            onClick={handleClick}
            className={`relative min-h-[400px] flex flex-col items-center justify-center cursor-pointer select-none transition-colors duration-300 ${getBgColor()}`}
          >
            {/* Round indicator */}
            {phase !== 'idle' && phase !== 'finished' && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 text-sm text-slate-400 font-mono">
                第 {round + 1} / {ROUNDS} 轮
              </div>
            )}

            {/* Result dots */}
            {results.length > 0 && phase !== 'finished' && (
              <div className="absolute top-4 right-4 flex gap-2">
                {results.map((ms, i) => (
                  <span key={i} className="text-xs font-mono text-slate-400 bg-slate-800 px-2 py-1 rounded">
                    {ms}ms
                  </span>
                ))}
              </div>
            )}

            {/* Main content */}
            <motion.div
              key={phase + round}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="text-center"
            >
              {phase === 'result' && currentMs === -1 ? (
                <Zap className="w-16 h-16 text-yellow-400 mx-auto mb-4" />
              ) : phase === 'ready' ? (
                <MousePointerClick className="w-16 h-16 text-green-400 mx-auto mb-4 animate-pulse" />
              ) : phase === 'finished' ? (
                <Trophy className="w-16 h-16 text-yellow-400 mx-auto mb-4" />
              ) : (
                <MousePointerClick className="w-16 h-16 text-slate-500 mx-auto mb-4" />
              )}

              <p className={`text-3xl font-bold ${
                phase === 'waiting' ? 'text-red-400' :
                phase === 'ready' ? 'text-green-400' :
                phase === 'result' ? (currentMs === -1 ? 'text-yellow-400' : 'text-blue-400') :
                phase === 'finished' ? 'text-purple-400' :
                'text-slate-300'
              }`}>
                {getMessage()}
              </p>

              {phase === 'result' && currentMs > 0 && (
                <p className={`text-lg mt-2 ${getGrade(currentMs).color}`}>
                  {getGrade(currentMs).emoji} {getGrade(currentMs).text}
                </p>
              )}

              {phase === 'finished' && (
                <div className="mt-6 space-y-3">
                  <div className="flex justify-center gap-4">
                    {results.map((ms, i) => (
                      <div key={i} className="text-center">
                        <div className="text-xs text-slate-500 mb-1">第{i + 1}轮</div>
                        <div className="text-lg font-mono text-slate-200">{ms}ms</div>
                      </div>
                    ))}
                  </div>
                  {(() => {
                    const avg = Math.round(results.reduce((a, b) => a + b, 0) / results.length);
                    return (
                      <p className={`text-xl ${getGrade(avg).color}`}>
                        {getGrade(avg).emoji} {getGrade(avg).text}
                      </p>
                    );
                  })()}
                  <p className="text-sm text-slate-500 mt-4 flex items-center gap-2 justify-center">
                    <RotateCcw className="w-4 h-4" /> 点击任意位置再来一次
                  </p>
                </div>
              )}

              {phase === 'idle' && (
                <p className="text-sm text-slate-500 mt-4">
                  测试 {ROUNDS} 轮，取平均值
                </p>
              )}
            </motion.div>
          </div>

          <div className="p-4 bg-slate-900/80 text-center text-xs text-slate-600 border-t border-slate-800">
            反应速度测试 • 纯前端计时
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
