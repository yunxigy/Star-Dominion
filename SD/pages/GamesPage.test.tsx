// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { GamesPage } from './GamesPage';

describe('GamesPage', () => {
  afterEach(() => cleanup());

  it('lists the first game with a crawlable route', () => {
    render(
      <MemoryRouter>
        <GamesPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: '趣味游戏' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /井字棋/ }).getAttribute('href')).toBe('/games/tic-tac-toe');
    expect(screen.getByRole('link', { name: /四子棋/ }).getAttribute('href')).toBe('/games/connect-four');
    expect(screen.getByRole('link', { name: /五子棋/ }).getAttribute('href')).toBe('/games/gomoku');
    expect(screen.getByRole('link', { name: /黑白棋/ }).getAttribute('href')).toBe('/games/othello');
    expect(screen.getByRole('link', { name: /国际象棋/ }).getAttribute('href')).toBe('/games/chess');
    expect(screen.getByRole('link', { name: /中国象棋/ }).getAttribute('href')).toBe('/games/xiangqi');
    expect(screen.getByRole('link', { name: /跳棋/ }).getAttribute('href')).toBe('/games/checkers');
  });
});
