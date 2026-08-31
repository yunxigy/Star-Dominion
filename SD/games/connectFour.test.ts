import { describe, expect, it } from 'vitest';

import {
  applyConnectFourMove,
  createConnectFourState,
  getConnectFourLegalColumns,
  type ConnectFourState,
} from './connectFour';

describe('connect-four rules', () => {
  it('starts with a 7 by 6 board and red to move', () => {
    expect(createConnectFourState()).toEqual({
      board: Array(42).fill(null),
      currentPlayer: 'red',
      status: 'playing',
      winner: null,
      winningLine: [],
    });
  });

  it('drops pieces to the bottom and stacks them in a column', () => {
    let state = createConnectFourState();
    state = applyConnectFourMove(state, 3);
    state = applyConnectFourMove(state, 3);

    expect(state.board[38]).toBe('red');
    expect(state.board[31]).toBe('yellow');
    expect(state.currentPlayer).toBe('red');
    expect(getConnectFourLegalColumns(state)).toHaveLength(7);
  });

  it('detects a horizontal four and records its cells', () => {
    let state = createConnectFourState();
    for (const column of [0, 6, 1, 6, 2, 6, 3]) {
      state = applyConnectFourMove(state, column);
    }

    expect(state.status).toBe('won');
    expect(state.winner).toBe('red');
    expect(state.winningLine).toEqual([35, 36, 37, 38]);
    expect(getConnectFourLegalColumns(state)).toEqual([]);
  });

  it('detects a vertical four', () => {
    let state = createConnectFourState();
    for (const column of [0, 1, 0, 1, 0, 1, 0]) {
      state = applyConnectFourMove(state, column);
    }

    expect(state.status).toBe('won');
    expect(state.winner).toBe('red');
    expect(state.winningLine).toEqual([14, 21, 28, 35]);
  });

  it('rejects invalid columns, full columns, and moves after the game ends', () => {
    let state = createConnectFourState();
    expect(() => applyConnectFourMove(state, -1)).toThrow('非法落子');
    expect(() => applyConnectFourMove(state, 7)).toThrow('非法落子');

    for (const column of [0, 1, 0, 1, 0, 1, 0]) {
      state = applyConnectFourMove(state, column);
    }
    expect(() => applyConnectFourMove(state, 0)).toThrow('对局已结束');

    const fullColumn: ConnectFourState = {
      ...createConnectFourState(),
      board: createConnectFourState().board.map((cell, index) => {
        if (index % 7 === 1) return Math.floor(index / 7) % 2 === 0 ? 'red' : 'yellow';
        return cell;
      }),
    };
    expect(() => applyConnectFourMove(fullColumn, 1)).toThrow('该列已满');
  });
});
