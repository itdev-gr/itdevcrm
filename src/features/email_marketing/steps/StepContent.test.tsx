import { render, screen, fireEvent } from '@testing-library/react';
import { vi, beforeAll, beforeEach, afterEach, describe, it, expect } from 'vitest';
import '@/lib/i18n';
import { i18n } from '@/lib/i18n';
import { I18nextProvider } from 'react-i18next';
import type { CampaignRow } from '../hooks/useCampaigns';

const { updateMutate, sentCount } = vi.hoisted(() => ({
  updateMutate: vi.fn(),
  sentCount: { current: 0 },
}));

let campaign: CampaignRow = {
  id: 'camp-1',
  name: 'Test campaign',
  status: 'draft',
  identity: 'marketing',
  subject: 'Αρχικό θέμα',
  preheader: null,
  body_md: 'Αρχικό κείμενο',
  hero_image_url: null,
  reply_to: 'sales@itdev.gr',
  segment: {},
  daily_cap: null,
  hourly_cap: null,
  send_window_start: '09:00',
  send_window_end: '18:00',
  send_days: [1, 2, 3, 4, 5],
  scheduled_at: null,
  warmup_enabled: true,
  prepared_at: null,
  started_at: null,
  finished_at: null,
  autopause_reason: null,
  created_by: null,
  created_at: '2026-09-07T00:00:00Z',
  updated_at: '2026-09-07T00:00:00Z',
};

vi.mock('../hooks/useCampaigns', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useCampaigns')>('../hooks/useCampaigns');
  return {
    ...actual,
    useCampaign: () => ({ data: campaign, isLoading: false }),
    useCampaignStats: () => ({ data: { sent: sentCount.current }, isLoading: false }),
  };
});
vi.mock('../hooks/useCampaignMutations', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useCampaignMutations')>(
    '../hooks/useCampaignMutations',
  );
  return { ...actual, useUpdateCampaign: () => ({ mutate: updateMutate, isPending: false }) };
});

import { StepContent } from './StepContent';

function wrap(node: React.ReactNode) {
  return <I18nextProvider i18n={i18n}>{node}</I18nextProvider>;
}

describe('StepContent', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('el');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    campaign = { ...campaign, status: 'draft' };
    sentCount.current = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces autosave — rapid keystrokes fire one campaign_update, not one per keystroke', () => {
    render(wrap(<StepContent campaignId="camp-1" />));
    const subject = screen.getByLabelText('Θέμα');

    fireEvent.change(subject, { target: { value: 'Ν' } });
    fireEvent.change(subject, { target: { value: 'Νέ' } });
    fireEvent.change(subject, { target: { value: 'Νέο' } });
    fireEvent.change(subject, { target: { value: 'Νέο θ' } });
    fireEvent.change(subject, { target: { value: 'Νέο θέμα' } });

    // Still inside the debounce window — nothing saved yet.
    expect(updateMutate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);

    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: 'camp-1',
        patch: expect.objectContaining({ subject: 'Νέο θέμα' }),
      }),
      expect.anything(),
    );
  });

  it('renders the preview through the shared markup renderer (bold + heading survive)', () => {
    render(wrap(<StepContent campaignId="camp-1" />));
    const body = screen.getByLabelText('Κείμενο');

    fireEvent.change(body, { target: { value: '## Τίτλος\n\n**έντονο** κείμενο' } });

    const heading = document.querySelector('h3');
    const strong = document.querySelector('strong');
    expect(heading?.textContent).toBe('Τίτλος');
    expect(strong?.textContent).toBe('έντονο');
  });

  it('renders the preview through renderCampaignEmail (not a hand-rolled shell) — the unsubscribe footer is present', () => {
    render(wrap(<StepContent campaignId="camp-1" />));

    // The greeting and the "Απεγγραφή" unsubscribe link only exist in
    // renderCampaignEmail's card shell — renderEmailMarkup alone (the body
    // markup renderer) never emits either. Their presence here proves the
    // preview goes through the real sender-side renderer.
    expect(screen.getByText(/Γεια σας, Γιώργος Παπαδόπουλος!/)).toBeInTheDocument();
    expect(screen.getByText('Απεγγραφή από τα ενημερωτικά email')).toBeInTheDocument();
  });

  it('flushes a pending debounced save instead of dropping it when the step unmounts (step change)', () => {
    const { unmount } = render(wrap(<StepContent campaignId="camp-1" />));
    const subject = screen.getByLabelText('Θέμα');

    fireEvent.change(subject, { target: { value: 'Επείγον θέμα' } });

    // Still inside the 800ms debounce window.
    expect(updateMutate).not.toHaveBeenCalled();

    // Switching wizard steps unmounts StepContent immediately — the edit
    // must not be silently discarded (task-3-review.md, Important 2).
    unmount();

    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: 'camp-1',
        patch: expect.objectContaining({ subject: 'Επείγον θέμα' }),
      }),
      expect.anything(),
    );

    // Advancing time past the original debounce window afterwards must not
    // fire a second save — the timer was cleared, not left dangling.
    vi.advanceTimersByTime(1000);
    expect(updateMutate).toHaveBeenCalledTimes(1);
  });

  // --- Live editing (owner 2026-09-11). Content stays editable while the
  // campaign is in flight — the sender re-reads it every tick — so only the
  // terminal statuses freeze the inputs. ---

  it('freezes every input and explains why once the campaign is finished', () => {
    campaign = { ...campaign, status: 'sent' };
    render(wrap(<StepContent campaignId="camp-1" />));

    expect(screen.getByLabelText('Θέμα')).toBeDisabled();
    expect(screen.getByLabelText('Κείμενο')).toBeDisabled();

    // A change event on a disabled field is a no-op in the browser, but this
    // also pins the handler's own guard for defense in depth.
    fireEvent.change(screen.getByLabelText('Θέμα'), { target: { value: 'Should not save' } });
    vi.advanceTimersByTime(1000);
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it('keeps the content editable while the campaign is sending, and saves the edit', () => {
    campaign = { ...campaign, status: 'sending' };
    render(wrap(<StepContent campaignId="camp-1" />));

    expect(screen.getByLabelText('Θέμα')).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText('Θέμα'), { target: { value: 'Διορθωμένο θέμα' } });
    vi.advanceTimersByTime(1000);

    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ patch: expect.objectContaining({ subject: 'Διορθωμένο θέμα' }) }),
      expect.anything(),
    );
  });

  // The one thing that makes a live content edit different from a draft one:
  // it cannot reach anyone already emailed.
  it('warns that already-emailed recipients got the previous version', () => {
    campaign = { ...campaign, status: 'sending' };
    sentCount.current = 300;
    render(wrap(<StepContent campaignId="camp-1" />));

    expect(screen.getByText(/οι 300 που έχουν ήδη λάβει/)).toBeInTheDocument();
  });

  it('does not show that warning before anything has been sent', () => {
    campaign = { ...campaign, status: 'ready' };
    render(wrap(<StepContent campaignId="camp-1" />));

    expect(screen.queryByText(/έχουν ήδη λάβει/)).toBeNull();
  });

  // --- Campaign name (owner request 2026-09-11: campaigns pile up and all
  // read "New campaign", so they need a findable label). ---

  it('hydrates the campaign name and saves an edit to it', () => {
    render(wrap(<StepContent campaignId="camp-1" />));
    const name = screen.getByLabelText('Όνομα καμπάνιας (εσωτερικό)');
    expect(name).toHaveValue('Test campaign');

    fireEvent.change(name, { target: { value: 'Local SEO — Σεπτέμβριος' } });
    vi.advanceTimersByTime(1000);

    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ patch: expect.objectContaining({ name: 'Local SEO — Σεπτέμβριος' }) }),
      expect.anything(),
    );
  });

  // campaign_update rejects a blank name (invalid_name), which would fail the
  // whole autosave and take the subject/body edit down with it.
  it('omits a blank name from the patch so the rest of the edit still saves', () => {
    render(wrap(<StepContent campaignId="camp-1" />));

    fireEvent.change(screen.getByLabelText('Όνομα καμπάνιας (εσωτερικό)'), { target: { value: '   ' } });
    fireEvent.change(screen.getByLabelText('Θέμα'), { target: { value: 'Κρατιέται' } });
    vi.advanceTimersByTime(1000);

    const patch = updateMutate.mock.calls.at(-1)?.[0].patch;
    expect(patch).not.toHaveProperty('name');
    expect(patch).toMatchObject({ subject: 'Κρατιέται' });
    expect(screen.getByText(/Το όνομα δεν μπορεί να είναι κενό/)).toBeInTheDocument();
  });
});
