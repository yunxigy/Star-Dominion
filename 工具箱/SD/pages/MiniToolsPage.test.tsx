// @vitest-environment jsdom

import { MemoryRouter } from 'react-router-dom';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MiniToolsPage } from './MiniToolsPage';

describe('MiniToolsPage', () => {
  afterEach(() => cleanup());

  it('shows search, categories, and tool entries without personal project content', () => {
    render(
      <MemoryRouter>
        <MiniToolsPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: '工具箱' })).toBeTruthy();
    expect(screen.getByRole('searchbox', { name: '搜索工具' })).toBeTruthy();
    expect(screen.getByText('PDF 工具')).toBeTruthy();
    expect(screen.getByRole('link', { name: /打开 JSON 格式化/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /股票研究/ })).toBeNull();
    expect(screen.getByRole('link', { name: /趣味游戏/ })).toBeTruthy();
    expect(screen.queryByText('研报中心')).toBeNull();
    expect(screen.queryByText('个人项目')).toBeNull();
  });

  it('filters the tool list by search text', async () => {
    const userEvent = (await import('@testing-library/user-event')).default;
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <MiniToolsPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByRole('searchbox', { name: '搜索工具' }), 'JSON');

    expect(screen.getByRole('link', { name: /打开 JSON 格式化/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /打开 BMI/ })).toBeNull();
  });
});
