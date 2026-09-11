import { render, screen, fireEvent } from '@testing-library/react';
// vi.waitFor (not @testing-library/react's waitFor/findBy*) throughout this
// file — RTL's own async utilities poll via a real setTimeout internally,
// which never fires under vi.useFakeTimers() (needed here for the
// completion-estimate tests' deterministic "now") and hangs until timeout.
// vi.waitFor is fake-timer aware.
import { MemoryRouter } from 'react-router-dom';
import { vi, beforeAll, beforeEach, afterEach, describe, it, expect } from 'vitest';
import '@/lib/i18n';
import { i18n } from '@/lib/i18n';
import { I18nextProvider } from 'react-i18next';
import type { CampaignRow } from '../hooks/useCampaigns';

const { updateMutateAsync, launchMutateAsync } = vi.hoisted(() => ({
  updateMutateAsync: vi.fn(),
  launchMutateAsync: vi.fn(),
}));

function makeCampaign(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return {
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
    ...overrides,
  };
}

let campaign = makeCampaign();
let statsState: {
  data?: { by_status: Record<string, number> } | undefined;
  isLoading: boolean;
  isError: boolean;
} = {
  data: { by_status: { pending: 4312 } },
  isLoading: false,
  isError: false,
};
const DEFAULT_LADDER = [500, 1000, 2000, 3000, 5000, 7500, 10000];
let settingsState: {
  data?: { daily_cap: number; warmup_ladder: number[]; warmup_started_on: string | null; paused: boolean };
  isLoading: boolean;
  isError: boolean;
} = {
  data: { daily_cap: 500, warmup_ladder: DEFAULT_LADDER, warmup_started_on: null, paused: false },
  isLoading: false,
  isError: false,
};
// Other campaigns in the account, for the Important-5 "shared daily budget"
// caveat — empty by default (no other campaign sending).
let otherCampaignsState: { data?: Array<{ id: string; status: string }>; isLoading: boolean } = {
  data: [],
  isLoading: false,
};

vi.mock('../hooks/useCampaigns', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useCampaigns')>('../hooks/useCampaigns');
  return {
    ...actual,
    useCampaign: () => ({ data: campaign, isLoading: false }),
    useCampaigns: () => otherCampaignsState,
    useCampaignStats: () => statsState,
    useEmailMarketingSettings: () => settingsState,
  };
});
vi.mock('../hooks/useCampaignMutations', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useCampaignMutations')>(
    '../hooks/useCampaignMutations',
  );
  return {
    ...actual,
    useUpdateCampaign: () => ({ mutateAsync: updateMutateAsync, isPending: false }),
    useLaunchCampaign: () => ({ mutateAsync: launchMutateAsync, isPending: false }),
  };
});

import { StepSchedule } from './StepSchedule';

function wrap(node: React.ReactNode) {
  return (
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>{node}</MemoryRouter>
    </I18nextProvider>
  );
}

describe('StepSchedule', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('el');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    campaign = makeCampaign();
    statsState = { data: { by_status: { pending: 4312 } }, isLoading: false, isError: false };
    settingsState = {
      data: { daily_cap: 500, warmup_ladder: DEFAULT_LADDER, warmup_started_on: null, paused: false },
      isLoading: false,
      isError: false,
    };
    otherCampaignsState = { data: [], isLoading: false };
    updateMutateAsync.mockResolvedValue({ ok: true, campaign_id: 'camp-1' });
    launchMutateAsync.mockResolvedValue({ ok: true, campaign_id: 'camp-1', status: 'sending' });
    // Monday 2026-09-07, 10:00 UTC — fixed so the day-by-day estimate (and
    // its weekday/weekend arithmetic) is deterministic regardless of when
    // the suite actually runs.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-07T10:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('computes the completion date day-by-day (skipping weekends, respecting the warm-up ladder) — not a flat division of target by cap', () => {
    render(wrap(<StepSchedule campaignId="camp-1" />));

    const dailyCap = screen.getByLabelText('Ημερήσιο πλαφόν');
    fireEvent.change(dailyCap, { target: { value: '500' } });

    // 4,312 recipients at a flat 500/day would naively be ceil(4312/500)=9
    // CALENDAR days (2026-09-15). The real day-by-day walk needs 9 SEND
    // days but skips one weekend along the way, landing on 2026-09-17 (11
    // calendar days) — this pins that the weekend-skipping model is what's
    // actually wired up, not the old flat estimate.
    expect(screen.getByText(/Με 500\/ημέρα, η αποστολή ολοκληρώνεται περίπου στις 17 Σεπτεμβρίου 2026 \(11 ημέρες\)\./)).toBeInTheDocument();
  });

  it('uses the LIVE warmup_started_on when the ladder has already begun climbing, not the "assume it starts today" fallback (second fix-pass)', () => {
    // Warm-up already started 10 days before "now" (2026-09-07) — the
    // ladder is already saturated past the 2,000 cap, so sending paces at
    // the full cap from day one instead of climbing 500→1000→2000 again.
    settingsState = {
      data: { daily_cap: 500, warmup_ladder: DEFAULT_LADDER, warmup_started_on: '2026-08-28', paused: false },
      isLoading: false,
      isError: false,
    };
    render(wrap(<StepSchedule campaignId="camp-1" />));

    const dailyCap = screen.getByLabelText('Ημερήσιο πλαφόν');
    fireEvent.change(dailyCap, { target: { value: '2000' } });

    // ceil(4312/2000) = 3 send-days, Mon–Wed (7–9 Sep), no weekend to skip —
    // finishes noticeably sooner than the "not started yet" assumption
    // would (which would still be throttled by the ladder's early rungs).
    expect(
      screen.getByText('Με 2.000/ημέρα, η αποστολή ολοκληρώνεται περίπου στις 9 Σεπτεμβρίου 2026 (3 ημέρες).'),
    ).toBeInTheDocument();
  });

  it('shows "today" when the daily cap comfortably covers the whole target', () => {
    statsState = { data: { by_status: { pending: 100 } }, isLoading: false, isError: false };
    render(wrap(<StepSchedule campaignId="camp-1" />));

    const dailyCap = screen.getByLabelText('Ημερήσιο πλαφόν');
    fireEvent.change(dailyCap, { target: { value: '500' } });

    expect(screen.getByText('Με 500/ημέρα, η αποστολή ολοκληρώνεται σήμερα.')).toBeInTheDocument();
  });

  it('shows no estimate (not a nonsense date) when there is no target yet', () => {
    statsState = { data: { by_status: { pending: 0 } }, isLoading: false, isError: false };
    render(wrap(<StepSchedule campaignId="camp-1" />));

    expect(
      screen.getByText('Υπολογίστε πρώτα τους παραλήπτες στο βήμα «Έλεγχος» για να δείτε πότε ολοκληρώνεται η αποστολή.'),
    ).toBeInTheDocument();
  });

  // --- Critical-1 fix: an unresolved/errored recipient count must never
  // read as "0" and must never leave the launch path reachable. ---

  it('never shows or launches against a count of 0 while campaign_stats is still loading', () => {
    statsState = { data: undefined, isLoading: true, isError: false };
    render(wrap(<StepSchedule campaignId="camp-1" />));

    expect(screen.getByText('Υπολογισμός αριθμού παραληπτών…')).toBeInTheDocument();
    expect(screen.queryByText(/0 άτομα/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Εκκίνηση' })).toBeDisabled();
  });

  it('never shows or launches against a count of 0 when campaign_stats errors — stays blocked, not "0" forever', () => {
    statsState = { data: undefined, isLoading: false, isError: true };
    render(wrap(<StepSchedule campaignId="camp-1" />));

    expect(screen.getByText('Δεν ήταν δυνατή η ανάκτηση του αριθμού παραληπτών — δοκιμάστε να ανανεώσετε τη σελίδα.')).toBeInTheDocument();
    expect(screen.queryByText(/0 άτομα/)).not.toBeInTheDocument();
    const launchButton = screen.getByRole('button', { name: 'Εκκίνηση' });
    expect(launchButton).toBeDisabled();

    // Defense in depth: even if something forced a click through, no dialog
    // with a fabricated count can appear, and the launch RPC is never called.
    fireEvent.click(launchButton);
    expect(screen.queryByText(/Δεν αναιρείται/)).not.toBeInTheDocument();
    expect(launchMutateAsync).not.toHaveBeenCalled();
  });

  it('the launch confirmation shows the exact recipient count', () => {
    render(wrap(<StepSchedule campaignId="camp-1" />));

    fireEvent.click(screen.getByRole('button', { name: 'Εκκίνηση' }));

    expect(screen.getByText('Θα σταλεί σε 4.312 άτομα. Δεν αναιρείται.')).toBeInTheDocument();
  });

  it('does not launch on the first click — only the confirm dialog opens; the RPC fires only after confirming (Minor-3)', async () => {
    render(wrap(<StepSchedule campaignId="camp-1" />));

    fireEvent.click(screen.getByRole('button', { name: 'Εκκίνηση' }));
    expect(screen.getByText('Θα σταλεί σε 4.312 άτομα. Δεν αναιρείται.')).toBeInTheDocument();
    expect(launchMutateAsync).not.toHaveBeenCalled();

    const buttons = screen.getAllByRole('button', { name: 'Εκκίνηση' });
    fireEvent.click(buttons[buttons.length - 1]!);

    await vi.waitFor(() => expect(launchMutateAsync).toHaveBeenCalledWith('camp-1'));
  });

  it('flushes a pending debounced cap save before launching, so the campaign launches on the cap the owner just set (Important-2)', async () => {
    render(wrap(<StepSchedule campaignId="camp-1" />));

    const dailyCap = screen.getByLabelText('Ημερήσιο πλαφόν');
    fireEvent.change(dailyCap, { target: { value: '100' } });
    // Still well inside the 800ms debounce window — nothing saved yet.
    expect(updateMutateAsync).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Εκκίνηση' }));
    const buttons = screen.getAllByRole('button', { name: 'Εκκίνηση' });
    fireEvent.click(buttons[buttons.length - 1]!);

    await vi.waitFor(() => expect(launchMutateAsync).toHaveBeenCalledWith('camp-1'));
    expect(updateMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: 'camp-1', patch: expect.objectContaining({ daily_cap: 100 }) }),
    );
    // The flushed save must land BEFORE the launch call, not just "at some point".
    expect(updateMutateAsync.mock.invocationCallOrder[0]).toBeLessThan(launchMutateAsync.mock.invocationCallOrder[0]!);
  });

  it('renders a translated, actionable explanation for the most common refusal (invalid_state)', async () => {
    launchMutateAsync.mockRejectedValue(new Error('invalid_state'));
    render(wrap(<StepSchedule campaignId="camp-1" />));

    fireEvent.click(screen.getByRole('button', { name: 'Εκκίνηση' }));
    const buttons = screen.getAllByRole('button', { name: 'Εκκίνηση' });
    fireEvent.click(buttons[buttons.length - 1]!);

    // Actionable — names the fix (recalculate recipients in Review), not just "not allowed right now".
    await vi.waitFor(() =>
      expect(screen.getByText(/Ξαναϋπολογίστε τους παραλήπτες στο βήμα «Έλεγχος»/)).toBeInTheDocument(),
    );
  });

  it('renders a translated explanation when the server refuses the launch (empty_subject)', async () => {
    launchMutateAsync.mockRejectedValue(new Error('empty_subject'));
    render(wrap(<StepSchedule campaignId="camp-1" />));

    fireEvent.click(screen.getByRole('button', { name: 'Εκκίνηση' }));
    const buttons = screen.getAllByRole('button', { name: 'Εκκίνηση' });
    fireEvent.click(buttons[buttons.length - 1]!);

    await vi.waitFor(() =>
      expect(
        screen.getByText('Προσθέστε θέμα στο email πριν την εκκίνηση, στο βήμα «Περιεχόμενο».'),
      ).toBeInTheDocument(),
    );
  });

  // --- Important-4 fix: the screen must not become a silently-broken dead
  // end once the campaign is no longer draft/ready. ---

  it('locks the launch button and the pacing controls immediately after a successful launch, with a link back to the campaigns list', async () => {
    render(wrap(<StepSchedule campaignId="camp-1" />));

    fireEvent.click(screen.getByRole('button', { name: 'Εκκίνηση' }));
    const buttons = screen.getAllByRole('button', { name: 'Εκκίνηση' });
    fireEvent.click(buttons[buttons.length - 1]!);

    await vi.waitFor(() => expect(screen.getByText('Η καμπάνια ξεκίνησε.')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Πίσω στη λίστα καμπανιών' })).toHaveAttribute(
      'href',
      '/company/email-marketing',
    );
    expect(screen.getByRole('button', { name: 'Εκκίνηση' })).toBeDisabled();
    // The pacing fields deliberately STAY editable after launch (owner
    // 2026-09-11) — locking them on launch is what left a running campaign
    // impossible to speed up. Only the launch action itself locks.
    expect(screen.getByLabelText('Ημερήσιο πλαφόν')).not.toBeDisabled();
  });

  it('keeps the pacing editable while the campaign is sending, and saves the change', () => {
    campaign = makeCampaign({ status: 'sending' });
    render(wrap(<StepSchedule campaignId="camp-1" />));

    const dailyCap = screen.getByLabelText('Ημερήσιο πλαφόν');
    expect(dailyCap).not.toBeDisabled();
    // Launching again is still impossible — it is already sending.
    expect(screen.getByRole('button', { name: 'Εκκίνηση' })).toBeDisabled();

    fireEvent.change(dailyCap, { target: { value: '2000' } });
    vi.advanceTimersByTime(1000);
    expect(updateMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ patch: expect.objectContaining({ daily_cap: 2000 }) }),
    );
  });

  it('freezes the pacing controls once the campaign is finished', () => {
    campaign = makeCampaign({ status: 'sent' });
    render(wrap(<StepSchedule campaignId="camp-1" />));

    expect(screen.getByText(/Η καμπάνια είναι πλέον/)).toBeInTheDocument();
    expect(screen.getByLabelText('Ημερήσιο πλαφόν')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Εκκίνηση' })).toBeDisabled();
  });

  // --- Pacing mode (owner 2026-09-11: «κλιμακωτό ή ό,τι του πω»). ---

  it('switches to a fixed rate and saves warmup_enabled=false', () => {
    render(wrap(<StepSchedule campaignId="camp-1" />));

    fireEvent.click(screen.getByRole('button', { name: 'Σταθερός ρυθμός' }));
    vi.advanceTimersByTime(1000);

    expect(updateMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ patch: expect.objectContaining({ warmup_enabled: false }) }),
    );
  });

  // The trap this whole change came from: with the ladder binding, raising
  // the cap alone did nothing and the screen said nothing either.
  it('names which of the two ceilings is binding today', () => {
    render(wrap(<StepSchedule campaignId="camp-1" />));
    expect(screen.getByText(/Ισχύον όριο σήμερα/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Σταθερός ρυθμός' }));
    expect(screen.getByText(/το καθορίζει το ημερήσιο όριο/)).toBeInTheDocument();
  });

  // --- Important-1a fix: draft is editable but never launchable — the
  // server's campaign_launch only accepts ready|scheduled. ---

  it('blocks the launch button on a draft campaign, tells the owner why, and offers a way back to Review', () => {
    campaign = makeCampaign({ status: 'draft', prepared_at: null });
    statsState = { data: { by_status: {} }, isLoading: false, isError: false };
    const onGoToReview = vi.fn();
    render(wrap(<StepSchedule campaignId="camp-1" onGoToReview={onGoToReview} />));

    // The pacing fields stay editable — draft is still in the editable set.
    expect(screen.getByLabelText('Ημερήσιο πλαφόν')).not.toBeDisabled();
    // But the launch button is blocked, with an actionable explanation.
    expect(screen.getByRole('button', { name: 'Εκκίνηση' })).toBeDisabled();
    expect(
      screen.getByText('Η καμπάνια είναι πρόχειρη — η λίστα παραληπτών χρειάζεται νέο υπολογισμό πριν την εκκίνηση.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Μετάβαση στο βήμα «Έλεγχος»' }));
    expect(onGoToReview).toHaveBeenCalledTimes(1);
  });

  // --- Important-4 fix: the global pause switch must be visible, never
  // silently swallow a launch. ---

  it('shows the global-pause notice next to the launch button, and does NOT disable launching', () => {
    settingsState = {
      data: { daily_cap: 500, warmup_ladder: DEFAULT_LADDER, warmup_started_on: null, paused: true },
      isLoading: false,
      isError: false,
    };
    render(wrap(<StepSchedule campaignId="camp-1" />));

    expect(
      screen.getByText(/Η αποστολή είναι καθολικά σε παύση αυτή τη στιγμή\. Η καμπάνια θα δημιουργηθεί κανονικά/),
    ).toBeInTheDocument();
    // Launch stays available — paused is disclosed, not silently enforced.
    expect(screen.getByRole('button', { name: 'Εκκίνηση' })).not.toBeDisabled();
  });

  it('appends the pause caveat to the launch confirmation text when sending is globally paused', () => {
    settingsState = {
      data: { daily_cap: 500, warmup_ladder: DEFAULT_LADDER, warmup_started_on: null, paused: true },
      isLoading: false,
      isError: false,
    };
    render(wrap(<StepSchedule campaignId="camp-1" />));

    fireEvent.click(screen.getByRole('button', { name: 'Εκκίνηση' }));

    expect(
      screen.getByText(
        'Θα σταλεί σε 4.312 άτομα. Δεν αναιρείται. Η αποστολή είναι καθολικά σε παύση αυτή τη στιγμή — δεν θα σταλεί τίποτα μέχρι να συνεχιστεί.',
      ),
    ).toBeInTheDocument();
  });

  // --- Important-5 fix: campaign_daily_budget is shared across ALL
  // campaigns — the estimate must show an honest floor when another
  // campaign is already sending, not a precise-looking early date. ---

  it('presents the completion estimate as a floor with a caveat when another campaign is currently sending', () => {
    otherCampaignsState = {
      data: [
        { id: 'camp-1', status: 'ready' }, // this campaign itself — must be excluded
        { id: 'camp-2', status: 'sending' },
      ],
      isLoading: false,
    };
    render(wrap(<StepSchedule campaignId="camp-1" />));

    const dailyCap = screen.getByLabelText('Ημερήσιο πλαφόν');
    fireEvent.change(dailyCap, { target: { value: '500' } });

    expect(
      screen.getByText(/τρέχει και άλλη καμπάνια αυτή τη στιγμή, οπότε στην πράξη μπορεί να πάρει περισσότερο\.$/),
    ).toBeInTheDocument();
  });

  it('does not show the shared-budget caveat when every other campaign is NOT currently sending', () => {
    otherCampaignsState = {
      data: [
        { id: 'camp-2', status: 'draft' },
        { id: 'camp-3', status: 'sent' },
      ],
      isLoading: false,
    };
    render(wrap(<StepSchedule campaignId="camp-1" />));

    const dailyCap = screen.getByLabelText('Ημερήσιο πλαφόν');
    fireEvent.change(dailyCap, { target: { value: '500' } });

    expect(screen.queryByText(/τρέχει και άλλη καμπάνια/)).not.toBeInTheDocument();
    expect(screen.getByText(/ολοκληρώνεται περίπου στις 17 Σεπτεμβρίου 2026/)).toBeInTheDocument();
  });
});
