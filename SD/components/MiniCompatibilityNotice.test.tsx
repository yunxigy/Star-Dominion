// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MiniCompatibilityNotice } from './MiniCompatibilityNotice';

describe('MiniCompatibilityNotice', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/?mini=1');
  });

  afterEach(() => {
    cleanup();
    window.history.pushState({}, '', '/');
    window.sessionStorage.clear();
  });

  it('explains mouse-tool limitations in mini mode', () => {
    render(<MiniCompatibilityNotice toolId="cps-test" />);

    expect(screen.getByRole('note').textContent).toContain('手机触控');
  });

  it('does not render for ordinary tools', () => {
    render(<MiniCompatibilityNotice toolId="json-format" />);

    expect(screen.queryByRole('note')).toBeNull();
  });
});
