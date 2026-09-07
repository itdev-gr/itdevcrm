import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import '@/lib/i18n';
import { i18n } from '@/lib/i18n';
import { I18nextProvider } from 'react-i18next';
import type { ImportedLeadRow } from '@/features/leads/leadImport';

const { parseLeadFile } = vi.hoisted(() => ({ parseLeadFile: vi.fn() }));
vi.mock('@/features/leads/leadImport', async () => {
  const actual = await vi.importActual<typeof import('@/features/leads/leadImport')>(
    '@/features/leads/leadImport',
  );
  return { ...actual, parseLeadFile };
});

const { createMutateAsync, addMembersMutateAsync, attachMutateAsync } = vi.hoisted(() => ({
  createMutateAsync: vi.fn(),
  addMembersMutateAsync: vi.fn(),
  attachMutateAsync: vi.fn(),
}));
vi.mock('../hooks/useAudiences', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useAudiences')>('../hooks/useAudiences');
  return {
    ...actual,
    useCreateAudience: () => ({ mutateAsync: createMutateAsync, isPending: false }),
    useAddAudienceMembers: () => ({ mutateAsync: addMembersMutateAsync, isPending: false }),
  };
});
vi.mock('../hooks/useCampaignMutations', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useCampaignMutations')>(
    '../hooks/useCampaignMutations',
  );
  return {
    ...actual,
    useAttachAudience: () => ({ mutateAsync: attachMutateAsync, isPending: false }),
  };
});

import { ImportAudienceDialog } from './ImportAudienceDialog';

function wrap(node: React.ReactNode) {
  return <I18nextProvider i18n={i18n}>{node}</I18nextProvider>;
}

function makeRows(n: number): ImportedLeadRow[] {
  return Array.from({ length: n }, (_, i) => ({
    full_name: `Lead ${i}`,
    email: `lead${i}@example.com`,
    phone: null,
    company: null,
    website: null,
    notes: null,
    source_data: {},
  }));
}

async function selectFile(rows: ImportedLeadRow[]) {
  parseLeadFile.mockResolvedValueOnce({ rows, skipped: 0, dropped: 0 });
  const file = new File(['x'], 'leads.xlsx');
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(screen.getByText(/leads\.xlsx/)).toBeInTheDocument());
}

async function chooseConsentBasis(label: string) {
  const user = userEvent.setup();
  const trigger = screen.getByRole('combobox', { name: /Βάση συναίνεσης/i });
  await user.click(trigger);
  const option = await screen.findByRole('option', { name: label });
  await user.click(option);
}

describe('ImportAudienceDialog', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('el');
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('disables the import button until a consent basis is chosen', async () => {
    render(wrap(<ImportAudienceDialog campaignId="camp-1" open onOpenChange={() => {}} />));
    await selectFile(makeRows(3));

    expect(screen.getByRole('button', { name: 'Εισαγωγή' })).toBeDisabled();

    await chooseConsentBasis('Υπάρχων πελάτης');

    await waitFor(() => expect(screen.getByRole('button', { name: 'Εισαγωγή' })).not.toBeDisabled());
  });

  it('shows only the first 10 parsed rows in the preview table', async () => {
    render(wrap(<ImportAudienceDialog campaignId="camp-1" open onOpenChange={() => {}} />));
    await selectFile(makeRows(15));

    expect(screen.getByText('lead0@example.com')).toBeInTheDocument();
    expect(screen.getByText('lead9@example.com')).toBeInTheDocument();
    expect(screen.queryByText('lead10@example.com')).not.toBeInTheDocument();
    expect(screen.queryByText('lead14@example.com')).not.toBeInTheDocument();
  });

  it('splits a 1,200-row import into 3 batches of at most 500 and sums the server report', async () => {
    createMutateAsync.mockResolvedValue({ ok: true, audience_id: 'aud-1' });
    addMembersMutateAsync
      .mockResolvedValueOnce({ ok: true, added: 400, invalid: 70, duplicate: 30 })
      .mockResolvedValueOnce({ ok: true, added: 380, invalid: 90, duplicate: 30 })
      .mockResolvedValueOnce({ ok: true, added: 150, invalid: 40, duplicate: 10 });
    attachMutateAsync.mockResolvedValue({ ok: true, campaign_id: 'camp-1', audience_id: 'aud-1' });

    render(wrap(<ImportAudienceDialog campaignId="camp-1" open onOpenChange={() => {}} />));
    await selectFile(makeRows(1200));
    await chooseConsentBasis('Υπάρχων πελάτης');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Εισαγωγή' }));

    await waitFor(() => expect(attachMutateAsync).toHaveBeenCalled());

    expect(addMembersMutateAsync).toHaveBeenCalledTimes(3);
    const batchSizes = addMembersMutateAsync.mock.calls.map(
      (call) => (call[0] as { rows: unknown[] }).rows.length,
    );
    expect(batchSizes).toEqual([500, 500, 200]);

    // The displayed report is the SUMMED server tally (400+380+150=930,
    // 70+90+40=200, 30+30+10=70) — not the file's 1200-row count, and not
    // just the last batch's numbers.
    expect(
      await screen.findByText('Μπήκαν 930, άκυρες 200, διπλές 70.'),
    ).toBeInTheDocument();
  });

  it('attaches the newly created audience to the campaign on success', async () => {
    createMutateAsync.mockResolvedValue({ ok: true, audience_id: 'aud-9' });
    addMembersMutateAsync.mockResolvedValue({ ok: true, added: 2, invalid: 0, duplicate: 0 });
    attachMutateAsync.mockResolvedValue({ ok: true, campaign_id: 'camp-1', audience_id: 'aud-9' });

    render(wrap(<ImportAudienceDialog campaignId="camp-1" open onOpenChange={() => {}} />));
    await selectFile(makeRows(2));
    await chooseConsentBasis('Υπάρχων πελάτης');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Εισαγωγή' }));

    await waitFor(() =>
      expect(attachMutateAsync).toHaveBeenCalledWith({ campaignId: 'camp-1', audienceId: 'aud-9' }),
    );
  });
});
