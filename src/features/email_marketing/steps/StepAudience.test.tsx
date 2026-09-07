import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import '@/lib/i18n';
import { i18n } from '@/lib/i18n';
import { I18nextProvider } from 'react-i18next';
import type { AudienceRow } from '../hooks/useAudiences';
import type { CampaignRow } from '../hooks/useCampaigns';

const audiences: AudienceRow[] = [
  {
    id: 'aud-1',
    name: 'Πελάτες 2025',
    kind: 'import',
    source_file: 'clients.xlsx',
    consent_basis: 'existing_customer',
    source_note: null,
    row_count: 120,
    created_by: null,
    created_at: '2026-09-01T00:00:00Z',
  },
  {
    id: 'aud-2',
    name: 'Εκδήλωση Μαρτίου',
    kind: 'import',
    source_file: 'event.xlsx',
    consent_basis: 'inquiry',
    source_note: null,
    row_count: 30,
    created_by: null,
    created_at: '2026-09-02T00:00:00Z',
  },
];

const { detachMutateAsync } = vi.hoisted(() => ({ detachMutateAsync: vi.fn() }));

let campaign: CampaignRow = {
  id: 'camp-1',
  name: 'Test campaign',
  status: 'draft',
  identity: 'marketing',
  subject: '',
  preheader: null,
  body_md: '',
  hero_image_url: null,
  reply_to: 'sales@itdev.gr',
  segment: {},
  daily_cap: null,
  hourly_cap: null,
  send_window_start: '09:00',
  send_window_end: '18:00',
  send_days: [1, 2, 3, 4, 5],
  scheduled_at: null,
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
  return { ...actual, useCampaign: () => ({ data: campaign, isLoading: false }) };
});
vi.mock('../hooks/useAudiences', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useAudiences')>('../hooks/useAudiences');
  return {
    ...actual,
    useCampaignAudiences: () => ({ data: audiences, isLoading: false, error: null }),
  };
});
vi.mock('../hooks/useCampaignMutations', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useCampaignMutations')>(
    '../hooks/useCampaignMutations',
  );
  return {
    ...actual,
    useDetachAudience: () => ({ mutateAsync: detachMutateAsync, isPending: false }),
  };
});
vi.mock('../components/ImportAudienceDialog', () => ({
  ImportAudienceDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="import-dialog-open" /> : null,
}));

import { StepAudience } from './StepAudience';

function wrap(node: React.ReactNode) {
  return <I18nextProvider i18n={i18n}>{node}</I18nextProvider>;
}

describe('StepAudience', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('el');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    campaign = { ...campaign, status: 'draft' };
  });

  it('lists attached audiences with row counts, consent basis and the running total', () => {
    render(wrap(<StepAudience campaignId="camp-1" />));

    expect(screen.getByText('Πελάτες 2025')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.getByText('Υπάρχων πελάτης')).toBeInTheDocument();
    expect(screen.getByText('Εκδήλωση Μαρτίου')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('150 παραλήπτες συνολικά')).toBeInTheDocument();
  });

  it('opens the import dialog from "+ Εισαγωγή από Excel"', () => {
    render(wrap(<StepAudience campaignId="camp-1" />));

    expect(screen.queryByTestId('import-dialog-open')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Εισαγωγή από Excel/ }));
    expect(screen.getByTestId('import-dialog-open')).toBeInTheDocument();
  });

  it('detaches an audience after confirmation', async () => {
    detachMutateAsync.mockResolvedValue({ ok: true, campaign_id: 'camp-1', audience_id: 'aud-1' });
    render(wrap(<StepAudience campaignId="camp-1" />));

    const detachButtons = screen.getAllByRole('button', { name: 'Αποσύνδεση' });
    fireEvent.click(detachButtons[0]!);

    // Confirm dialog now shows a second "Αποσύνδεση" button (the destructive one).
    const confirmButtons = screen.getAllByRole('button', { name: 'Αποσύνδεση' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

    await waitFor(() =>
      expect(detachMutateAsync).toHaveBeenCalledWith({ campaignId: 'camp-1', audienceId: 'aud-1' }),
    );
  });

  // --- Important-3 fix: attach/detach both refuse outside draft|ready, same
  // as campaign_update — this step previously had no status lock at all, so
  // a "sending" campaign let the owner open the import dialog and upload a
  // huge file before the final attach call failed, leaving an orphan
  // audience. The trigger button itself must be blocked. ---

  it('blocks the import button and every detach action, with an explanation, when the campaign is no longer draft/ready', () => {
    campaign = { ...campaign, status: 'sending' };
    render(wrap(<StepAudience campaignId="camp-1" />));

    expect(screen.getByText(/Η καμπάνια είναι πλέον «Σε αποστολή»/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Εισαγωγή από Excel/ })).toBeDisabled();
    for (const button of screen.getAllByRole('button', { name: 'Αποσύνδεση' })) {
      expect(button).toBeDisabled();
    }

    // Clicking a disabled trigger never opens the dialog — the exact gap
    // that let a multi-thousand-row upload run before failing on attach.
    fireEvent.click(screen.getByRole('button', { name: /Εισαγωγή από Excel/ }));
    expect(screen.queryByTestId('import-dialog-open')).not.toBeInTheDocument();
  });

  it('leaves the import button and detach actions enabled while the campaign is draft or ready', () => {
    render(wrap(<StepAudience campaignId="camp-1" />));

    expect(screen.queryByText(/δεν επεξεργάζονται πια/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Εισαγωγή από Excel/ })).not.toBeDisabled();
    for (const button of screen.getAllByRole('button', { name: 'Αποσύνδεση' })) {
      expect(button).not.toBeDisabled();
    }
  });
});
