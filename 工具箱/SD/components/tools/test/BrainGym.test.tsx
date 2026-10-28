// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import BrainGym from './BrainGym';

describe('BrainGym', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.useRealTimers();
  });

  it('offers reaction, number memory and sequence memory modes', () => {
    render(<BrainGym onClose={() => undefined} />);

    expect(screen.getByText('脑力挑战台')).toBeTruthy();
    expect(screen.getByRole('tab', { name: '反应速度' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '数字记忆' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '方格序列' })).toBeTruthy();
    expect(screen.getByText('成绩只保存在当前浏览器')).toBeTruthy();
  });

  it('runs a number memory round and records a successful personal best', () => {
    vi.useFakeTimers();
    render(<BrainGym onClose={() => undefined} />);

    fireEvent.click(screen.getByRole('tab', { name: '数字记忆' }));
    fireEvent.click(screen.getByRole('button', { name: /开始数字记忆/ }));

    const value = screen.getByTestId('number-memory-value').textContent ?? '';
    expect(value.length).toBeGreaterThan(0);

    act(() => {
      vi.runOnlyPendingTimers();
    });

    fireEvent.change(screen.getByRole('textbox', { name: '输入刚才看到的数字' }), {
      target: { value },
    });
    fireEvent.click(screen.getByRole('button', { name: '提交答案' }));

    expect(screen.getByText(/答对了/)).toBeTruthy();
    expect(screen.getByText(/本机最佳：/)).toBeTruthy();
  });
});
