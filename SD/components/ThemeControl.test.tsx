// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeControl } from './ThemeControl';
import { ThemeProvider } from '../context/ThemeContext';

describe('ThemeControl', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('opens an accessible three-option menu with system selected by default', () => {
    render(<ThemeProvider><ThemeControl /></ThemeProvider>);
    const trigger = screen.getByRole('button', { name: /主题/ });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeTruthy();
    const systemOption = screen.getByRole('menuitemradio', { name: '跟随系统' });
    expect(systemOption.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(systemOption);
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(3);
  });

  it('persists a manual theme selection and closes the menu', () => {
    render(<ThemeProvider><ThemeControl /></ThemeProvider>);
    fireEvent.click(screen.getByRole('button', { name: /主题/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: '深色' }));
    expect(localStorage.getItem('dream-chaser-theme')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('supports Escape and returns focus to the trigger', () => {
    render(<ThemeProvider><ThemeControl /></ThemeProvider>);
    const trigger = screen.getByRole('button', { name: /主题/ });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
