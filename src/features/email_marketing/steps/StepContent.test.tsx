import { render, screen, fireEvent } from '@testing-library/react';
import { vi, beforeAll, beforeEach, afterEach, describe, it, expect } from 'vitest';
import '@/lib/i18n';
import { i18n } from '@/lib/i18n';
import { I18nextProvider } from 'react-i18next';
import type { CampaignRow } from '../hooks/useCampaigns';

const { updateMutate } = vi.hoisted(() => ({ updateMutate: vi.fn() }));

const campaign: CampaignRow = {
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
});
