// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScrollToTop } from './ScrollToTop';

describe('ScrollToTop', () => {
  const scrollTo = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('scrollTo', scrollTo);
    scrollTo.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('returns the viewport to the top after a sidebar route change', () => {
    function RouteLink() {
      const navigate = useNavigate();
      return <button type="button" onClick={() => navigate('/tool/image-compress')}>打开工具</button>;
    }

    render(
      <MemoryRouter initialEntries={['/category/image']}>
        <ScrollToTop />
        <Routes>
          <Route path="/category/image" element={<RouteLink />} />
          <Route path="/tool/:toolId" element={<div>工具页面</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' });
    scrollTo.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '打开工具' }));
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' });
  });
});
