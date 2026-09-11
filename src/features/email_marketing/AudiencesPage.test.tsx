import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import '@/lib/i18n';
import { i18n } from '@/lib/i18n';
import { I18nextProvider } from 'react-i18next';
import type { AudienceRow } from './hooks/useAudiences';
import type { EmailMarketingSettingsRow } from './hooks/useCampaigns';

const { deleteMutateAsync, updateSettingsMutateAsync } = vi.hoisted(() => ({
  deleteMutateAsync: vi.fn(),
  updateSettingsMutateAsync: vi.fn(),
}));

function makeAudience(overrides: Partial<AudienceRow> = {}): AudienceRow {
  return {
    id: 'aud-1',
    name: 'Πελάτες 2025',
    kind: 'import',
    source_file: 'clients-2025.xlsx',
    consent_basis: 'existing_customer',
    source_note: 'Λίστα εξαγωγής CRM',
    row_count: 812,
    created_by: null,
    created_at: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

let audiencesData: AudienceRow[] = [makeAudience()];

let settingsData: EmailMarketingSettingsRow = {
  paused: false,
  daily_cap: 500,
  hourly_cap: 200,
  batch_slice: 300,
  warmup_ladder: [500, 1000],
  warmup_started_on: null,
    max_bounce_rate: 0.04,
};

vi.mock('./hooks/useAudiences', async () => {
  const actual = await vi.importActual<typeof import('./hooks/useAudiences')>('./hooks/useAudiences');
  return {
    ...actual,
    useAudiences: () => ({ data: audiencesData, isLoading: false, error: null }),
    useDeleteAudience: () => ({ mutateAsync: deleteMutateAsync, isPending: false }),
  };
});

vi.mock('./hooks/useCampaigns', async () => {
  const actual = await vi.importActual<typeof import('./hooks/useCampaigns')>('./hooks/useCampaigns');
  return {
    ...actual,
    useEmailMarketingSettings: () => ({ data: settingsData, isLoading: false }),
  };
});

vi.mock('./hooks/useCampaignMutations', async () => {
  const actual = await vi.importActual<typeof import('./hooks/useCampaignMutations')>(
    './hooks/useCampaignMutations',
  );
  return {
    ...actual,
    useUpdateMarketingSettings: () => ({ mutateAsync: updateSettingsMutateAsync, isPending: false }),
  };
});

import { AudiencesPage } from './AudiencesPage';

function wrap(node: React.ReactNode) {
  return <I18nextProvider i18n={i18n}>{node}</I18nextProvider>;
}

describe('AudiencesPage', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('el');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    audiencesData = [makeAudience()];
    settingsData = {
      paused: false,
      daily_cap: 500,
      hourly_cap: 200,
      batch_slice: 300,
      warmup_ladder: [500, 1000],
      warmup_started_on: null,
    max_bounce_rate: 0.04,
    };
  });

  // --- audience_delete's in_use guard reads as a Greek sentence, not a code -

  it('renders the explanatory sentence (not the raw "in_use" code) when deletion is blocked by a campaign reference', async () => {
    deleteMutateAsync.mockRejectedValueOnce(new Error('in_use'));
    render(wrap(<AudiencesPage />));

    fireEvent.click(screen.getByRole('button', { name: 'Διαγραφή' }));
    const confirmButtons = screen.getAllByRole('button', { name: 'Διαγραφή' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

    await waitFor(() => expect(deleteMutateAsync).toHaveBeenCalledWith('aud-1'));
    // getAllByText, not getByText: the message is deliberately shown twice
    // while the dialog is still open — once inside the dialog's own
    // description (replacing the static "cannot be undone" copy, so it's
    // visible at the moment of failure instead of hidden behind the modal
    // overlay) and once in the page body (so it survives once the dialog is
    // later closed).
    const explanation = await screen.findAllByText(
      'Αυτή η λίστα είναι συνδεδεμένη με μια καμπάνια — πρέπει πρώτα να αποσυνδεθεί από εκείνη την καμπάνια πριν διαγραφεί.',
    );
    expect(explanation.length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('in_use')).not.toBeInTheDocument();
  });

  it('keeps the failure message visible after the dialog is closed, instead of clearing it', async () => {
    deleteMutateAsync.mockRejectedValueOnce(new Error('in_use'));
    render(wrap(<AudiencesPage />));

    fireEvent.click(screen.getByRole('button', { name: 'Διαγραφή' }));
    const confirmButtons = screen.getAllByRole('button', { name: 'Διαγραφή' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);
    await waitFor(() => expect(deleteMutateAsync).toHaveBeenCalledWith('aud-1'));
    await screen.findAllByText(/συνδεδεμένη με μια καμπάνια/);

    // Cancel/close the still-open confirm dialog.
    fireEvent.click(screen.getByRole('button', { name: 'Άκυρο' }));

    // The explanatory sentence must still be there — Task 3's
    // StepAudience.tsx pattern this now matches deliberately does not clear
    // the error on close, precisely so it isn't wiped in the same state
    // update that would have revealed it.
    expect(screen.getByText(/συνδεδεμένη με μια καμπάνια/)).toBeInTheDocument();
  });

  it('does not fire audience_delete on the first click — only the confirm dialog opens', () => {
    render(wrap(<AudiencesPage />));

    fireEvent.click(screen.getByRole('button', { name: 'Διαγραφή' }));

    expect(deleteMutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText('Διαγραφή της λίστας «Πελάτες 2025»;')).toBeInTheDocument();
  });

  // --- The global kill switch --------------------------------------------------

  it('reflects the live "paused" value from settings', () => {
    settingsData = { ...settingsData, paused: true };
    render(wrap(<AudiencesPage />));

    const toggle = screen.getByRole('checkbox', { name: /Παύση όλων των καμπανιών/ });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  it('calls marketing_settings_update with {paused: true} when the kill switch is toggled on', async () => {
    settingsData = { ...settingsData, paused: false };
    updateSettingsMutateAsync.mockResolvedValueOnce({ ok: true });
    render(wrap(<AudiencesPage />));

    const toggle = screen.getByRole('checkbox', { name: /Παύση όλων των καμπανιών/ });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);

    await waitFor(() => expect(updateSettingsMutateAsync).toHaveBeenCalledWith({ paused: true }));
  });
});
