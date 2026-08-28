import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { JobEmailRow } from './hooks/useJobEmails';

const ref: { rows: JobEmailRow[]; isLoading: boolean } = { rows: [], isLoading: false };
vi.mock('./hooks/useJobEmails', () => ({
  useJobEmails: () => ({ data: ref.rows, isLoading: ref.isLoading }),
}));

import { JobEmailsBox } from './JobEmailsBox';

function row(p: Partial<JobEmailRow>): JobEmailRow {
  return {
    id: p.id ?? 'e1',
    to_email: p.to_email ?? 'a@b.gr',
    template_key: p.template_key ?? 'webdev_client_form',
    status: p.status ?? 'delivered',
    delivered_at: p.delivered_at ?? null,
    bounced_at: p.bounced_at ?? null,
    error: p.error ?? null,
    created_at: p.created_at ?? '2026-08-27T00:00:00Z',
    dedupe_key: p.dedupe_key ?? 'webdev_form_auto:j',
  };
}

describe('JobEmailsBox', () => {
  beforeEach(() => { ref.rows = []; ref.isLoading = false; });

  it('shows the count header, per-email rows, and one dot per status color', () => {
    ref.rows = [
      row({ id: 'e1', status: 'delivered', template_key: 'webdev_client_form', to_email: 'x@y.gr' }),
      row({ id: 'e2', status: 'sent', template_key: 'webseo_gsc_followup' }),
      row({ id: 'e3', status: 'bounced', template_key: 'payment_overdue' }),
    ];
    const { container } = render(<JobEmailsBox jobId="j1" clientId="c1" />);
    expect(screen.getByText('Emails (3)')).toBeInTheDocument();
    expect(screen.getByText('Web Dev – client intake form')).toBeInTheDocument();
    expect(screen.getByText('Web SEO – GSC access follow-up')).toBeInTheDocument();
    expect(screen.getByText('x@y.gr')).toBeInTheDocument();
    expect(container.querySelectorAll('.bg-emerald-500').length).toBeGreaterThanOrEqual(1);
    expect(container.querySelectorAll('.bg-amber-400').length).toBeGreaterThanOrEqual(1);
    expect(container.querySelectorAll('.bg-red-500').length).toBeGreaterThanOrEqual(1);
  });

  it('renders the empty state when there are no emails', () => {
    ref.rows = [];
    render(<JobEmailsBox jobId="j1" clientId="c1" />);
    expect(screen.getByText(/no emails sent for this job yet/i)).toBeInTheDocument();
  });
});
