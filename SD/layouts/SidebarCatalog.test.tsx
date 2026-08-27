// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SidebarCatalog } from './SidebarCatalog';

describe('SidebarCatalog', () => {
  afterEach(() => cleanup());

  it('shows category links by default and tool links while searching', () => {
    render(
      <MemoryRouter>
        <SidebarCatalog onNavigate={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: /PDF 工具/ }).getAttribute('href')).toBe('/category/pdf');
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索工具' }), { target: { value: 'JSON 格式化' } });
    expect(screen.getByRole('link', { name: /JSON 格式化/ }).getAttribute('href')).toBe('/tool/json-format');
  });
});
