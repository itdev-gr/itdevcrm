import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { i18n } from '@/lib/i18n';

const clientSearch = vi.fn();
const leadSearch = vi.fn();
vi.mock('@/features/clients/hooks/useClientSearch', () => ({
  useClientSearch: (term: string) => clientSearch(term),
}));
vi.mock('@/features/leads/hooks/useLeadSearch', () => ({
  useLeadSearch: (term: string) => leadSearch(term),
}));

import { ContractPartyPicker } from './ContractPartyPicker';

function wrap(node: React.ReactNode) {
  return <I18nextProvider i18n={i18n}>{node}</I18nextProvider>;
}

describe('ContractPartyPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientSearch.mockReturnValue({ data: [], isFetching: false });
    leadSearch.mockReturnValue({ data: [], isFetching: false });
  });

  it('renders both client and lead results with type badges', async () => {
    const user = userEvent.setup();
    clientSearch.mockReturnValue({
      data: [{ id: 'c1', name: 'ACME', code: '000123', email: 'acme@x.gr', phone: null }],
      isFetching: false,
    });
    leadSearch.mockReturnValue({
      data: [
        { id: 'l1', title: 'Lead guy', company_name: null, code: '006999', email: null, phone: '69' },
      ],
      isFetching: false,
    });
    render(wrap(<ContractPartyPicker value={null} onChange={vi.fn()} />));
    await user.type(screen.getByPlaceholderText(/search client or lead/i), 'ac');
    expect(await screen.findByRole('option', { name: /ACME/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Lead guy/ })).toBeInTheDocument();
  });

  it('selecting a lead calls onChange with a lead party (company/title fallback)', async () => {
    const user = userEvent.setup();
    leadSearch.mockReturnValue({
      data: [
        { id: 'l2', title: 'Ledas', company_name: 'Ledas SA', code: null, email: null, phone: null },
      ],
      isFetching: false,
    });
    const onChange = vi.fn();
    render(wrap(<ContractPartyPicker value={null} onChange={onChange} />));
    await user.type(screen.getByPlaceholderText(/search client or lead/i), 'le');
    await user.click(await screen.findByRole('option', { name: /Ledas SA/ }));
    expect(onChange).toHaveBeenCalledWith({ type: 'lead', id: 'l2', name: 'Ledas SA' });
  });

  it('selecting a client calls onChange with a client party', async () => {
    const user = userEvent.setup();
    clientSearch.mockReturnValue({
      data: [{ id: 'c9', name: 'Pindos', code: '004583', email: null, phone: null }],
      isFetching: false,
    });
    const onChange = vi.fn();
    render(wrap(<ContractPartyPicker value={null} onChange={onChange} />));
    await user.type(screen.getByPlaceholderText(/search client or lead/i), 'pi');
    await user.click(await screen.findByRole('option', { name: /Pindos/ }));
    expect(onChange).toHaveBeenCalledWith({ type: 'client', id: 'c9', name: 'Pindos' });
  });

  it('shows the selected party and clear resets to null', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      wrap(
        <ContractPartyPicker
          value={{ type: 'lead', id: 'l1', name: 'Ledas SA' }}
          onChange={onChange}
        />,
      ),
    );
    expect(screen.getByText('Ledas SA')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /clear/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
