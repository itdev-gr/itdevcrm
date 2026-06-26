import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const renderMock = vi.fn().mockResolvedValue({ svg: '<svg data-testid="m-svg"></svg>' });
const initialize = vi.fn();
vi.mock('mermaid', () => ({ default: { initialize, render: renderMock } }));
vi.mock('@/lib/stores/themeStore', () => ({
  useThemeStore: (sel: (s: unknown) => unknown) => sel({ mode: 'dark' }),
}));

import { MermaidDiagram } from './MermaidDiagram';

describe('MermaidDiagram', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.classList.remove('dark');
  });

  it('renders the mermaid SVG', async () => {
    render(<MermaidDiagram chart={'graph TD; A-->B'} />);
    await waitFor(() => expect(screen.getByTestId('m-svg')).toBeInTheDocument());
  });

  it('uses the dark mermaid theme when <html> has the dark class', async () => {
    document.documentElement.classList.add('dark');
    render(<MermaidDiagram chart={'graph TD; A-->B'} />);
    await waitFor(() =>
      expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark' })),
    );
  });
});
