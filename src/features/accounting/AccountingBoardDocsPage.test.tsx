import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AccountingBoardDocsPage } from './AccountingBoardDocsPage';

describe('AccountingBoardDocsPage', () => {
  it('renders the accounting documentation from docs/boards/accounting.md', () => {
    render(<AccountingBoardDocsPage />);
    expect(screen.getByRole('heading', { level: 1, name: /^Accounting$/ })).toBeInTheDocument();
    // A stage label from the onboarding board table renders.
    expect(screen.getByText('Πλήρως Εξοφλημένο')).toBeInTheDocument();
  });
});
