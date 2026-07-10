import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { EmailThread } from './hooks/useEmailThreads';

const ref: { data: EmailThread[]; isLoading: boolean } = { data: [], isLoading: false };
vi.mock('./hooks/useEmailThreads', () => ({ useEmailThreads: () => ref }));
vi.mock('./SendEmailDialog', () => ({ SendEmailDialog: () => null }));
import { EmailThreadList } from './EmailThreadList';

describe('EmailThreadList', () => {
  it('shows an empty state when there are no threads', () => {
    ref.data = [];
    ref.isLoading = false;
    render(<EmailThreadList scope={{ deal_id: 'd1' }} clientEmail="c@x.gr" />);
    expect(screen.getByText(/no client emails/i)).toBeInTheDocument();
  });

  it('renders a thread subject and a message', () => {
    ref.data = [
      {
        key: 't1',
        subject: 'Re: 000280-WEBDEV',
        last_at: '2026-07-09T10:00:00Z',
        category: 'technical',
        messages: [
          {
            id: 'm1',
            message_id: 'x',
            thread_id: 't1',
            direction: 'inbound',
            from_email: 'a@upd8.gr',
            from_name: 'A',
            to_email: 'me@itdev.gr',
            subject: 'Re: 000280-WEBDEV',
            body_text: 'hello there',
            snippet: 'hello',
            sent_at: '2026-07-09T10:00:00Z',
            department: 'web_dev',
            job_id: 'j1',
            lead_id: null,
          },
        ],
      },
    ];
    ref.isLoading = false;
    render(<EmailThreadList scope={{ deal_id: 'd1' }} clientEmail="a@upd8.gr" />);
    expect(screen.getByText('Re: 000280-WEBDEV')).toBeInTheDocument();
    expect(screen.getByText(/hello there/)).toBeInTheDocument();
  });
});
