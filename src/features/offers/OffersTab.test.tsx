import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mutateAsync = vi.fn(() => Promise.resolve('https://signed.example/offer.pdf'));
vi.mock('./hooks/useDownloadOfferPdf', () => ({
  useDownloadOfferPdf: () => ({ mutateAsync, isPending: false }),
}));

const offers = [
  {
    id: 'off-1',
    offer_number: 'OFF-0001',
    status: 'sent',
    totals: { total: 100 },
    created_at: '2026-07-01T00:00:00Z',
  },
];
vi.mock('./hooks/useOffersForLeadOrDeal', () => ({
  useOffersForLead: () => ({ data: [], isLoading: false }),
  useOffersForDeal: () => ({ data: offers, isLoading: false }),
  useOffersForClient: () => ({ data: [], isLoading: false }),
}));

import { OffersTab } from './OffersTab';

beforeEach(() => {
  mutateAsync.mockClear();
  vi.spyOn(window, 'open').mockReturnValue({
    document: { write: vi.fn() },
    location: { href: '' },
    close: vi.fn(),
  } as unknown as Window);
});

describe('OffersTab', () => {
  it('renders the offer row with a View link', () => {
    render(<OffersTab dealId="deal-1" />, { wrapper: MemoryRouter });
    expect(screen.getByText(/OFF-0001/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View →' })).toHaveAttribute('href', '/offers/off-1');
  });

  it('downloads the PDF for the clicked row', () => {
    render(<OffersTab dealId="deal-1" />, { wrapper: MemoryRouter });
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
    expect(mutateAsync).toHaveBeenCalledWith('off-1');
  });
});
