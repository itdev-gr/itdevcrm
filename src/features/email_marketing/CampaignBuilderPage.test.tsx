import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { vi, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import '@/lib/i18n';
import { i18n } from '@/lib/i18n';
import { I18nextProvider } from 'react-i18next';
import type { CampaignRow } from './hooks/useCampaigns';

const { createMutate } = vi.hoisted(() => ({ createMutate: vi.fn() }));

const campaign: CampaignRow = {
  id: 'camp-1',
  name: 'Δοκιμαστική καμπάνια',
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

vi.mock('./hooks/useCampaigns', async () => {
  const actual = await vi.importActual<typeof import('./hooks/useCampaigns')>('./hooks/useCampaigns');
  return { ...actual, useCampaign: () => ({ data: campaign }) };
});
vi.mock('./hooks/useCampaignMutations', async () => {
  const actual = await vi.importActual<typeof import('./hooks/useCampaignMutations')>(
    './hooks/useCampaignMutations',
  );
  return { ...actual, useCreateCampaign: () => ({ mutate: createMutate, isPending: false }) };
});
vi.mock('./steps/StepContent', () => ({
  StepContent: ({ campaignId }: { campaignId: string }) => <div data-testid="step-content">{campaignId}</div>,
}));
vi.mock('./steps/StepAudience', () => ({
  StepAudience: ({ campaignId }: { campaignId: string }) => <div data-testid="step-audience">{campaignId}</div>,
}));

import { CampaignBuilderPage } from './CampaignBuilderPage';

function renderAt(path: string) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/company/email-marketing/new" element={<CampaignBuilderPage />} />
          <Route path="/company/email-marketing/:campaignId/edit" element={<CampaignBuilderPage />} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('CampaignBuilderPage', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('el');
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a campaign immediately on /new and defers to campaign_create — never a direct table write', () => {
    createMutate.mockImplementation((_input, opts) => opts.onSuccess({ campaign_id: 'camp-1' }));
    renderAt('/company/email-marketing/new');

    expect(createMutate).toHaveBeenCalledTimes(1);
    // After the create→navigate, the edit route renders step 1 with the real id.
    expect(screen.getByTestId('step-content')).toHaveTextContent('camp-1');
  });

  it('renders step 1 (content) by default on the edit route and switches to step 2 on click', () => {
    renderAt('/company/email-marketing/camp-1/edit');

    expect(screen.getByTestId('step-content')).toBeInTheDocument();
    expect(screen.queryByTestId('step-audience')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '2. Παραλήπτες' }));

    expect(screen.getByTestId('step-audience')).toBeInTheDocument();
    expect(screen.queryByTestId('step-content')).not.toBeInTheDocument();
  });

  it('keeps steps 3-4 as navigable placeholders, not implemented', () => {
    renderAt('/company/email-marketing/camp-1/edit');

    fireEvent.click(screen.getByRole('button', { name: '3. Έλεγχος' }));
    expect(screen.getByText('Ο έλεγχος παραληπτών και το δοκιμαστικό email έρχονται σύντομα.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '4. Πρόγραμμα' }));
    expect(screen.getByText('Ο προγραμματισμός και η εκκίνηση έρχονται σύντομα.')).toBeInTheDocument();
  });
});
