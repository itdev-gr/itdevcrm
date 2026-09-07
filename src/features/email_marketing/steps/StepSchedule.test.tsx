import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import '@/lib/i18n';
import { i18n } from '@/lib/i18n';
import { I18nextProvider } from 'react-i18next';
import type { CampaignRow } from '../hooks/useCampaigns';

const { updateMutate, launchMutateAsync } = vi.hoisted(() => ({
  updateMutate: vi.fn(),
  launchMutateAsync: vi.fn(),
}));

const campaign: CampaignRow = {
  id: 'camp-1',
  name: 'Test campaign',
  status: 'ready',
  identity: 'marketing',
  subject: 'Θέμα',
  preheader: null,
  body_md: 'Κείμενο',
  hero_image_url: null,
  reply_to: 'sales@itdev.gr',
  segment: {},
  daily_cap: null,
  hourly_cap: null,
  send_window_start: '09:00:00',
  send_window_end: '18:00:00',
  send_days: [1, 2, 3, 4, 5],
  scheduled_at: null,
  prepared_at: '2026-09-07T00:00:00Z',
  started_at: null,
  finished_at: null,
  autopause_reason: null,
  created_by: null,
  created_at: '2026-09-07T00:00:00Z',
  updated_at: '2026-09-07T00:00:00Z',
};

let statsPending = 4312;

vi.mock('../hooks/useCampaigns', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useCampaigns')>('../hooks/useCampaigns');
  return {
    ...actual,
    useCampaign: () => ({ data: campaign, isLoading: false }),
    useCampaignStats: () => ({ data: { by_status: { pending: statsPending }, by_suppression_reason: {} }, isLoading: false }),
  };
});
vi.mock('../hooks/useCampaignMutations', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useCampaignMutations')>(
    '../hooks/useCampaignMutations',
  );
  return {
    ...actual,
    useUpdateCampaign: () => ({ mutate: updateMutate, isPending: false }),
    useLaunchCampaign: () => ({ mutateAsync: launchMutateAsync, isPending: false }),
  };
});

import { StepSchedule } from './StepSchedule';

function wrap(node: React.ReactNode) {
  return <I18nextProvider i18n={i18n}>{node}</I18nextProvider>;
}

describe('StepSchedule', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('el');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    statsPending = 4312;
  });

  it('shows the estimated completion date computed from the target count and the daily cap', () => {
    render(wrap(<StepSchedule campaignId="camp-1" />));

    const dailyCap = screen.getByLabelText('Ημερήσιο πλαφόν');
    fireEvent.change(dailyCap, { target: { value: '500' } });

    // 4312 recipients at 500/day = ceil(4312/500) = 9 days, not "done tonight".
    expect(screen.getByText(/Με 500\/ημέρα, η αποστολή ολοκληρώνεται περίπου/)).toBeInTheDocument();
    expect(screen.getByText(/9 ημέρες/)).toBeInTheDocument();
  });

  it('shows "today" when the daily cap comfortably covers the whole target', () => {
    statsPending = 100;
    render(wrap(<StepSchedule campaignId="camp-1" />));

    const dailyCap = screen.getByLabelText('Ημερήσιο πλαφόν');
    fireEvent.change(dailyCap, { target: { value: '500' } });

    expect(screen.getByText('Με 500/ημέρα, η αποστολή ολοκληρώνεται σήμερα.')).toBeInTheDocument();
  });

  it('shows no estimate (not a nonsense date) when there is no target yet', () => {
    statsPending = 0;
    render(wrap(<StepSchedule campaignId="camp-1" />));

    expect(
      screen.getByText('Υπολογίστε πρώτα τους παραλήπτες στο βήμα «Έλεγχος» για να δείτε πότε ολοκληρώνεται η αποστολή.'),
    ).toBeInTheDocument();
  });

  it('the launch confirmation shows the exact recipient count', () => {
    render(wrap(<StepSchedule campaignId="camp-1" />));

    fireEvent.click(screen.getByRole('button', { name: 'Εκκίνηση' }));

    expect(screen.getByText('Θα σταλεί σε 4.312 άτομα. Δεν αναιρείται.')).toBeInTheDocument();
  });

  it('renders a translated explanation when the server refuses the launch', async () => {
    launchMutateAsync.mockRejectedValue(new Error('empty_subject'));
    render(wrap(<StepSchedule campaignId="camp-1" />));

    fireEvent.click(screen.getByRole('button', { name: 'Εκκίνηση' }));
    // Second "Εκκίνηση" button is the confirm dialog's destructive action.
    const buttons = screen.getAllByRole('button', { name: 'Εκκίνηση' });
    fireEvent.click(buttons[buttons.length - 1]!);

    await waitFor(() => expect(launchMutateAsync).toHaveBeenCalledWith('camp-1'));
    expect(
      await screen.findByText('Προσθέστε θέμα στο email πριν την εκκίνηση, στο βήμα «Περιεχόμενο».'),
    ).toBeInTheDocument();
  });
});
