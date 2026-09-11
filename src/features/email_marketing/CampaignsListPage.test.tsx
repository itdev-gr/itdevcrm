import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import '@/lib/i18n';
import { i18n } from '@/lib/i18n';
import { I18nextProvider } from 'react-i18next';
import type { CampaignRow } from './hooks/useCampaigns';

const { deleteMutate, createMutate } = vi.hoisted(() => ({
  deleteMutate: vi.fn().mockResolvedValue({ ok: true }),
  createMutate: vi.fn(),
}));

function campaign(over: Partial<CampaignRow> & Pick<CampaignRow, 'id' | 'name' | 'status'>): CampaignRow {
  return {
    identity: 'marketing',
    subject: 's',
    preheader: null,
    body_md: 'b',
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
    ...over,
  } as CampaignRow;
}

let rows: CampaignRow[] = [];

vi.mock('./hooks/useCampaigns', async () => {
  const actual = await vi.importActual<typeof import('./hooks/useCampaigns')>('./hooks/useCampaigns');
  return {
    ...actual,
    useCampaigns: () => ({ data: rows, isLoading: false, error: null }),
    useCampaignStats: () => ({ data: undefined }),
  };
});
vi.mock('./hooks/useCampaignMutations', async () => {
  const actual = await vi.importActual<typeof import('./hooks/useCampaignMutations')>(
    './hooks/useCampaignMutations',
  );
  return {
    ...actual,
    useCreateCampaign: () => ({ mutateAsync: createMutate, isPending: false }),
    useDeleteCampaign: () => ({ mutateAsync: deleteMutate, isPending: false }),
  };
});

import { CampaignsListPage } from './CampaignsListPage';

function wrap(node: React.ReactNode) {
  return (
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>{node}</I18nextProvider>
    </MemoryRouter>
  );
}

describe('CampaignsListPage — delete', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('el');
  });
  beforeEach(() => {
    vi.clearAllMocks();
    deleteMutate.mockResolvedValue({ ok: true });
  });

  // campaign_delete only accepts draft/cancelled — offering the button on a
  // sending campaign would be a dead end.
  it('offers Delete on draft and cancelled campaigns only', () => {
    rows = [
      campaign({ id: 'a', name: 'Πρόχειρη', status: 'draft' }),
      campaign({ id: 'b', name: 'Ακυρωμένη', status: 'cancelled' }),
      campaign({ id: 'c', name: 'Τρέχει', status: 'sending' }),
      campaign({ id: 'd', name: 'Στάλθηκε', status: 'sent' }),
    ];
    render(wrap(<CampaignsListPage />));
    expect(screen.getAllByRole('button', { name: 'Διαγραφή' })).toHaveLength(2);
  });

  it('deletes after confirmation', async () => {
    rows = [campaign({ id: 'a', name: 'Πρόχειρη', status: 'draft' })];
    render(wrap(<CampaignsListPage />));

    fireEvent.click(screen.getByRole('button', { name: 'Διαγραφή' }));
    expect(screen.getByText(/Η καμπάνια «Πρόχειρη»/)).toBeInTheDocument();

    // The dialog's own confirm button carries the same label as the row link.
    const confirm = screen.getAllByRole('button', { name: 'Διαγραφή' }).at(-1)!;
    fireEvent.click(confirm);

    await waitFor(() => expect(deleteMutate).toHaveBeenCalledWith('a'));
  });

  // The RPC refuses a cancelled campaign that already sent, to preserve the
  // send history the fatigue rule reads — that refusal must be explained,
  // not shown as a generic failure.
  it('explains the refusal when the campaign already sent', async () => {
    rows = [campaign({ id: 'b', name: 'Ακυρωμένη', status: 'cancelled' })];
    deleteMutate.mockRejectedValue(new Error('already_sent'));
    render(wrap(<CampaignsListPage />));

    fireEvent.click(screen.getByRole('button', { name: 'Διαγραφή' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Διαγραφή' }).at(-1)!);

    expect(await screen.findByText(/έχει ήδη στείλει email/)).toBeInTheDocument();
  });
});
