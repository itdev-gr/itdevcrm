import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { i18n } from '@/lib/i18n';

const search = vi.fn();
const title = vi.fn();
vi.mock('./hooks/useLeadSearch', () => ({
  useLeadSearch: (term: string) => search(term),
  useLeadTitle: (id: string | null) => title(id),
}));

import { LeadPicker } from './LeadPicker';

function wrap(node: React.ReactNode) {
  return <I18nextProvider i18n={i18n}>{node}</I18nextProvider>;
}

describe('LeadPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    search.mockReturnValue({ data: [], isFetching: false });
    title.mockReturnValue({ data: null });
  });

  it('shows the selected lead name and a clear button', () => {
    const onChange = vi.fn();
    render(wrap(<LeadPicker value={{ id: 'l1', name: 'Bakery Lead' }} onChange={onChange} />));
    expect(screen.getByText('Bakery Lead')).toBeTruthy();
    expect(screen.getByRole('button', { name: /clear/i })).toBeTruthy();
  });

  it('fetches the title when the value has an empty name (edit mode)', () => {
    title.mockReturnValue({ data: 'Fetched Lead' });
    render(wrap(<LeadPicker value={{ id: 'l1', name: '' }} onChange={vi.fn()} />));
    expect(title).toHaveBeenCalledWith('l1');
    expect(screen.getByText('Fetched Lead')).toBeTruthy();
  });

  it('selecting a result calls onChange with the lead', async () => {
    const user = userEvent.setup();
    search.mockReturnValue({ data: [{ id: 'l9', title: 'Taverna', code: '001234', company_name: null }], isFetching: false });
    const onChange = vi.fn();
    render(wrap(<LeadPicker value={null} onChange={onChange} />));
    await user.type(screen.getByPlaceholderText(/search lead/i), 'ta');
    expect(await screen.findByRole('option', { name: /Taverna/ })).toBeTruthy();
    await user.click(screen.getByRole('option', { name: /Taverna/ }));
    expect(onChange).toHaveBeenCalledWith({ id: 'l9', name: 'Taverna' });
  });

  it('clear resets to null', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(wrap(<LeadPicker value={{ id: 'l1', name: 'Bakery Lead' }} onChange={onChange} />));
    await user.click(screen.getByRole('button', { name: /clear/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
