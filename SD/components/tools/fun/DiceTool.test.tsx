// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DiceTool from './DiceTool';

describe('DiceTool', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders dice controls and a local-only privacy note', () => {
    render(<DiceTool onClose={() => undefined} />);

    expect(screen.getByRole('heading', { name: '幸运骰子' })).toBeTruthy();
    expect(screen.getByLabelText('骰子数量')).toBeTruthy();
    expect(screen.getByLabelText('骰子面数')).toBeTruthy();
    expect(screen.getByText('结果仅保存在当前页面')).toBeTruthy();
  });

  it('shows the total after rolling', () => {
    vi.useFakeTimers();
    render(<DiceTool onClose={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: '掷骰子' }));
    act(() => {
      vi.runAllTimers();
    });

    expect(screen.getByText('总点数')).toBeTruthy();
    expect(screen.getByText('本次合计')).toBeTruthy();
  });
});
