// @vitest-environment jsdom

import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MiniToolLayout } from './MiniToolLayout';

describe('MiniToolLayout', () => {
  it('renders a compact title bar and the current tool outlet', () => {
    render(
      <MemoryRouter initialEntries={['/tool/json-format']}>
        <Routes>
          <Route element={<MiniToolLayout />}>
            <Route path="/tool/:toolId" element={<h1>JSON 格式化</h1>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: '逐梦工具箱' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '返回工具箱' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'JSON 格式化' })).toBeTruthy();
  });
});
