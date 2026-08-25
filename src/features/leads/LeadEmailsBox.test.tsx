import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LeadEmailsBox } from './LeadEmailsBox';

const useLeadEmails = vi.fn();
vi.mock('./hooks/useLeadEmails', () => ({
  useLeadEmails: () => useLeadEmails(),
}));

const row = (over: Record<string, unknown>) => ({
  id: crypto.randomUUID(),
  to_email: 'lead@example.com',
  template_key: 'lead_welcome',
  status: 'delivered',
  delivered_at: '2026-08-25T10:00:00Z',
  bounced_at: null,
  error: null,
  created_at: '2026-08-25T09:59:00Z',
  dedupe_key: 'lead_welcome:x',
  ...over,
});

describe('LeadEmailsBox', () => {
  it('renders counts and one dot per status color', () => {
    useLeadEmails.mockReturnValue({
      data: [
        row({}),
        row({ template_key: 'noanswer_day0', status: 'sent', delivered_at: null }),
        row({ template_key: 'offer_followup_day2', status: 'bounced', delivered_at: null, bounced_at: '2026-08-25T10:01:00Z', error: 'mailbox full' }),
      ],
      isLoading: false,
    });
    const { container } = render(<LeadEmailsBox leadId="lead-1" />);
    expect(screen.getByText('Emails (3)')).toBeInTheDocument();
    expect(screen.getByText('Lead welcome email')).toBeInTheDocument();
    expect(screen.getByText('No-answer follow-up')).toBeInTheDocument();
    expect(screen.getByText('Offer follow-up')).toBeInTheDocument();
    expect(container.querySelectorAll('li .bg-emerald-500')).toHaveLength(1);
    expect(container.querySelectorAll('li .bg-amber-400')).toHaveLength(1);
    expect(container.querySelectorAll('li .bg-red-500')).toHaveLength(1);
  });

  it('shows the empty state', () => {
    useLeadEmails.mockReturnValue({ data: [], isLoading: false });
    render(<LeadEmailsBox leadId="lead-1" />);
    expect(screen.getByText('No emails sent for this lead yet.')).toBeInTheDocument();
  });
});
