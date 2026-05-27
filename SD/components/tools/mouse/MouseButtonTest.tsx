import React, { useState, useCallback, useEffect } from 'react';

interface ButtonState {
  id: number;
  name: string;
  pressed: boolean;
  count: number;
}

const INITIAL_BUTTONS: ButtonState[] = [
  { id: 0, name: '左键', pressed: false, count: 0 },
  { id: 1, name: '中键', pressed: false, count: 0 },
  { id: 2, name: '右键', pressed: false, count: 0 },
  { id: 3, name: '侧键后退', pressed: false, count: 0 },
  { id: 4, name: '侧键前进', pressed: false, count: 0 },
];

const MouseButtonTest: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [buttons, setButtons] = useState<ButtonState[]>(INITIAL_BUTTONS);
  const [lastEvent, setLastEvent] = useState('');

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      setButtons(prev => prev.map(b => b.id === e.button ? { ...b, pressed: true, count: b.count + 1 } : b));
      setLastEvent(`按下 ${INITIAL_BUTTONS.find(b => b.id === e.button)?.name || `按钮${e.button}`} (button=${e.button})`);
    };

    const handleMouseUp = (e: MouseEvent) => {
      setButtons(prev => prev.map(b => b.id === e.button ? { ...b, pressed: false } : b));
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('contextmenu', handleContextMenu);

    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('contextmenu', handleContextMenu);
    };
  }, []);

  const reset = useCallback(() => {
    setButtons(INITIAL_BUTTONS);
    setLastEvent('');
  }, []);

  return (
    <div className="space-y-4">
      <div className="text-center">
        <p className="text-slate-400 text-sm">测试鼠标所有按键是否正常工作</p>
      </div>

      {/* Button grid */}
      <div className="grid grid-cols-3 gap-3">
        {buttons.filter(b => b.id <= 2).map(b => (
          <div
            key={b.id}
            className={`h-20 rounded-xl border-2 flex flex-col items-center justify-center transition-all ${
              b.pressed
                ? 'bg-lime-500/30 border-lime-500/50 scale-95'
                : b.count > 0
                ? 'bg-lime-500/10 border-lime-500/20'
                : 'bg-slate-800/50 border-slate-700'
            }`}
          >
            <span className={`text-sm font-medium ${b.pressed ? 'text-lime-400' : b.count > 0 ? 'text-lime-400/60' : 'text-slate-400'}`}>
              {b.name}
            </span>
            <span className="text-xs text-slate-500 mt-1">{b.count} 次</span>
          </div>
        ))}
      </div>

      {/* Side buttons */}
      <div className="grid grid-cols-2 gap-3">
        {buttons.filter(b => b.id >= 3).map(b => (
          <div
            key={b.id}
            className={`h-16 rounded-xl border-2 flex flex-col items-center justify-center transition-all ${
              b.pressed
                ? 'bg-lime-500/30 border-lime-500/50 scale-95'
                : b.count > 0
                ? 'bg-lime-500/10 border-lime-500/20'
                : 'bg-slate-800/50 border-slate-700'
            }`}
          >
            <span className={`text-xs font-medium ${b.pressed ? 'text-lime-400' : b.count > 0 ? 'text-lime-400/60' : 'text-slate-400'}`}>
              {b.name}
            </span>
            <span className="text-[10px] text-slate-500 mt-0.5">{b.count} 次</span>
          </div>
        ))}
      </div>

      {/* Last event */}
      {lastEvent && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-center">
          <p className="text-xs text-slate-500 mb-1">最近事件</p>
          <p className="text-sm text-lime-400 font-mono">{lastEvent}</p>
        </div>
      )}

      <button onClick={reset} className="w-full px-4 py-2 bg-slate-800/50 border border-slate-700 text-slate-400 rounded-lg hover:bg-slate-700/30 transition-all text-sm">
        重置计数
      </button>

      <div className="bg-slate-800/30 border border-slate-700/50 rounded-lg p-3">
        <p className="text-xs text-slate-500">
          提示：侧键（前进/后退）仅在支持额外按键的鼠标上可用。右键菜单已被屏蔽以方便测试。
        </p>
      </div>
    </div>
  );
};

export default MouseButtonTest;
