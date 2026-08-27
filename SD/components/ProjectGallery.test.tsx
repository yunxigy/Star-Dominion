// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PROJECT_LINKS } from '../lib/projectLinks';
import { ProjectGallery } from './ProjectGallery';

describe('ProjectGallery', () => {
  it('renders every project once and requests login for protected projects', () => {
    const onAuthRequired = vi.fn();
    render(
      <MemoryRouter>
        <ProjectGallery authenticated={false} authLoading={false} onAuthRequired={onAuthRequired} />
      </MemoryRouter>,
    );

    expect(screen.getAllByRole('link')).toHaveLength(PROJECT_LINKS.length);
    fireEvent.click(screen.getByRole('link', { name: /股票研究/ }));
    expect(onAuthRequired).toHaveBeenCalledWith('/stock/');
  });
});
