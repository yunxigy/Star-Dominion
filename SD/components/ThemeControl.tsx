import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import type { ThemePreference } from '../lib/theme';

const OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string; Icon: typeof Monitor }> = [
  { value: 'system', label: '跟随系统', Icon: Monitor },
  { value: 'light', label: '浅色', Icon: Sun },
  { value: 'dark', label: '深色', Icon: Moon },
];

export const ThemeControl: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { preference, setPreference } = useTheme();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [open]);

  const focusOption = (index: number) => optionRefs.current[(index + OPTIONS.length) % OPTIONS.length]?.focus();

  return (
    <div className="relative" data-theme-control>
      <button
        ref={triggerRef}
        type="button"
        className={`theme-control ${compact ? 'theme-control-compact' : ''}`}
        aria-label={`主题：${OPTIONS.find((option) => option.value === preference)?.label ?? '跟随系统'}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((current) => !current)}
      >
        {preference === 'dark' ? <Moon aria-hidden="true" /> : preference === 'light' ? <Sun aria-hidden="true" /> : <Monitor aria-hidden="true" />}
        {!compact && <span>主题</span>}
        <ChevronDown aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="选择主题"
          className="theme-menu"
          onKeyDown={(event) => {
            const index = optionRefs.current.findIndex((option) => option === document.activeElement);
            if (event.key === 'Escape') {
              event.preventDefault();
              setOpen(false);
              triggerRef.current?.focus();
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              focusOption(index < 0 ? 0 : index + 1);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              focusOption(index < 0 ? OPTIONS.length - 1 : index - 1);
            }
          }}
        >
          {OPTIONS.map(({ value, label, Icon }, index) => (
            <button
              key={value}
              ref={(element) => { optionRefs.current[index] = element; }}
              type="button"
              role="menuitemradio"
              aria-checked={preference === value}
              className="theme-menu-item"
              onClick={() => {
                setPreference(value);
                setOpen(false);
                triggerRef.current?.focus();
              }}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
              {preference === value && <Check aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ThemeControl;
