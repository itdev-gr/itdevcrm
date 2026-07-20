import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { i18n } from '@/lib/i18n';

const mutateAsync = vi.fn().mockResolvedValue('job-1');
vi.mock('./hooks/useCustomJobMutations', () => ({
  useAddWebsiteJob: () => ({ mutateAsync, isPending: false }),
}));

import { AddWebsiteForm } from './AddWebsiteForm';

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </QueryClientProvider>
  );
}

describe('AddWebsiteForm', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps submit disabled until a website URL is entered', async () => {
    const user = userEvent.setup();
    render(wrap(<AddWebsiteForm dealId="d1" />));
    const submit = screen.getByRole('button', { name: /add website/i });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText(/website url/i), 'https://example.com');
    expect(submit).toBeEnabled();
  });

  it('submits the website (industry optional) via add_web_dev_job', async () => {
    const user = userEvent.setup();
    render(wrap(<AddWebsiteForm dealId="d1" />));
    await user.type(screen.getByLabelText(/website url/i), '  https://example.com ');
    await user.click(screen.getByRole('button', { name: /add website/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({ website: 'https://example.com', industry: null });
  });
});
