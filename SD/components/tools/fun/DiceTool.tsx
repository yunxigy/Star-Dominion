import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Dices, History, Minus, Plus, Sparkles, Trash2 } from 'lucide-react';

import { DICE_COUNT_LIMIT, DICE_SIDES_LIMIT, getDiceTotal, rollDice } from './dice';

type RollHistory = {
  id: number;
  values: number[];
  sides: number;
  time: string;
};

const ROLL_TICKS = 10;
const ROLL_INTERVAL = 90;

function formatTime(date: Date): string {
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

const DiceTool: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [count, setCount] = useState(2);
  const [sides, setSides] = useState(6);
  const [values, setValues] = useState<number[]>([]);
  const [isRolling, setIsRolling] = useState(false);
  const [history, setHistory] = useState<RollHistory[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const historyIdRef = useRef(0);

  const total = useMemo(() => getDiceTotal(values), [values]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const updateCount = (delta: number) => {
    if (isRolling) return;
    setCount(previous => Math.min(DICE_COUNT_LIMIT, Math.max(1, previous + delta)));
  };

  const updateSides = (delta: number) => {
    if (isRolling) return;
    setSides(previous => Math.min(DICE_SIDES_LIMIT, Math.max(2, previous + delta)));
  };

  const startRoll = () => {
    if (isRolling) return;
    clearTimer();
    setIsRolling(true);
    let tick = 0;
    timerRef.current = setInterval(() => {
      setValues(rollDice(count, sides));
      tick += 1;
      if (tick >= ROLL_TICKS) {
        clearTimer();
        const finalValues = rollDice(count, sides);
        setValues(finalValues);
        setHistory(previous => [
          { id: historyIdRef.current++, values: finalValues, sides, time: formatTime(new Date()) },
          ...previous,
        ].slice(0, 8));
        setIsRolling(false);
      }
    }, ROLL_INTERVAL);
  };

  const clearHistory = () => setHistory([]);

  return (
    <div className="dice-tool">
      <header className="dice-tool__intro">
        <div>
          <p className="dice-eyebrow"><Sparkles aria-hidden="true" /> 小小随机站</p>
          <h2>幸运骰子</h2>
          <p className="dice-tool__description">聚餐谁买单、周末去哪儿，先让骰子替你开个头。</p>
        </div>
        <div className="dice-privacy-note">
          <span className="dice-privacy-note__dot" aria-hidden="true" />
          <span>结果仅保存在当前页面</span>
        </div>
      </header>

      <div className="dice-layout">
        <section className="dice-card dice-settings-card" aria-labelledby="dice-settings-title">
          <div className="dice-card__heading">
            <div>
              <p className="dice-eyebrow">01 · 设置玩法</p>
              <h3 id="dice-settings-title">你想掷几颗？</h3>
            </div>
            <Dices aria-hidden="true" />
          </div>

          <div className="dice-setting-row">
            <div>
              <span className="dice-setting-label">骰子数量</span>
              <small>一次最多 {DICE_COUNT_LIMIT} 颗</small>
            </div>
            <div className="dice-stepper" aria-label="骰子数量控制">
              <button type="button" aria-label="减少骰子数量" onClick={() => updateCount(-1)} disabled={isRolling || count <= 1}><Minus aria-hidden="true" /></button>
              <input type="number" min={1} max={DICE_COUNT_LIMIT} aria-label="骰子数量" value={count} onChange={event => setCount(Math.min(DICE_COUNT_LIMIT, Math.max(1, Number(event.target.value) || 1)))} disabled={isRolling} />
              <button type="button" aria-label="增加骰子数量" onClick={() => updateCount(1)} disabled={isRolling || count >= DICE_COUNT_LIMIT}><Plus aria-hidden="true" /></button>
            </div>
          </div>

          <div className="dice-setting-row">
            <div>
              <span className="dice-setting-label">骰子面数</span>
              <small>从 2 面到 {DICE_SIDES_LIMIT} 面</small>
            </div>
            <div className="dice-stepper" aria-label="骰子面数控制">
              <button type="button" aria-label="减少骰子面数" onClick={() => updateSides(-1)} disabled={isRolling || sides <= 2}><Minus aria-hidden="true" /></button>
              <input type="number" min={2} max={DICE_SIDES_LIMIT} aria-label="骰子面数" value={sides} onChange={event => setSides(Math.min(DICE_SIDES_LIMIT, Math.max(2, Number(event.target.value) || 2)))} disabled={isRolling} />
              <button type="button" aria-label="增加骰子面数" onClick={() => updateSides(1)} disabled={isRolling || sides >= DICE_SIDES_LIMIT}><Plus aria-hidden="true" /></button>
            </div>
          </div>

          <div className="dice-action-row">
            <button type="button" className="dice-primary-button" onClick={startRoll} disabled={isRolling}>
              <Dices aria-hidden="true" />
              {isRolling ? '摇啊摇…' : '掷骰子'}
            </button>
            <button type="button" className="dice-quiet-button" onClick={onClose} disabled={isRolling}>关闭</button>
          </div>
        </section>

        <section className={`dice-card dice-result-card ${isRolling ? 'is-rolling' : ''}`} aria-live="polite" aria-labelledby="dice-result-title">
          <div className="dice-card__heading">
            <div>
              <p className="dice-eyebrow">02 · 看结果</p>
              <h3 id="dice-result-title">{isRolling ? '骰子正在翻滚…' : values.length > 0 ? '落定！' : '还没有结果'}</h3>
            </div>
            {values.length > 0 && !isRolling && <span className="dice-total-label">总点数 <strong>{total}</strong></span>}
          </div>

          <div className="dice-board">
            {(values.length > 0 ? values : Array.from({ length: count }, () => 0)).map((value, index) => (
              <div key={index} className={`dice-face ${value === 0 ? 'is-empty' : ''}`} aria-label={value === 0 ? `第${index + 1}颗骰子，等待结果` : `第${index + 1}颗骰子：${value}点`}>
                <span>{value || '?'}</span>
                <small>第 {index + 1} 颗</small>
              </div>
            ))}
          </div>

          {values.length > 0 && !isRolling ? (
            <div className="dice-result-banner">
              <span><Check aria-hidden="true" /> 本次合计</span>
              <strong>{total}<small>点</small></strong>
            </div>
          ) : (
            <p className="dice-result-hint">选择参数后按下按钮，看看今天的随机答案。</p>
          )}
        </section>
      </div>

      {history.length > 0 && (
        <section className="dice-history-card" aria-labelledby="dice-history-title">
          <div className="dice-history-card__heading">
            <div className="dice-history-card__title">
              <History aria-hidden="true" />
              <div>
                <p className="dice-eyebrow">03 · 回看记录</p>
                <h3 id="dice-history-title">最近几次</h3>
              </div>
            </div>
            <button type="button" className="dice-text-button dice-text-button--danger" onClick={clearHistory}><Trash2 aria-hidden="true" /> 清空记录</button>
          </div>
          <ol className="dice-history-list">
            {history.map(entry => (
              <li key={entry.id}>
                <time>{entry.time}</time>
                <span>{entry.values.join(' · ')}</span>
                <strong>{getDiceTotal(entry.values)} 点</strong>
                <small>D{entry.sides}</small>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
};

export default DiceTool;
