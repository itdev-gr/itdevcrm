import { render, screen, fireEvent } from '@testing-library/react';
// vi.waitFor (not @testing-library/react's own async utilities) — same
// reasoning as StepSchedule.test.tsx: RTL's utilities poll via a real
// setTimeout, which never fires under vi.useFakeTimers().
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { vi, beforeAll, beforeEach, afterEach, describe, it, expect } from 'vitest';
import '@/lib/i18n';
import { i18n } from '@/lib/i18n';
import { I18nextProvider } from 'react-i18next';
import type { CampaignRow, CampaignStatsResult } from './hooks/useCampaigns';

const { pauseMutateAsync, resumeMutateAsync, cancelMutateAsync, refetchCampaign, refetchStats } = vi.hoisted(() => ({
  pauseMutateAsync: vi.fn(),
  resumeMutateAsync: vi.fn(),
  cancelMutateAsync: vi.fn(),
  refetchCampaign: vi.fn(),
  refetchStats: vi.fn(),
}));

function makeCampaign(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return {
    id: 'camp-1',
    name: 'Test campaign',
    status: 'sending',
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
    started_at: '2026-09-07T08:00:00Z',
    finished_at: null,
    autopause_reason: null,
    created_by: null,
    created_at: '2026-09-07T00:00:00Z',
    updated_at: '2026-09-07T00:00:00Z',
    ...overrides,
  };
}

function makeStats(overrides: Partial<CampaignStatsResult> = {}): CampaignStatsResult {
  return {
    ok: true,
    campaign_id: 'camp-1',
    by_status: { pending: 10, sending: 0, sent: 90, failed: 0 },
    by_suppression_reason: {},
    sent: 90,
    delivered: 85,
    bounced: 3,
    complained: 1,
    unsubscribed: 2,
    ...overrides,
  };
}

let campaign = makeCampaign();
let statsState: {
  data?: CampaignStatsResult;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} = { data: makeStats(), isLoading: false, isError: false, refetch: refetchStats };

vi.mock('./hooks/useCampaigns', async () => {
  const actual = await vi.importActual<typeof import('./hooks/useCampaigns')>('./hooks/useCampaigns');
  return {
    ...actual,
    useCampaign: () => ({ data: campaign, isLoading: false, error: null, refetch: refetchCampaign }),
    useCampaignStats: () => statsState,
    useCampaignRecipients: () => ({ data: [], isLoading: false }),
  };
});
vi.mock('./hooks/useCampaignMutations', async () => {
  const actual = await vi.importActual<typeof import('./hooks/useCampaignMutations')>(
    './hooks/useCampaignMutations',
  );
  return {
    ...actual,
    usePauseCampaign: () => ({ mutateAsync: pauseMutateAsync, isPending: false }),
    useResumeCampaign: () => ({ mutateAsync: resumeMutateAsync, isPending: false }),
    useCancelCampaign: () => ({ mutateAsync: cancelMutateAsync, isPending: false }),
  };
});

import { CampaignDetailPage } from './CampaignDetailPage';

function wrap(node: React.ReactNode) {
  return (
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/company/email-marketing/camp-1']}>
        <Routes>
          <Route path="/company/email-marketing/:campaignId" element={node} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>
  );
}

describe('CampaignDetailPage', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('el');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    campaign = makeCampaign();
    statsState = { data: makeStats(), isLoading: false, isError: false, refetch: refetchStats };
    pauseMutateAsync.mockResolvedValue({ ok: true, campaign_id: 'camp-1', status: 'paused' });
    resumeMutateAsync.mockResolvedValue({ ok: true, campaign_id: 'camp-1', status: 'sending' });
    cancelMutateAsync.mockResolvedValue({ ok: true, campaign_id: 'camp-1', status: 'cancelled' });
  });

  // --- Opens/clicks: honesty about unmeasured tracking (Phase 2) -----------

  it('renders "δεν μετράται" for both the open and click rate tiles, never 0%, while tracking is off', () => {
    render(wrap(<CampaignDetailPage />));

    // Both tiles show the exact "not measured" phrase — never a computed
    // rate that would misread as "nobody opened/clicked this".
    expect(screen.getAllByText('δεν μετράται')).toHaveLength(2);
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    expect(screen.queryByText('0.0%')).not.toBeInTheDocument();
  });

  // --- autopause_reason: shown prominently when set, absent otherwise ------

  it('shows the autopause reason as a prominent warning when it is set', () => {
    campaign = makeCampaign({ status: 'paused', autopause_reason: 'bounce_rate_exceeded_5pct' });
    render(wrap(<CampaignDetailPage />));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('bounce_rate_exceeded_5pct');
  });

  it('shows no autopause banner when autopause_reason is null', () => {
    campaign = makeCampaign({ autopause_reason: null });
    render(wrap(<CampaignDetailPage />));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // --- Zero-denominator rates: "—", never NaN%/0% fabricated from nothing --

  it('renders "—" (not NaN% or a fabricated 0%) for every rate tile when there is no target and nothing sent yet', () => {
    statsState = {
      data: makeStats({ by_status: {}, sent: 0, delivered: 0, bounced: 0, complained: 0, unsubscribed: 0 }),
      isLoading: false,
      isError: false,
      refetch: refetchStats,
    };
    render(wrap(<CampaignDetailPage />));

    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^0(\.0)?%/)).not.toBeInTheDocument();
    // sent (of target), delivered/bounced/complained/unsubscribed (of sent)
    // all have a zero denominator here — five honest em-dashes.
    expect(screen.getAllByText(/^—/).length).toBeGreaterThanOrEqual(5);
  });

  // --- Cancel is destructive/terminal: must not fire on the first click ----

  it('does not fire campaign_cancel on the first click — only the confirm dialog opens', () => {
    render(wrap(<CampaignDetailPage />));

    fireEvent.click(screen.getByRole('button', { name: 'Ακύρωση καμπάνιας' }));

    expect(cancelMutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText('Ακύρωση της καμπάνιας;')).toBeInTheDocument();
    // The copy says this is final, per the brief.
    expect(screen.getByText(/οριστική/)).toBeInTheDocument();
  });

  it('fires campaign_cancel only after the confirm dialog is confirmed', async () => {
    render(wrap(<CampaignDetailPage />));

    fireEvent.click(screen.getByRole('button', { name: 'Ακύρωση καμπάνιας' }));
    const buttons = screen.getAllByRole('button', { name: 'Ακύρωση καμπάνιας' });
    fireEvent.click(buttons[buttons.length - 1]!);

    await vi.waitFor(() => expect(cancelMutateAsync).toHaveBeenCalledWith('camp-1'));
  });

  // --- Pause / resume gating by status --------------------------------------

  it('shows Pause (not Resume) while sending, and fires campaign_pause only after confirming', async () => {
    campaign = makeCampaign({ status: 'sending' });
    render(wrap(<CampaignDetailPage />));

    expect(screen.getByRole('button', { name: 'Παύση' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Συνέχιση' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Παύση' }));
    expect(pauseMutateAsync).not.toHaveBeenCalled();
    const buttons = screen.getAllByRole('button', { name: 'Παύση' });
    fireEvent.click(buttons[buttons.length - 1]!);

    await vi.waitFor(() => expect(pauseMutateAsync).toHaveBeenCalledWith('camp-1'));
  });

  it('shows Resume (not Pause) while paused', () => {
    campaign = makeCampaign({ status: 'paused' });
    render(wrap(<CampaignDetailPage />));

    expect(screen.getByRole('button', { name: 'Συνέχιση' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Παύση' })).not.toBeInTheDocument();
  });

  it('shows no lifecycle actions once the campaign is a terminal "sent"', () => {
    campaign = makeCampaign({ status: 'sent' });
    render(wrap(<CampaignDetailPage />));

    expect(screen.queryByRole('button', { name: 'Παύση' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Συνέχιση' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ακύρωση καμπάνιας' })).not.toBeInTheDocument();
  });

  // --- Live polling: only while actively sending, stops otherwise ----------

  describe('polling', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('refetches campaign + stats every 15s while status is "sending"', () => {
      campaign = makeCampaign({ status: 'sending' });
      render(wrap(<CampaignDetailPage />));

      expect(refetchCampaign).not.toHaveBeenCalled();
      vi.advanceTimersByTime(15_000);
      expect(refetchCampaign).toHaveBeenCalledTimes(1);
      expect(refetchStats).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(15_000);
      expect(refetchCampaign).toHaveBeenCalledTimes(2);
    });

    it('never polls once the campaign status is terminal', () => {
      campaign = makeCampaign({ status: 'sent' });
      render(wrap(<CampaignDetailPage />));

      vi.advanceTimersByTime(45_000);

      expect(refetchCampaign).not.toHaveBeenCalled();
      expect(refetchStats).not.toHaveBeenCalled();
    });

    it('stops polling once a "sending" campaign transitions to a terminal status', () => {
      campaign = makeCampaign({ status: 'sending' });
      const { rerender } = render(wrap(<CampaignDetailPage />));

      vi.advanceTimersByTime(15_000);
      expect(refetchCampaign).toHaveBeenCalledTimes(1);

      campaign = makeCampaign({ status: 'cancelled' });
      rerender(wrap(<CampaignDetailPage />));

      vi.advanceTimersByTime(45_000);
      // No further calls once the campaign is no longer sending.
      expect(refetchCampaign).toHaveBeenCalledTimes(1);
    });

    it('does not poll for a merely paused campaign either — only "sending" arms it', () => {
      campaign = makeCampaign({ status: 'paused' });
      render(wrap(<CampaignDetailPage />));

      vi.advanceTimersByTime(45_000);

      expect(refetchCampaign).not.toHaveBeenCalled();
      expect(refetchStats).not.toHaveBeenCalled();
    });
  });
});
