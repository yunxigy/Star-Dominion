import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Clipboard,
  Clock3,
  Dices,
  Gift,
  History,
  Layers,
  RotateCcw,
  RotateCw,
  Share2,
  Sparkles,
  Trash2,
  Trophy,
  Users,
} from 'lucide-react';

import {
  buildLotteryPool,
  drawWinners,
  getAvailableLotteryEntries,
  getLotteryShareText,
  getWheelRotation,
  loadLotteryHistory,
  LOTTERY_PRESETS,
  parseLotteryEntries,
  saveLotteryHistory,
  type LotteryHistoryEntry,
  type LotteryMode,
} from './lottery';

const SAMPLE_NAMES = '小红\n小明\n阿杰\n小雨\n安安\n阿宁';
const WHEEL_COLORS = ['#d95f67', '#e29a4d', '#c6a950', '#719a73', '#5e8e9f', '#8974a8', '#bd718b', '#d37752'];
const ROLLING_TICKS = 20;
const ROLLING_INTERVAL = 72;
const WHEEL_SPIN_DURATION = 1700;

const MODE_OPTIONS: Array<{ id: LotteryMode; name: string; description: string; icon: React.ReactNode }> = [
  { id: 'rolling', name: '滚动开奖', description: '像抽奖箱一样快速滚动', icon: <RotateCw aria-hidden="true" /> },
  { id: 'wheel', name: '幸运转盘', description: '看着指针停在谁身上', icon: <Dices aria-hidden="true" /> },
  { id: 'card', name: '翻牌抽奖', description: '一张张翻开好运', icon: <Layers aria-hidden="true" /> },
];

function formatTime(date: Date): string {
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function clampCount(value: number, poolSize: number): number {
  if (poolSize <= 0) return 1;
  return Math.min(Math.max(Math.floor(value) || 1, 1), poolSize);
}

const LotteryTool: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [names, setNames] = useState('');
  const [count, setCount] = useState(1);
  const [removeDup, setRemoveDup] = useState(true);
  const [mode, setMode] = useState<LotteryMode>('rolling');
  const [winners, setWinners] = useState<string[]>([]);
  const [currentLabel, setCurrentLabel] = useState('');
  const [isDrawing, setIsDrawing] = useState(false);
  const [wheelRotation, setWheelRotation] = useState(0);
  const [activeWheelIndex, setActiveWheelIndex] = useState<number | null>(null);
  const [removeAfterDraw, setRemoveAfterDraw] = useState(false);
  const [eliminatedEntries, setEliminatedEntries] = useState<string[]>([]);
  const [history, setHistory] = useState<LotteryHistoryEntry[]>(loadLotteryHistory);
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionRef = useRef(0);
  const historyIdRef = useRef(0);

  const entries = useMemo(() => parseLotteryEntries(names), [names]);
  const basePool = useMemo(() => buildLotteryPool(entries, removeDup), [entries, removeDup]);
  const pool = useMemo(
    () => getAvailableLotteryEntries(basePool, removeAfterDraw ? eliminatedEntries : []),
    [basePool, eliminatedEntries, removeAfterDraw],
  );
  const safeCount = clampCount(count, pool.length);
  const wheelBackground = useMemo(() => {
    if (pool.length === 0) return 'conic-gradient(from -90deg, #d9c8b4 0 100%)';
    const stops = pool.map((_, index) => {
      const start = (index / pool.length) * 100;
      const end = ((index + 1) / pool.length) * 100;
      const color = WHEEL_COLORS[index % WHEEL_COLORS.length];
      return `${color} ${start}% ${end}%`;
    });
    return `conic-gradient(from -90deg, ${stops.join(', ')})`;
  }, [pool]);

  const clearTimers = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  useEffect(() => {
    saveLotteryHistory(history);
  }, [history]);

  const completeDraw = useCallback((result: string[], drawMode: LotteryMode, sessionId: number) => {
    if (sessionRef.current !== sessionId) return;
    clearTimers();
    setWinners(result);
    setCurrentLabel('');
    setIsDrawing(false);
    setActiveWheelIndex(null);
    setHistory(previous => [
      {
        id: Date.now() + historyIdRef.current++,
        mode: drawMode,
        winners: result,
        time: formatTime(new Date()),
      },
      ...previous,
    ].slice(0, 8));
    if (removeAfterDraw) {
      setEliminatedEntries(previous => [...new Set([...previous, ...result])]);
    }
  }, [clearTimers, removeAfterDraw]);

  const startRolling = useCallback((items: string[], result: string[], sessionId: number, drawMode: LotteryMode = 'rolling') => {
    let tick = 0;
    setCurrentLabel(items[0]);
    intervalRef.current = setInterval(() => {
      setCurrentLabel(items[Math.floor(Math.random() * items.length)]);
      tick += 1;
      if (tick >= ROLLING_TICKS) {
        completeDraw(result, drawMode, sessionId);
      }
    }, ROLLING_INTERVAL);
  }, [completeDraw]);

  const startWheel = useCallback((items: string[], winnerIndexes: number[], result: string[], sessionId: number) => {
    let winnerIndex = 0;
    const spinNext = () => {
      if (sessionRef.current !== sessionId) return;
      const selectedIndex = winnerIndexes[winnerIndex];
      setActiveWheelIndex(selectedIndex);
      setCurrentLabel(items[selectedIndex]);
      setWheelRotation(previous => getWheelRotation(selectedIndex, items.length, previous, 5));
      timeoutRef.current = setTimeout(() => {
        winnerIndex += 1;
        if (winnerIndex >= winnerIndexes.length) {
          completeDraw(result, 'wheel', sessionId);
          return;
        }
        spinNext();
      }, WHEEL_SPIN_DURATION);
    };
    spinNext();
  }, [completeDraw]);

  const startLottery = () => {
    if (isDrawing) return;
    if (pool.length === 0) {
      setNotice('先输入至少一位候选人，再开始抽奖。');
      return;
    }

    clearTimers();
    const sessionId = sessionRef.current + 1;
    sessionRef.current = sessionId;
    const winnerIndexes = drawWinners(pool.map((_, index) => index), safeCount);
    const result = winnerIndexes.map(index => pool[index]);
    setWinners([]);
    setCopied(false);
    setShareCopied(false);
    setNotice(safeCount < count ? `候选名单共 ${pool.length} 位，本轮按最多 ${safeCount} 人开奖。` : '');
    setCurrentLabel('');
    setActiveWheelIndex(null);
    setIsDrawing(true);

    if (mode === 'wheel') {
      startWheel(pool, winnerIndexes, result, sessionId);
    } else {
      startRolling(pool, result, sessionId, mode);
    }
  };

  const copyWinners = async () => {
    if (winners.length === 0) return;
    try {
      await navigator.clipboard.writeText(winners.join('\n'));
      setCopied(true);
    } catch {
      setNotice('当前环境不支持自动复制，请手动选择中奖名单。');
    }
  };

  const copyShareText = async () => {
    if (winners.length === 0) return;
    try {
      await navigator.clipboard.writeText(getLotteryShareText(winners, mode, formatTime(new Date())));
      setShareCopied(true);
      setNotice('分享文案已复制，可以直接发给朋友。');
    } catch {
      setNotice('当前环境不支持自动复制，请手动选择中奖名单。');
    }
  };

  const clearHistory = () => setHistory([]);

  const fillSample = () => {
    if (isDrawing) return;
    setNames(SAMPLE_NAMES);
    setNotice('已填入一组示例名单，可以直接试抽。');
  };

  const applyPreset = (presetId: string) => {
    if (isDrawing) return;
    const preset = LOTTERY_PRESETS.find((candidate) => candidate.id === presetId);
    if (!preset) return;
    setNames(preset.entries.join('\n'));
    setCount(preset.count);
    setEliminatedEntries([]);
    setWinners([]);
    setNotice(`已载入「${preset.label}」场景，可以直接开始。`);
  };

  const resetEliminatedEntries = () => {
    if (isDrawing) return;
    setEliminatedEntries([]);
    setNotice('已恢复全部候选人。');
  };

  const clearNames = () => {
    if (isDrawing) return;
    setNames('');
    setWinners([]);
    setEliminatedEntries([]);
    setNotice('');
  };

  return (
    <div className="lottery-tool">
      <header className="lottery-tool__intro">
        <div>
          <p className="lottery-eyebrow"><Sparkles aria-hidden="true" /> 今日的小小幸运</p>
          <h2>把选择交给一点点随机</h2>
          <p className="lottery-tool__description">名单、玩法、抽取人数一次设置好，剩下的交给命运。</p>
        </div>
        <div className="lottery-privacy-note">
          <span className="lottery-privacy-note__dot" aria-hidden="true" />
          <span>名单只在当前浏览器中处理</span>
        </div>
      </header>

      <div className="lottery-mode-picker" role="tablist" aria-label="抽奖方式">
        {MODE_OPTIONS.map(option => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-label={option.name}
            aria-selected={mode === option.id}
            aria-controls={`lottery-panel-${option.id}`}
            disabled={isDrawing}
            className={`lottery-mode-card ${mode === option.id ? 'is-active' : ''}`}
            onClick={() => setMode(option.id)}
          >
            <span className="lottery-mode-card__icon">{option.icon}</span>
            <span className="lottery-mode-card__copy">
              <strong>{option.name}</strong>
              <small>{option.description}</small>
            </span>
            {mode === option.id && <Check className="lottery-mode-card__check" aria-hidden="true" />}
          </button>
        ))}
      </div>

      <div className="lottery-layout">
        <section className="lottery-card lottery-input-card" aria-labelledby="lottery-input-title">
          <div className="lottery-card__heading">
            <div>
              <p className="lottery-eyebrow">01 · 准备名单</p>
              <h3 id="lottery-input-title">候选名单</h3>
            </div>
            <span className="lottery-count-badge"><Users aria-hidden="true" /> {pool.length} 位候选</span>
          </div>

          <label className="sr-only" htmlFor="lottery-names">候选名单</label>
          <textarea
            id="lottery-names"
            value={names}
            onChange={event => setNames(event.target.value)}
            placeholder={'输入名单，每行一个，也支持用逗号分隔\n例如：\n张三\n李四\n王五'}
            rows={9}
            disabled={isDrawing}
          />

          <div className="lottery-input-actions">
            <button type="button" className="lottery-text-button" onClick={fillSample} disabled={isDrawing}>填入示例</button>
            <button type="button" className="lottery-text-button" onClick={clearNames} disabled={isDrawing || names.length === 0}>清空</button>
            <span className="lottery-input-hint">一行一个，空行会自动忽略</span>
          </div>

          <div className="lottery-presets" aria-label="快速场景">
            <span className="lottery-presets__label">快速场景</span>
            {LOTTERY_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="lottery-preset-button"
                onClick={() => applyPreset(preset.id)}
                disabled={isDrawing}
                title={preset.description}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="lottery-options">
            <label className="lottery-number-control">
              <span>抽取人数</span>
              <span className="lottery-number-control__input">
                <input
                  type="number"
                  min={1}
                  max={Math.max(pool.length, 1)}
                  value={count}
                  aria-label="抽取人数"
                  onChange={event => setCount(Number(event.target.value))}
                  disabled={isDrawing}
                />
                <small>人</small>
              </span>
            </label>
            <label className="lottery-switch-control">
              <input
                type="checkbox"
                checked={removeDup}
                aria-label="候选名单去重"
                onChange={event => setRemoveDup(event.target.checked)}
                disabled={isDrawing}
              />
              <span className="lottery-switch" aria-hidden="true"><span /></span>
              <span><strong>候选名单去重</strong><small>同名只保留一次</small></span>
            </label>
            <label className="lottery-switch-control">
              <input
                type="checkbox"
                checked={removeAfterDraw}
                aria-label="中奖后移除"
                onChange={event => setRemoveAfterDraw(event.target.checked)}
                disabled={isDrawing}
              />
              <span className="lottery-switch" aria-hidden="true"><span /></span>
              <span><strong>中奖后移除</strong><small>适合连续抽取不重复</small></span>
            </label>
          </div>

          {eliminatedEntries.length > 0 && removeAfterDraw && (
            <div className="lottery-elimination-note">
              <span>已暂时移除 {eliminatedEntries.length} 位中奖者</span>
              <button type="button" className="lottery-text-button" onClick={resetEliminatedEntries} disabled={isDrawing}>
                <RotateCcw aria-hidden="true" /> 恢复全部
              </button>
            </div>
          )}

          <div className="lottery-action-row">
            <button type="button" className="lottery-primary-button" onClick={startLottery} disabled={isDrawing}>
              <Gift aria-hidden="true" />
              {isDrawing ? '正在开奖…' : mode === 'wheel' ? '开始转盘抽奖' : mode === 'card' ? '开始翻牌抽奖' : '开始滚动开奖'}
            </button>
            <button type="button" className="lottery-quiet-button" onClick={onClose} disabled={isDrawing}>关闭</button>
          </div>
          {notice && <p className="lottery-notice" role="status">{notice}</p>}
        </section>

        <section
          id={`lottery-panel-${mode}`}
          className="lottery-stage-card"
          role="region"
          aria-label={mode === 'wheel' ? '幸运转盘' : mode === 'card' ? '翻牌抽奖' : '滚动开奖'}
          aria-live="polite"
        >
          <div className="lottery-stage-card__topline">
            <div>
              <p className="lottery-eyebrow">02 · {mode === 'wheel' ? '幸运转盘' : mode === 'card' ? '翻牌抽奖' : '滚动开奖'}</p>
              <h3>{isDrawing ? '好运正在靠近…' : winners.length > 0 ? '本轮已经开奖' : '准备好了吗？'}</h3>
            </div>
            <span className="lottery-stage-card__pool"><Clock3 aria-hidden="true" /> {pool.length > 0 ? `候选池 ${pool.length}` : '等待名单'}</span>
          </div>

          {mode === 'wheel' ? (
            <div className="lottery-wheel-stage">
              <div className="lottery-wheel-wrap">
                <div className="lottery-wheel-pointer" aria-hidden="true"><span /></div>
                <div
                  className={`lottery-wheel ${isDrawing ? 'is-spinning' : ''}`}
                  style={{ background: wheelBackground, transform: `rotate(${wheelRotation}deg)` }}
                  role="img"
                  aria-label={pool.length > 0 ? `包含 ${pool.length} 个候选项的转盘` : '空转盘'}
                >
                  {pool.map((item, index) => {
                    const angle = -90 + ((index + 0.5) / Math.max(pool.length, 1)) * 360;
                    const radius = pool.length > 12 ? 36 : 42;
                    return (
                      <span
                        key={`${item}-${index}`}
                        className={`lottery-wheel__label ${activeWheelIndex === index ? 'is-active' : ''}`}
                        style={{ '--label-angle': `${angle}deg`, '--label-radius': `${radius}%` } as React.CSSProperties}
                      >
                        {item}
                      </span>
                    );
                  })}
                  <span className="lottery-wheel__hub">GO</span>
                </div>
              </div>
              <p className="lottery-wheel-stage__caption">转盘会按抽取人数逐次停下</p>
            </div>
          ) : mode === 'card' ? (
            <div className={`lottery-card-stage ${isDrawing ? 'is-drawing' : ''}`}>
              <div className="lottery-card-stage__stack" aria-hidden="true">
                <span /><span /><span />
              </div>
              <div className="lottery-draw-card">
                <span className="lottery-draw-card__label">{isDrawing ? '正在翻开' : winners.length > 0 ? '翻牌结果' : '准备翻牌'}</span>
                <strong>{isDrawing ? currentLabel || '…' : winners[0] || '命运卡片'}</strong>
                <span>{isDrawing ? '下一张好运马上出现' : winners.length > 0 ? `本轮共 ${winners.length} 位` : '输入名单后点击开始'}</span>
              </div>
              <p className="lottery-card-stage__caption">一张张翻开好运，支持连续抽取</p>
            </div>
          ) : (
            <div className={`lottery-rolling-stage ${isDrawing ? 'is-drawing' : ''}`}>
              <div className="lottery-rolling-stage__spark spark-one" aria-hidden="true">✦</div>
              <div className="lottery-rolling-stage__spark spark-two" aria-hidden="true">✧</div>
              <div className="lottery-ticket">
                <span className="lottery-ticket__edge lottery-ticket__edge--left" aria-hidden="true" />
                <span className="lottery-ticket__label">{isDrawing ? '滚动中' : winners.length > 0 ? '中奖结果' : '等待抽取'}</span>
                <strong>{isDrawing ? currentLabel || '…' : winners[0] || '幸运会出现'}</strong>
                <span className="lottery-ticket__sub">{isDrawing ? '保持期待' : winners.length > 0 ? `本轮共 ${winners.length} 位` : '输入名单后点击开始'}</span>
                <span className="lottery-ticket__edge lottery-ticket__edge--right" aria-hidden="true" />
              </div>
            </div>
          )}

          <div className="lottery-stage-card__footer">
            <span><Sparkles aria-hidden="true" /> {isDrawing ? '随机过程正在本地运行' : '每次开奖都会留下记录'}</span>
            {isDrawing && <span className="lottery-loading-dots" aria-hidden="true"><i /><i /><i /></span>}
          </div>
        </section>
      </div>

      {winners.length > 0 && !isDrawing && (
        <section className="lottery-result-card" aria-labelledby="lottery-result-title">
          <div className="lottery-result-card__heading">
            <div className="lottery-result-card__title">
              <span className="lottery-result-card__trophy"><Trophy aria-hidden="true" /></span>
              <div>
                <p className="lottery-eyebrow">03 · 幸运时刻</p>
                <h3 id="lottery-result-title">中奖名单</h3>
              </div>
            </div>
            <div className="lottery-result-card__actions">
              <button type="button" className="lottery-copy-button" onClick={copyWinners}>
                {copied ? <Check aria-hidden="true" /> : <Clipboard aria-hidden="true" />}
                {copied ? '已复制' : '复制名单'}
              </button>
              <button type="button" className="lottery-copy-button" onClick={copyShareText}>
                {shareCopied ? <Check aria-hidden="true" /> : <Share2 aria-hidden="true" />}
                {shareCopied ? '文案已复制' : '复制分享文案'}
              </button>
            </div>
          </div>
          <div className="lottery-winners-grid">
            {winners.map((winner, index) => (
              <div key={`${winner}-${index}`} className={`lottery-winner ${index === 0 ? 'is-first' : ''}`}>
                <span className="lottery-winner__rank">{String(index + 1).padStart(2, '0')}</span>
                <strong>{winner}</strong>
                {index === 0 && <span className="lottery-winner__crown">TOP</span>}
              </div>
            ))}
          </div>
        </section>
      )}

      {history.length > 0 && (
        <section className="lottery-history-card" aria-labelledby="lottery-history-title">
          <div className="lottery-history-card__heading">
            <div className="lottery-history-card__title">
              <History aria-hidden="true" />
              <div>
                <p className="lottery-eyebrow">04 · 回看好运</p>
                <h3 id="lottery-history-title">最近开奖</h3>
              </div>
            </div>
            <button type="button" className="lottery-text-button lottery-text-button--danger" onClick={clearHistory}>
              <Trash2 aria-hidden="true" /> 清空记录
            </button>
          </div>
          <ol className="lottery-history-list">
            {history.map(entry => (
              <li key={entry.id}>
                <span className="lottery-history-list__mode">{entry.mode === 'wheel' ? '转盘' : entry.mode === 'card' ? '翻牌' : '滚动'}</span>
                <time>{entry.time}</time>
                <span className="lottery-history-list__winners">{entry.winners.join('、')}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
};

export default LotteryTool;
