// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { GamePage } from './GamePage';

describe('GamePage', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders the tic-tac-toe board and supports local two-player moves', () => {
    render(
      <MemoryRouter initialEntries={['/games/tic-tac-toe']}>
        <Routes>
          <Route path="/games/:gameId" element={<GamePage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: '井字棋' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /第[123]行第[123]列，空位/ })).toHaveLength(9);

    fireEvent.click(screen.getByRole('button', { name: '双人同屏' }));
    fireEvent.click(screen.getByRole('button', { name: '第1行第1列，空位' }));

    expect(screen.getByRole('button', { name: '第1行第1列，X' })).toBeTruthy();
    expect(screen.getByText(/O 方回合/)).toBeTruthy();
  });

  it('lets the AI respond locally after the human moves', () => {
    vi.useFakeTimers();
    render(
      <MemoryRouter initialEntries={['/games/tic-tac-toe']}>
        <Routes>
          <Route path="/games/:gameId" element={<GamePage />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: '第1行第1列，空位' }));
    expect(screen.getByText('O 方思考中…')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.getByRole('button', { name: '第2行第2列，O' })).toBeTruthy();
  });

  it('renders the connect-four board and supports local two-player moves', () => {
    render(
      <MemoryRouter initialEntries={['/games/connect-four']}>
        <Routes>
          <Route path="/games/:gameId" element={<GamePage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: '四子棋' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /第[1-6]行第[1-7]列，空位/ })).toHaveLength(42);

    fireEvent.click(screen.getByRole('button', { name: '双人同屏' }));
    fireEvent.click(screen.getByRole('button', { name: '第6行第1列，空位' }));

    expect(screen.getByRole('button', { name: '第6行第1列，红方' })).toBeTruthy();
    expect(screen.getByText(/黄方回合/)).toBeTruthy();
  });

  it('renders the gomoku board and supports local two-player moves', () => {
    render(
      <MemoryRouter initialEntries={['/games/gomoku']}>
        <Routes>
          <Route path="/games/:gameId" element={<GamePage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: '五子棋' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /第[1-9][0-9]*行第[1-9][0-9]*列，空位/ })).toHaveLength(225);

    fireEvent.click(screen.getByRole('button', { name: '双人同屏' }));
    fireEvent.click(screen.getByRole('button', { name: '第8行第8列，空位' }));

    expect(screen.getByRole('button', { name: '第8行第8列，黑方' })).toBeTruthy();
    expect(screen.getByText(/白方回合/)).toBeTruthy();
  });

  it('renders the othello board and supports local two-player moves', () => {
    render(
      <MemoryRouter initialEntries={['/games/othello']}>
        <Routes>
          <Route path="/games/:gameId" element={<GamePage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: '黑白棋' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /第[1-8]行第[1-8]列/ })).toHaveLength(64);

    fireEvent.click(screen.getByRole('button', { name: '双人同屏' }));
    fireEvent.click(screen.getByRole('button', { name: '第3行第4列，空位' }));

    expect(screen.getByRole('button', { name: '第3行第4列，黑方' })).toBeTruthy();
    expect(screen.getByText(/白方回合/)).toBeTruthy();
  });

  it('renders the chess board and supports selecting a local move', () => {
    render(
      <MemoryRouter initialEntries={['/games/chess']}>
        <Routes>
          <Route path="/games/:gameId" element={<GamePage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: '国际象棋' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /第[1-8]行第[1-8]列/ })).toHaveLength(64);

    fireEvent.click(screen.getByRole('button', { name: '双人同屏' }));
    fireEvent.click(screen.getByRole('button', { name: '第7行第1列，白方兵' }));
    fireEvent.click(screen.getByRole('button', { name: '第6行第1列，空位' }));

    expect(screen.getByRole('button', { name: '第6行第1列，白方兵' })).toBeTruthy();
    expect(screen.getByText(/黑方回合/)).toBeTruthy();
  });

  it('renders the xiangqi board and supports selecting a local move', () => {
    render(
      <MemoryRouter initialEntries={['/games/xiangqi']}>
        <Routes>
          <Route path="/games/:gameId" element={<GamePage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: '中国象棋' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /第(?:[1-9]|10)行第[1-9]列/ })).toHaveLength(90);

    fireEvent.click(screen.getByRole('button', { name: '双人同屏' }));
    fireEvent.click(screen.getByRole('button', { name: '第10行第2列，红方马' }));
    fireEvent.click(screen.getByRole('button', { name: '第8行第3列，空位' }));

    expect(screen.getByRole('button', { name: '第8行第3列，红方马' })).toBeTruthy();
    expect(screen.getByText(/黑方回合/)).toBeTruthy();
  });

  it('renders the checkers board and supports selecting a local move', () => {
    render(
      <MemoryRouter initialEntries={['/games/checkers']}>
        <Routes>
          <Route path="/games/:gameId" element={<GamePage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: '跳棋' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /第[1-8]行第[1-8]列/ })).toHaveLength(64);

    fireEvent.click(screen.getByRole('button', { name: '双人同屏' }));
    fireEvent.click(screen.getByRole('button', { name: '第3行第2列，黑方兵' }));
    fireEvent.click(screen.getByRole('button', { name: '第4行第1列，空位' }));

    expect(screen.getByRole('button', { name: '第4行第1列，黑方兵' })).toBeTruthy();
    expect(screen.getByText(/红方回合/)).toBeTruthy();
  });
});
