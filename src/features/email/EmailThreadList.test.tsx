import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { EmailThread } from './hooks/useEmailThreads';

const ref: { data: EmailThread[]; isLoading: boolean } = { data: [], isLoading: false };
vi.mock('./hooks/useEmailThreads', () => ({ useEmailThreads: () => ref }));
vi.mock('./SendEmailDialog', () => ({ SendEmailDialog: () => null }));
import { EmailThreadList } from './EmailThreadList';

function thread(p: Partial<EmailThread> & Pick<EmailThread, 'key' | 'category'>): EmailThread {
  return {
    subject: p.subject ?? 'Subj',
    last_at: p.last_at ?? '2026-07-09T10:00:00Z',
    messages: p.messages ?? [
      {
        id: `${p.key}-m1`,
        message_id: `${p.key}-x`,
        thread_id: p.key,
        direction: 'inbound',
        from_email: 'a@x.gr',
        from_name: 'A',
        to_email: 'me@itdev.gr',
        subject: p.subject ?? 'Subj',
        body_text: `body of ${p.key}`,
        snippet: null,
        sent_at: '2026-07-09T10:00:00Z',
        department: null,
        job_id: null,
        lead_id: null,
      },
    ],
    ...p,
  };
}

describe('EmailThreadList', () => {
  it('shows an empty state when there are no threads', () => {
    ref.data = [];
    ref.isLoading = false;
    render(<EmailThreadList scope={{ deal_id: 'd1' }} clientEmail="c@x.gr" />);
    expect(screen.getByText(/no client emails/i)).toBeInTheDocument();
  });

  it('renders category headers with thread counts', () => {
    ref.data = [
      thread({ key: 's1', category: 'sales', subject: 'Prospect chat' }),
      thread({ key: 't1', category: 'technical', subject: 'Re: 000280-WEBDEV' }),
      thread({ key: 't2', category: 'technical', subject: 'Re: 005188-WEBDEV' }),
    ];
    ref.isLoading = false;
    render(<EmailThreadList scope={{ client_id: 'c1' }} clientEmail="c@x.gr" />);
    expect(screen.getByRole('button', { name: /sales \(1\)/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /accounting \(0\)/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /technical \(2\)/i })).toBeInTheDocument();
  });

  it('starts non-empty sections expanded and empty ones collapsed', () => {
    ref.data = [thread({ key: 's1', category: 'sales', subject: 'Prospect chat' })];
    ref.isLoading = false;
    render(<EmailThreadList scope={{ lead_id: 'l1' }} clientEmail="c@x.gr" />);
    expect(screen.getByText('Prospect chat')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sales \(1\)/i })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /accounting \(0\)/i })).toHaveAttribute('aria-expanded', 'false');
  });

  it('clicking a header collapses and re-expands its section', () => {
    ref.data = [thread({ key: 's1', category: 'sales', subject: 'Prospect chat' })];
    ref.isLoading = false;
    render(<EmailThreadList scope={{ lead_id: 'l1' }} clientEmail="c@x.gr" />);
    const header = screen.getByRole('button', { name: /sales \(1\)/i });
    fireEvent.click(header);
    expect(screen.queryByText('Prospect chat')).not.toBeInTheDocument();
    fireEvent.click(header);
    expect(screen.getByText('Prospect chat')).toBeInTheDocument();
  });
});
