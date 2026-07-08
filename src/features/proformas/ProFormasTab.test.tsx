import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mutateAsync = vi.fn(() => Promise.resolve('https://signed.example/proforma.pdf'));
vi.mock('./hooks/useDownloadProFormaPdf', () => ({
  useDownloadProFormaPdf: () => ({ mutateAsync, isPending: false }),
}));

const proFormas = [
  {
    id: 'prf-1',
    pro_forma_number: 'PRF-0001',
    status: 'draft',
    totals: { total: 80 },
    created_at: '2026-07-01T00:00:00Z',
  },
];
vi.mock('./hooks/useProFormasForLeadOrDeal', () => ({
  useProFormasForLead: () => ({ data: [], isLoading: false }),
  useProFormasForDeal: () => ({ data: proFormas, isLoading: false }),
}));

import { ProFormasTab } from './ProFormasTab';

beforeEach(() => {
  mutateAsync.mockClear();
  vi.spyOn(window, 'open').mockReturnValue({
    document: { write: vi.fn() },
    location: { href: '' },
    close: vi.fn(),
  } as unknown as Window);
});

describe('ProFormasTab', () => {
  it('renders the pro forma row with a View link', () => {
    render(<ProFormasTab dealId="deal-1" />, { wrapper: MemoryRouter });
    expect(screen.getByText(/PRF-0001/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View →' })).toHaveAttribute('href', '/proformas/prf-1');
  });

  it('downloads the PDF for the clicked row', () => {
    render(<ProFormasTab dealId="deal-1" />, { wrapper: MemoryRouter });
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
    expect(mutateAsync).toHaveBeenCalledWith('prf-1');
  });
});
