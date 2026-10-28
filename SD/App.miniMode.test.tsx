// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from './App';

describe('App mini mode routing', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.history.pushState({}, '', '/wuwa?mini=1');
  });

  afterEach(() => {
    cleanup();
    window.history.pushState({}, '', '/');
    window.sessionStorage.clear();
  });

  it('redirects a personal project route to the mini tool home', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { name: '工具箱' })).toBeTruthy();
    expect(screen.queryByText('AI 伴侣')).toBeNull();
  });
});
