import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import '@/lib/i18n';
import { i18n } from '@/lib/i18n';
import { I18nextProvider } from 'react-i18next';

const { buildMutateAsync, testSendMutateAsync } = vi.hoisted(() => ({
  buildMutateAsync: vi.fn(),
  testSendMutateAsync: vi.fn(),
}));

let statsData: { by_status: Record<string, number>; by_suppression_reason: Record<string, number> } | undefined =
  undefined;

vi.mock('../hooks/useCampaigns', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useCampaigns')>('../hooks/useCampaigns');
  return {
    ...actual,
    useCampaignStats: () => ({ data: statsData, isLoading: false }),
  };
});
vi.mock('../hooks/useCampaignMutations', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useCampaignMutations')>(
    '../hooks/useCampaignMutations',
  );
  return {
    ...actual,
    useBuildCampaignRecipients: () => ({ mutateAsync: buildMutateAsync, isPending: false }),
  };
});
vi.mock('../hooks/useTestSendCampaign', () => ({
  useTestSendCampaign: () => ({ mutateAsync: testSendMutateAsync, isPending: false }),
}));
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (selector: (s: { user: { email: string } | null }) => unknown) =>
    selector({ user: { email: 'me@itdev.gr' } }),
}));

import { StepReview } from './StepReview';

function wrap(node: React.ReactNode) {
  return <I18nextProvider i18n={i18n}>{node}</I18nextProvider>;
}

describe('StepReview', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('el');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    statsData = undefined;
  });

  it('shows the built → suppressed → target funnel after "Υπολογισμός παραληπτών"', async () => {
    buildMutateAsync.mockResolvedValue({
      ok: true,
      built: 120,
      suppressed: 8,
      by_reason: { invalid: 3, fatigue: 5 },
    });
    render(wrap(<StepReview campaignId="camp-1" />));

    fireEvent.click(screen.getByRole('button', { name: 'Υπολογισμός παραληπτών' }));

    await waitFor(() => expect(buildMutateAsync).toHaveBeenCalledWith('camp-1'));
    expect(await screen.findByText('120')).toBeInTheDocument(); // final target
    expect(screen.getByText('128')).toBeInTheDocument(); // total candidates (120+8)
    expect(screen.getAllByText('8').length).toBeGreaterThan(0); // suppressed tile
  });

  it('renders a suppression label for every one of the six known reasons plus an unknown one', async () => {
    buildMutateAsync.mockResolvedValue({
      ok: true,
      built: 10,
      suppressed: 7,
      by_reason: {
        invalid: 1,
        suppressed_list: 1,
        opted_out: 1,
        closed_client: 1,
        internal: 1,
        fatigue: 1,
        some_future_reason: 1,
      },
    });
    render(wrap(<StepReview campaignId="camp-1" />));
    fireEvent.click(screen.getByRole('button', { name: 'Υπολογισμός παραληπτών' }));

    expect(await screen.findByText('Μη έγκυρη διεύθυνση email')).toBeInTheDocument();
    expect(screen.getByText('Έχει ήδη απορριφθεί ή ζήτησε απεγγραφή')).toBeInTheDocument();
    expect(screen.getByText('Έχει ζητήσει να μην λαμβάνει email')).toBeInTheDocument();
    expect(screen.getByText('Πελάτης με ολοκληρωμένη/κλειστή συνεργασία')).toBeInTheDocument();
    expect(screen.getByText('Εσωτερική διεύθυνση email (όχι πραγματικός παραλήπτης)')).toBeInTheDocument();
    expect(screen.getByText('Έλαβε πρόσφατα άλλη καμπάνια')).toBeInTheDocument();
    // Unknown reason still renders something, not vanish.
    expect(screen.getByText('Άγνωστος λόγος αποκλεισμού (some_future_reason)')).toBeInTheDocument();
  });

  it('falls back to campaign_stats when no build has run yet in this session', () => {
    statsData = { by_status: { pending: 42 }, by_suppression_reason: { invalid: 2 } };
    render(wrap(<StepReview campaignId="camp-1" />));

    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('shows a translated failure for the test send when the edge function is unavailable', async () => {
    testSendMutateAsync.mockRejectedValue(new Error('Failed to send a request to the Edge Function'));
    render(wrap(<StepReview campaignId="camp-1" />));

    fireEvent.click(screen.getByRole('button', { name: 'Δοκιμαστικό σε μένα' }));

    await waitFor(() =>
      expect(testSendMutateAsync).toHaveBeenCalledWith({ campaignId: 'camp-1', to: 'me@itdev.gr' }),
    );
    expect(
      await screen.findByText('Η δοκιμαστική αποστολή δεν είναι διαθέσιμη αυτή τη στιγμή. Δοκιμάστε ξανά αργότερα.'),
    ).toBeInTheDocument();
  });

  it('shows a translated success message for the test send', async () => {
    testSendMutateAsync.mockResolvedValue({ ok: true, resendId: 'abc' });
    render(wrap(<StepReview campaignId="camp-1" />));

    fireEvent.click(screen.getByRole('button', { name: 'Δοκιμαστικό σε μένα' }));

    expect(await screen.findByText('Το δοκιμαστικό εστάλη στο me@itdev.gr.')).toBeInTheDocument();
  });
});
