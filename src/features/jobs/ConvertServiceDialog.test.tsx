import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? _k,
    i18n: { language: 'el' },
  }),
}));
// Ads types come from the catalogue, so a package added in /admin appears here
// without a deploy.
vi.mock('@/features/offers/hooks/useOfferCatalog', () => ({
  useOfferCatalog: () => ({
    data: [
      { id: 'p-meta', service_type: 'ads', code: 'ads-meta-ads',
        display_names: { el: 'Meta Ads', en: 'Meta Ads' } },
      { id: 'p-tiktok', service_type: 'ads', code: 'ads-tiktok-ads',
        display_names: { el: 'TikTok Ads', en: 'TikTok Ads' } },
      { id: 'p-seo', service_type: 'web_seo', code: 'seo',
        display_names: { el: 'SEO', en: 'SEO' } },
    ],
  }),
}));
const convertMutate = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'j2' }));
const billingMutate = vi.hoisted(() => vi.fn().mockResolvedValue('j2'));
vi.mock('./hooks/useConvertJobService', () => ({
  useConvertJobService: () => ({ mutateAsync: convertMutate, isPending: false }),
}));
vi.mock('@/features/deals/hooks/useCustomJobMutations', () => ({
  useUpdateJobBilling: () => ({ mutateAsync: billingMutate, isPending: false }),
}));

import { ConvertServiceDialog } from './ConvertServiceDialog';

describe('ConvertServiceDialog', () => {
  it('lists valid targets for a web_seo job', () => {
    render(
      <ConvertServiceDialog
        job={{ id: 'j1', deal_id: 'd1', service_type: 'web_seo', parent_job_id: null }}
        open
        onOpenChange={() => {}}
      />,
    );
    expect(screen.getByText('local_seo')).toBeTruthy();
    expect(screen.queryByText('web_dev')).toBeNull();
  });

  it('will not convert into ads until the ads type is chosen', async () => {
    const user = userEvent.setup();
    vi.clearAllMocks();
    render(
      <ConvertServiceDialog
        job={{ id: 'j1', deal_id: 'd1', service_type: 'social_media', parent_job_id: null }}
        open
        onOpenChange={() => {}}
      />,
    );

    await user.selectOptions(screen.getByLabelText('convert.target'), 'ads');
    const confirm = screen.getByRole('button', { name: 'convert.confirm' });
    expect(confirm).toBeDisabled();

    await user.selectOptions(screen.getByLabelText('convert.ads_type'), 'p-tiktok');
    expect(confirm).toBeEnabled();
  });

  it('names the converted job after the chosen package, without touching its price', async () => {
    const user = userEvent.setup();
    vi.clearAllMocks();
    render(
      <ConvertServiceDialog
        job={{ id: 'j1', deal_id: 'd1', service_type: 'social_media', parent_job_id: null }}
        open
        onOpenChange={() => {}}
      />,
    );

    await user.selectOptions(screen.getByLabelText('convert.target'), 'ads');
    await user.selectOptions(screen.getByLabelText('convert.ads_type'), 'p-meta');
    await user.click(screen.getByRole('button', { name: 'convert.confirm' }));

    expect(convertMutate).toHaveBeenCalledWith({ jobId: 'j1', target: 'ads' });
    // The dialog promises "amounts/payments stay the same": only the title moves.
    expect(billingMutate).toHaveBeenCalledWith({ jobId: 'j2', title: 'Meta Ads' });
  });

  it('offers no ads type when converting to something else', async () => {
    const user = userEvent.setup();
    render(
      <ConvertServiceDialog
        job={{ id: 'j1', deal_id: 'd1', service_type: 'web_seo', parent_job_id: null }}
        open
        onOpenChange={() => {}}
      />,
    );
    await user.selectOptions(screen.getByLabelText('convert.target'), 'local_seo');
    expect(screen.queryByLabelText('convert.ads_type')).toBeNull();
  });
});