import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import '@/lib/i18n';
import { i18n } from '@/lib/i18n';
import { I18nextProvider } from 'react-i18next';
import type { CampaignRecipientRow, CampaignRecipientStatus } from '../hooks/useCampaigns';

function makeRow(overrides: Partial<CampaignRecipientRow> = {}): CampaignRecipientRow {
  return {
    id: 'r1',
    campaign_id: 'camp-1',
    email_lower: 'jane@example.com',
    display_name: 'Jane Doe',
    company: 'ACME, "Athens"',
    lead_id: null,
    client_id: null,
    audience_id: null,
    status: 'sent',
    suppression_reason: null,
    unsubscribe_token: 'tok',
    resend_id: null,
    attempts: 1,
    claimed_at: null,
    error: null,
    queued_at: '2026-09-07T08:00:00Z',
    sent_at: '2026-09-07T08:01:00Z',
    delivered_at: '2026-09-07T08:02:00Z',
    bounced_at: null,
    bounce_type: null,
    complained_at: null,
    unsubscribed_at: null,
    open_count: 0,
    click_count: 0,
    first_opened_at: null,
    first_clicked_at: null,
    replied_at: null,
    ...overrides,
  };
}

const { useCampaignRecipientsMock, fetchAllMock } = vi.hoisted(() => ({
  useCampaignRecipientsMock: vi.fn(),
  fetchAllMock: vi.fn(),
}));

vi.mock('../hooks/useCampaigns', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useCampaigns')>('../hooks/useCampaigns');
  return {
    ...actual,
    useCampaignRecipients: useCampaignRecipientsMock,
    fetchAllCampaignRecipients: fetchAllMock,
  };
});

import { RecipientDrawer, recipientRowsToCSV } from './RecipientDrawer';

function wrap(node: React.ReactNode) {
  return <I18nextProvider i18n={i18n}>{node}</I18nextProvider>;
}

describe('recipientRowsToCSV', () => {
  it('emits a header row and one data row per recipient', () => {
    const csv = recipientRowsToCSV([makeRow(), makeRow({ id: 'r2', email_lower: 'bob@example.com' })]);
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^email_lower,display_name,company/);
  });

  it('escapes embedded commas and double-quotes', () => {
    const csv = recipientRowsToCSV([makeRow()]);
    expect(csv).toContain('"ACME, ""Athens"""');
  });

  it('includes the failure reason and suppression reason columns', () => {
    const csv = recipientRowsToCSV([
      makeRow({ id: 'r3', status: 'failed', error: 'bounced hard' }),
      makeRow({ id: 'r4', status: 'suppressed', suppression_reason: 'opted_out' }),
    ]);
    expect(csv).toContain('bounced hard');
    expect(csv).toContain('opted_out');
  });
});

describe('RecipientDrawer', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('el');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useCampaignRecipientsMock.mockReturnValue({ data: { rows: [], count: 0 }, isLoading: false });
    fetchAllMock.mockResolvedValue([]);
  });

  // --- C-1 regression: the ledger item the reviewer upgraded — the drawer's
  // status-filter/count wiring was previously verified only by types, and
  // that is exactly the gap that let the 1,000-row PostgREST truncation
  // through undetected. This pins the count against a >1,000-row fixture. ---

  it('shows the server-side total recipient count, not just the size of the one loaded page — the exact gap that let C-1 through', () => {
    const page = Array.from({ length: 100 }, (_, i) => makeRow({ id: `r${i}`, email_lower: `p${i}@example.com` }));
    useCampaignRecipientsMock.mockReturnValue({ data: { rows: page, count: 4312 }, isLoading: false });

    render(wrap(<RecipientDrawer open campaignId="camp-1" campaignName="Καμπάνια Χ" onClose={() => {}} />));

    // The header count must read the true 4,312 total, never the 100 rows
    // that happen to be loaded on the current page.
    expect(screen.getByText('4312 παραλήπτες')).toBeInTheDocument();
    expect(screen.queryByText('100 παραλήπτες')).not.toBeInTheDocument();
    // The list itself renders only the one loaded page — never all 4,312 at
    // once, and never silently capped without the drawer knowing it.
    expect(screen.getAllByText(/@example\.com/)).toHaveLength(100);
  });

  it('passes the selected status filter and resets to page 0 through to the paged query — never fetches then filters client-side', () => {
    render(wrap(<RecipientDrawer open campaignId="camp-1" campaignName="X" onClose={() => {}} />));

    fireEvent.click(screen.getByRole('button', { name: 'Στάλθηκε' }));

    expect(useCampaignRecipientsMock).toHaveBeenLastCalledWith('camp-1', 'sent', 0);
  });

  it('advances to the next server-side page via .range(), not a client-side slice', () => {
    const page0 = Array.from({ length: 100 }, (_, i) => makeRow({ id: `p0-${i}` }));
    useCampaignRecipientsMock.mockReturnValue({ data: { rows: page0, count: 250 }, isLoading: false });
    render(wrap(<RecipientDrawer open campaignId="camp-1" campaignName="X" onClose={() => {}} />));

    expect(screen.getByText('1–100 από 250')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Επόμενη' }));

    expect(useCampaignRecipientsMock).toHaveBeenLastCalledWith('camp-1', undefined, 1);
  });

  it('drains every page for the CSV export — never just the one page on screen', async () => {
    useCampaignRecipientsMock.mockReturnValue({ data: { rows: [makeRow()], count: 4312 }, isLoading: false });
    const allRows = Array.from({ length: 4312 }, (_, i) => makeRow({ id: `r${i}` }));
    fetchAllMock.mockResolvedValue(allRows);
    render(wrap(<RecipientDrawer open campaignId="camp-1" campaignName="X" onClose={() => {}} />));

    fireEvent.click(screen.getByRole('button', { name: /Εξαγωγή CSV/ }));

    await waitFor(() =>
      expect(fetchAllMock).toHaveBeenCalledWith('camp-1', undefined, expect.any(Function)),
    );
  });

  it('shows export progress instead of a frozen button while the CSV drain is in flight', async () => {
    useCampaignRecipientsMock.mockReturnValue({ data: { rows: [makeRow()], count: 4312 }, isLoading: false });
    let resolveExport!: (rows: CampaignRecipientRow[]) => void;
    fetchAllMock.mockImplementation(
      (_id: string, _filter: CampaignRecipientStatus | undefined, onProgress?: (done: number, total: number) => void) =>
        new Promise<CampaignRecipientRow[]>((resolve) => {
          onProgress?.(1000, 4312);
          resolveExport = resolve;
        }),
    );
    render(wrap(<RecipientDrawer open campaignId="camp-1" campaignName="X" onClose={() => {}} />));

    fireEvent.click(screen.getByRole('button', { name: /Εξαγωγή CSV/ }));

    expect(await screen.findByText('Εξαγωγή… 1000 από 4312')).toBeInTheDocument();

    resolveExport([]);
    await waitFor(() => expect(screen.getByRole('button', { name: /Εξαγωγή CSV/ })).toBeInTheDocument());
  });

  it('disables the export button when there are zero recipients', () => {
    useCampaignRecipientsMock.mockReturnValue({ data: { rows: [], count: 0 }, isLoading: false });
    render(wrap(<RecipientDrawer open campaignId="camp-1" campaignName="X" onClose={() => {}} />));

    expect(screen.getByRole('button', { name: /Εξαγωγή CSV/ })).toBeDisabled();
  });
});
