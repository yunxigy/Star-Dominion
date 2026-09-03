// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import LotteryTool from './LotteryTool';

describe('LotteryTool', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.useRealTimers();
  });

  it('offers switchable lottery modes and shows local privacy guidance', () => {
    render(<LotteryTool onClose={() => undefined} />);

    expect(screen.getByRole('tab', { name: '滚动开奖' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '幸运转盘' })).toBeTruthy();
    expect(screen.getByText('名单只在当前浏览器中处理')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: '幸运转盘' }));

    expect(screen.getByRole('region', { name: '幸运转盘' })).toBeTruthy();
    expect(screen.getByText('转盘会按抽取人数逐次停下')).toBeTruthy();
  });

  it('offers a card reveal mode and ready-made scene presets', () => {
    render(<LotteryTool onClose={() => undefined} />);

    expect(screen.getByRole('tab', { name: '翻牌抽奖' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '课堂点名' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '聚会游戏' })).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: '翻牌抽奖' }));

    expect(screen.getByRole('region', { name: '翻牌抽奖' })).toBeTruthy();
    expect(screen.getByText('一张张翻开好运')).toBeTruthy();
  });

  it('can remove winners from the pool for subsequent rounds', () => {
    vi.useFakeTimers();
    render(<LotteryTool onClose={() => undefined} />);

    fireEvent.change(screen.getByRole('textbox', { name: '候选名单' }), { target: { value: '张三\n李四\n王五' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '中奖后移除' }));
    fireEvent.click(screen.getByRole('button', { name: '开始滚动开奖' }));

    act(() => {
      vi.runAllTimers();
    });

    expect(screen.getByText('候选池 2')).toBeTruthy();
    expect(screen.getByText('中奖后移除')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '开始滚动开奖' }));
    act(() => {
      vi.runAllTimers();
    });

    expect(screen.getByText('最近开奖')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('draws a winner and keeps the result visible after the animation', () => {
    vi.useFakeTimers();
    render(<LotteryTool onClose={() => undefined} />);

    fireEvent.change(screen.getByRole('textbox', { name: '候选名单' }), { target: { value: '张三\n李四\n王五' } });
    fireEvent.click(screen.getByRole('button', { name: '开始滚动开奖' }));

    act(() => {
      vi.runAllTimers();
    });

    expect(screen.getByText('中奖名单')).toBeTruthy();
    expect(screen.getByRole('region', { name: '中奖名单' })).toBeTruthy();
  });
});
