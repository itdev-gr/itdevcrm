import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { i18n } from '@/lib/i18n';

const search = vi.fn();
vi.mock('./hooks/useClientSearch', () => ({
  useClientSearch: (term: string) => search(term),
}));

import { ClientPicker } from './ClientPicker';

function wrap(node: React.ReactNode) {
  return <I18nextProvider i18n={i18n}>{node}</I18nextProvider>;
}

describe('ClientPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    search.mockReturnValue({ data: [], isFetching: false });
  });

  it('shows the selected client name and a clear button', () => {
    const onChange = vi.fn();
    render(wrap(<ClientPicker value={{ id: 'c1', name: 'ACME' }} onChange={onChange} />));
    expect(screen.getByText('ACME')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
  });

  it('selecting a result calls onChange with the client', async () => {
    const user = userEvent.setup();
    search.mockReturnValue({ data: [{ id: 'c9', name: 'Pindos', code: '004583' }], isFetching: false });
    const onChange = vi.fn();
    render(wrap(<ClientPicker value={null} onChange={onChange} />));
    await user.type(screen.getByPlaceholderText(/search client/i), 'pi');
    expect(await screen.findByRole('option', { name: /Pindos/ })).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: /Pindos/ }));
    expect(onChange).toHaveBeenCalledWith({ id: 'c9', name: 'Pindos' });
  });

  it('clear resets to null', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(wrap(<ClientPicker value={{ id: 'c1', name: 'ACME' }} onChange={onChange} />));
    await user.click(screen.getByRole('button', { name: /clear/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
