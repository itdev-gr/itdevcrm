import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/lib/i18n';

const mutateAsync = vi.fn(() => Promise.resolve('https://signed.example/contract.pdf'));
vi.mock('./hooks/useDownloadContractPdf', () => ({
  useDownloadContractPdf: () => ({ mutateAsync, isPending: false }),
}));

const contracts = [
  {
    id: 'ctr-1',
    contract_number: 'CTR-202607-0001',
    title: 'Web dev contract',
    status: 'signed',
    created_at: '2026-07-01T00:00:00Z',
  },
];
vi.mock('./hooks/useContracts', () => ({
  useContractsForClient: () => ({ data: contracts, isLoading: false, error: null }),
}));

import { ContractsTab } from './ContractsTab';

beforeEach(() => {
  mutateAsync.mockClear();
  vi.spyOn(window, 'open').mockReturnValue({
    document: { write: vi.fn() },
    location: { href: '' },
    close: vi.fn(),
  } as unknown as Window);
});

describe('ContractsTab', () => {
  it('renders the contract row and keeps the new-contract link', () => {
    render(<ContractsTab clientId="cli-1" />, { wrapper: MemoryRouter });
    expect(screen.getByText(/CTR-202607-0001/)).toBeInTheDocument();
    const links = screen.getAllByRole('link');
    expect(links.some((l) => l.getAttribute('href') === '/contracts/new?clientId=cli-1')).toBe(true);
    expect(links.some((l) => l.getAttribute('href') === '/contracts/ctr-1')).toBe(true);
  });

  it('downloads the PDF for the clicked row', () => {
    render(<ContractsTab clientId="cli-1" />, { wrapper: MemoryRouter });
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
    expect(mutateAsync).toHaveBeenCalledWith('ctr-1');
  });
});
