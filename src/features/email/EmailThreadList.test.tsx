import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { EmailThread } from './hooks/useEmailThreads';

const ref: { data: EmailThread[]; isLoading: boolean } = { data: [], isLoading: false };
let dialogProps: Record<string, unknown> | null = null;
vi.mock('./hooks/useEmailThreads', () => ({ useEmailThreads: () => ref }));
vi.mock('./SendEmailDialog', () => ({
  SendEmailDialog: (props: Record<string, unknown>) => {
    dialogProps = props;
    return null;
  },
}));
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
  beforeEach(() => {
    dialogProps = null;
  });

  it('shows an empty state when there are no threads', () => {
    ref.data = [];
    ref.isLoading = false;
    render(<EmailThreadList scope={{ deal_id: 'd1' }} clientEmail="c@x.gr" />);
    expect(screen.getByText(/no client emails/i)).toBeInTheDocument();
  });

  it('shows a New email button in the empty state', () => {
    ref.data = [];
    ref.isLoading = false;
    render(<EmailThreadList scope={{ deal_id: 'd1' }} clientEmail="c@x.gr" />);
    expect(screen.getByText(/no client emails/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new email/i })).toBeInTheDocument();
  });

  it('composes a new email prefilled with clientEmail and the newEmailSubject prefix', () => {
    ref.data = [thread({ key: 's1', category: 'sales', subject: 'Prospect chat' })];
    ref.isLoading = false;
    render(
      <EmailThreadList
        scope={{ job_id: 'j1' }}
        clientEmail="c@x.gr"
        newEmailSubject="000280-WEBDEV - "
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /new email/i }));
    expect(dialogProps).toMatchObject({ to: 'c@x.gr', subject: '000280-WEBDEV - ' });
  });

  it('composes a new email with an empty subject when no prefix is provided', () => {
    ref.data = [thread({ key: 's1', category: 'sales', subject: 'Prospect chat' })];
    ref.isLoading = false;
    render(<EmailThreadList scope={{ deal_id: 'd1' }} clientEmail="c@x.gr" />);
    fireEvent.click(screen.getByRole('button', { name: /new email/i }));
    expect(dialogProps).toMatchObject({ to: 'c@x.gr', subject: '' });
  });

  it('replying prefills a Re: subject without doubling the prefix', () => {
    ref.data = [thread({ key: 't1', category: 'technical', subject: 'Re: 000280-WEBDEV' })];
    ref.isLoading = false;
    render(<EmailThreadList scope={{ job_id: 'j1' }} clientEmail="c@x.gr" />);
    fireEvent.click(screen.getByRole('button', { name: /reply/i }));
    expect(dialogProps).toMatchObject({ to: 'a@x.gr', subject: 'Re: 000280-WEBDEV' });
  });

  it('replying defaults to the inbound sender when clientEmail is blank', () => {
    ref.data = [
      thread({
        key: 'i1',
        category: 'sales',
        subject: 'Hello',
        messages: [
          {
            id: 'i1-m1',
            message_id: 'i1-x',
            thread_id: 'i1',
            direction: 'inbound',
            from_email: 'client@x.gr',
            from_name: 'Client',
            to_email: 'me@itdev.gr',
            subject: 'Hello',
            body_text: 'hi',
            snippet: null,
            sent_at: '2026-07-09T10:00:00Z',
            department: null,
            job_id: null,
            lead_id: null,
          },
        ],
      }),
    ];
    ref.isLoading = false;
    render(<EmailThreadList scope={{ job_id: 'j1' }} clientEmail="" />);
    fireEvent.click(screen.getByRole('button', { name: /reply/i }));
    expect(dialogProps).toMatchObject({ to: 'client@x.gr' });
  });

  it('replying defaults to the outbound recipient when clientEmail is blank', () => {
    ref.data = [
      thread({
        key: 'o1',
        category: 'sales',
        subject: 'Hello',
        messages: [
          {
            id: 'o1-m1',
            message_id: 'o1-x',
            thread_id: 'o1',
            direction: 'outbound',
            from_email: 'me@itdev.gr',
            from_name: 'Me',
            to_email: 'client@y.gr',
            subject: 'Hello',
            body_text: 'hi',
            snippet: null,
            sent_at: '2026-07-09T10:00:00Z',
            department: null,
            job_id: null,
            lead_id: null,
          },
        ],
      }),
    ];
    ref.isLoading = false;
    render(<EmailThreadList scope={{ job_id: 'j1' }} clientEmail="" />);
    fireEvent.click(screen.getByRole('button', { name: /reply/i }));
    expect(dialogProps).toMatchObject({ to: 'client@y.gr' });
  });

  it('does not mount the send dialog until a draft is started', () => {
    ref.data = [thread({ key: 's1', category: 'sales', subject: 'Prospect chat' })];
    ref.isLoading = false;
    render(<EmailThreadList scope={{ deal_id: 'd1' }} clientEmail="c@x.gr" />);
    expect(dialogProps).toBeNull();
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

  it('renders threads collapsed by default', () => {
    ref.data = [thread({ key: 's1', category: 'sales', subject: 'Prospect chat' })];
    ref.isLoading = false;
    render(<EmailThreadList scope={{ lead_id: 'l1' }} clientEmail="c@x.gr" />);
    expect(screen.getByText('Prospect chat')).toBeInTheDocument();
    expect(screen.queryByText('body of s1')).not.toBeInTheDocument();
  });

  it('clicking a thread header shows and hides its messages', () => {
    ref.data = [thread({ key: 's1', category: 'sales', subject: 'Prospect chat' })];
    ref.isLoading = false;
    render(<EmailThreadList scope={{ lead_id: 'l1' }} clientEmail="c@x.gr" />);
    const header = screen.getByRole('button', { name: /prospect chat/i });
    fireEvent.click(header);
    expect(screen.getByText('body of s1')).toBeInTheDocument();
    fireEvent.click(header);
    expect(screen.queryByText('body of s1')).not.toBeInTheDocument();
  });

  it('replying on a collapsed thread opens the dialog without expanding it', () => {
    ref.data = [thread({ key: 't1', category: 'technical', subject: 'Re: 000280-WEBDEV' })];
    ref.isLoading = false;
    render(<EmailThreadList scope={{ job_id: 'j1' }} clientEmail="c@x.gr" />);
    fireEvent.click(screen.getByRole('button', { name: /reply/i }));
    expect(dialogProps).toMatchObject({ to: 'a@x.gr', subject: 'Re: 000280-WEBDEV' });
    expect(screen.queryByText('body of t1')).not.toBeInTheDocument();
  });
});
