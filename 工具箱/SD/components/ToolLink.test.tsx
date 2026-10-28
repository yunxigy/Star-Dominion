// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { recordToolUse } = vi.hoisted(() => ({ recordToolUse: vi.fn() }));

vi.mock('../lib/userTools', () => ({ recordToolUse }));

import { ToolLink } from './ToolLink';

describe('ToolLink', () => {
  afterEach(() => cleanup());
  beforeEach(() => recordToolUse.mockClear());

  it('renders a crawlable same-tab href and records ordinary clicks', () => {
    render(
      <MemoryRouter>
        <ToolLink toolId="merge-pdf" onClick={event => event.preventDefault()}>PDF 合并</ToolLink>
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: 'PDF 合并' });
    expect(link.getAttribute('href')).toBe('/tool/merge-pdf');
    expect(link.hasAttribute('target')).toBe(false);
    fireEvent.click(link);
    expect(recordToolUse).toHaveBeenCalledWith('merge-pdf');
  });

});
