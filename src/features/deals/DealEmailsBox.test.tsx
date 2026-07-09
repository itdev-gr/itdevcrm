import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { DealEmailRow } from './hooks/useDealEmails';

const ref: { rows: DealEmailRow[]; isLoading: boolean } = { rows: [], isLoading: false };
vi.mock('./hooks/useDealEmails', () => ({
  useDealEmails: () => ({ data: ref.rows, isLoading: ref.isLoading }),
}));

import { DealEmailsBox } from './DealEmailsBox';

function row(p: Partial<DealEmailRow>): DealEmailRow {
  return {
    id: p.id ?? 'e1',
    to_email: p.to_email ?? 'a@b.gr',
    template_key: p.template_key ?? 'localseo_gbp_access',
    status: p.status ?? 'delivered',
    delivered_at: p.delivered_at ?? null,
    bounced_at: p.bounced_at ?? null,
    error: p.error ?? null,
    created_at: p.created_at ?? '2026-07-09T00:00:00Z',
    dedupe_key: p.dedupe_key ?? 'localseo_gbp:d',
  };
}

describe('DealEmailsBox', () => {
  beforeEach(() => { ref.rows = []; ref.isLoading = false; });

  it('shows the count header, per-email rows, and one dot per status color', () => {
    ref.rows = [
      row({ id: 'e1', status: 'delivered', template_key: 'localseo_gbp_access', to_email: 'x@y.gr' }),
      row({ id: 'e2', status: 'sent', template_key: 'webseo_gsc_access' }),
      row({ id: 'e3', status: 'bounced', template_key: 'payment_overdue' }),
    ];
    const { container } = render(<DealEmailsBox dealId="d1" clientId="c1" />);
    expect(screen.getByText('Emails (3)')).toBeInTheDocument();
    expect(screen.getByText('Local SEO – GBP access request')).toBeInTheDocument();
    expect(screen.getByText('x@y.gr')).toBeInTheDocument();
    expect(container.querySelectorAll('.bg-emerald-500').length).toBeGreaterThanOrEqual(1);
    expect(container.querySelectorAll('.bg-amber-400').length).toBeGreaterThanOrEqual(1);
    expect(container.querySelectorAll('.bg-red-500').length).toBeGreaterThanOrEqual(1);
  });

  it('renders the empty state when there are no emails', () => {
    ref.rows = [];
    render(<DealEmailsBox dealId="d1" clientId="c1" />);
    expect(screen.getByText(/no emails sent for this deal yet/i)).toBeInTheDocument();
  });
});
