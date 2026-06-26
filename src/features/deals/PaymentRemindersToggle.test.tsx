import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Supabase chain: supabase.from('deals').update({...}).eq('id', dealId) -> { error: null }
// vi.hoisted so the fns exist when the (hoisted) vi.mock factory runs.
const { from, update, eq } = vi.hoisted(() => {
  const eq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  return { from, update, eq };
});
vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { resolvedLanguage: 'en' },
  }),
}));

import { PaymentRemindersToggle } from './PaymentRemindersToggle';

function renderToggle(props: { initial: boolean; canEdit: boolean }) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <PaymentRemindersToggle dealId="deal-1" initial={props.initial} canEdit={props.canEdit} />
    </QueryClientProvider>,
  );
}

describe('PaymentRemindersToggle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the label + hint and reflects the initial OFF state', () => {
    renderToggle({ initial: false, canEdit: true });
    expect(screen.getByText('reminders.suppress_label')).toBeInTheDocument();
    expect(screen.getByText('reminders.suppress_hint')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('reflects the initial ON state', () => {
    renderToggle({ initial: true, canEdit: true });
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('is disabled when the user cannot edit (read-only for non-billing users)', () => {
    renderToggle({ initial: false, canEdit: false });
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });

  it('saves the new value when an editor toggles it ON', async () => {
    const user = userEvent.setup();
    renderToggle({ initial: false, canEdit: true });
    await user.click(screen.getByRole('checkbox'));
    await waitFor(
      () => expect(update).toHaveBeenCalledWith({ suppress_payment_reminders: true }),
      { timeout: 2000 },
    );
    expect(from).toHaveBeenCalledWith('deals');
    expect(eq).toHaveBeenCalledWith('id', 'deal-1');
  });
});
