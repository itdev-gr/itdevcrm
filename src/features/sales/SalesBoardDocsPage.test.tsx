import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SalesBoardDocsPage } from './SalesBoardDocsPage';

describe('SalesBoardDocsPage', () => {
  it('renders the sales pipeline documentation from docs/boards/sales.md', () => {
    render(<SalesBoardDocsPage />);
    expect(
      screen.getByRole('heading', { level: 1, name: /Sales pipeline/ }),
    ).toBeInTheDocument();
    // A stage label from the markdown table renders.
    expect(screen.getByText('Κερδισμένο')).toBeInTheDocument();
  });
});
