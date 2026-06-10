import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import { TechBoardDocsPage } from './TechBoardDocsPage';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/tech/:serviceType/docs" element={<TechBoardDocsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('TechBoardDocsPage', () => {
  it('renders the Local SEO board documentation from docs/boards', () => {
    renderAt('/tech/local-seo/docs');
    expect(screen.getByRole('heading', { level: 1, name: /Local SEO board/ })).toBeInTheDocument();
    // Stage table content from the markdown renders.
    expect(screen.getByText('Νέο Έργο')).toBeInTheDocument();
    expect(screen.getByText(/Virtual column — not a real stage/)).toBeInTheDocument();
  });

  it('shows a friendly empty state for boards without a doc', () => {
    renderAt('/tech/unknown-board/docs');
    expect(screen.getByText(/No documentation for this board yet/)).toBeInTheDocument();
  });
});
