import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { i18n } from '@/lib/i18n';

const sentMapMock = vi.fn();
vi.mock('./hooks/useSeoAccessSentMap', () => ({
  useSeoAccessSentMap: (enabled: boolean) => sentMapMock(enabled),
}));

const mutate = vi.fn();
vi.mock('./hooks/useRequestSeoAccess', () => ({
  useRequestSeoAccess: () => ({ mutate, isPending: false }),
}));

import { JobEmailStatusBadge } from './JobEmailStatusBadge';
import type { JobRow } from './hooks/useJobs';

const webSeoJob = {
  id: 'j1',
  service_type: 'web_seo',
  code: '000123-WEBSEO',
  client: { id: 'c1', name: 'ACME', email: 'a@b.com' },
  deal: { id: 'd1', code: '000123', title: null },
  parent_job_id: null,
} as unknown as JobRow;

const SENT_MAP = { 'webseo_gsc_access|a@b.com': '2026-07-01T00:00:00Z' };

function wrap(node: React.ReactNode) {
  return <I18nextProvider i18n={i18n}>{node}</I18nextProvider>;
}

describe('JobEmailStatusBadge — sent state resend (detail)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sentMapMock.mockReturnValue(SENT_MAP);
  });

  it('renders a Resend button next to the sent pill', () => {
    render(wrap(<JobEmailStatusBadge job={webSeoJob} variant="detail" />));
    expect(screen.getByText(/access email sent/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /resend/i })).toBeInTheDocument();
  });

  it('confirm flow sends with the GSC template and shows the last-sent line', async () => {
    const user = userEvent.setup();
    render(wrap(<JobEmailStatusBadge job={webSeoJob} variant="detail" />));
    await user.click(screen.getByRole('button', { name: /resend/i }));
    expect(await screen.findByText(/request gsc access/i)).toBeInTheDocument();
    expect(screen.getByText(/last sent on/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(mutate).toHaveBeenCalledWith(
      { to: 'a@b.com', code: '000123-WEBSEO', templateKey: 'webseo_gsc_access' },
      expect.anything(),
    );
  });

  it('not_sent dialog has no last-sent line', async () => {
    sentMapMock.mockReturnValue({});
    const user = userEvent.setup();
    render(wrap(<JobEmailStatusBadge job={webSeoJob} variant="detail" />));
    await user.click(screen.getByRole('button', { name: /resend/i }));
    expect(await screen.findByText(/request gsc access/i)).toBeInTheDocument();
    expect(screen.queryByText(/last sent on/i)).not.toBeInTheDocument();
  });
});
