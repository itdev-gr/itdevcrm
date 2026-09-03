import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { InboxItem } from './hooks/useEmailInbox';

// `t` must be a STABLE reference across renders — FileEmailDialog's search
// effect depends on [q, t], so a fresh function every call reruns the effect
// every render, which always calls setResults([]) with a brand-new array
// reference (state change even though the *value* is unchanged) → infinite
// render loop. Real react-i18next keeps `t` stable; mirror that here.
const stableT = (k: string) => k;
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: stableT }),
}));

const authState = vi.hoisted(() => ({ isAdmin: false }));
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (selector: (s: { isAdmin: boolean }) => unknown) => selector(authState),
}));

const markRead = vi.fn().mockResolvedValue(undefined);
const markAllRead = vi.fn().mockResolvedValue(undefined);
const refetch = vi.fn();

const items: InboxItem[] = [
  {
    id: 'm-unfiled',
    message_id: 'mid-1',
    thread_id: null,
    direction: 'inbound',
    from_email: 'lead@example.com',
    from_name: 'Lead Person',
    to_email: 'someone@itdev.gr',
    subject: 'Unfiled subject',
    body_text: 'Hello there',
    body_html: null,
    snippet: 'Hello there',
    sent_at: '2026-09-01T10:00:00Z',
    department: 'sales',
    job_id: null,
    lead_id: null,
    cc_emails: null,
    captured_from_user_id: null,
    client_id: null,
    deal_id: null,
    unread: false,
    unfiled: true,
    mine: false,
    category: 'sales',
  },
  {
    id: 'm-mine-unread',
    message_id: 'mid-2',
    thread_id: null,
    direction: 'inbound',
    from_email: 'other@example.com',
    from_name: 'Other Person',
    to_email: 'me@itdev.gr',
    subject: 'Mine unread',
    body_text: 'Body 2',
    body_html: null,
    snippet: 'Body 2',
    sent_at: '2026-09-01T11:00:00Z',
    department: 'sales',
    job_id: null,
    lead_id: null,
    cc_emails: null,
    captured_from_user_id: null,
    client_id: null,
    deal_id: null,
    unread: true,
    unfiled: true,
    mine: true,
    category: 'sales',
  },
  {
    id: 'm-read-lead',
    message_id: 'mid-3',
    thread_id: null,
    direction: 'inbound',
    from_email: 'third@example.com',
    from_name: 'Third Person',
    to_email: 'someone@itdev.gr',
    subject: 'Read with lead',
    body_text: 'Body 3',
    body_html: null,
    snippet: 'Body 3',
    sent_at: '2026-09-01T12:00:00Z',
    department: 'sales',
    job_id: null,
    lead_id: 'lead-1',
    cc_emails: null,
    captured_from_user_id: null,
    client_id: null,
    deal_id: null,
    unread: false,
    unfiled: false,
    mine: false,
    category: 'accounting',
  },
  {
    id: 'm-read-job',
    message_id: 'mid-4',
    thread_id: null,
    direction: 'inbound',
    from_email: 'fourth@example.com',
    from_name: 'Fourth Person',
    to_email: 'someone@itdev.gr',
    subject: 'Read with job',
    body_text: 'Body 4',
    body_html: null,
    snippet: 'Body 4',
    sent_at: '2026-09-01T13:00:00Z',
    department: 'sales',
    job_id: 'job-1',
    lead_id: null,
    cc_emails: null,
    captured_from_user_id: null,
    client_id: null,
    deal_id: null,
    unread: false,
    unfiled: false,
    mine: false,
    category: 'support',
  },
  {
    id: 'm-other-admin',
    message_id: 'mid-5',
    thread_id: null,
    direction: 'inbound',
    from_email: 'general@example.com',
    from_name: 'General Person',
    to_email: 'info@itdev.gr',
    subject: 'General inbox item',
    body_text: 'Body 5',
    body_html: null,
    snippet: 'Body 5',
    sent_at: '2026-09-01T14:00:00Z',
    department: null,
    job_id: null,
    lead_id: null,
    cc_emails: null,
    captured_from_user_id: null,
    client_id: null,
    deal_id: null,
    unread: true,
    unfiled: true,
    mine: false,
    category: 'other',
  },
];

vi.mock('./hooks/useEmailInbox', async (importOriginal) => {
  // Keep the real `isInboxItemVisible` — InboxPage imports it directly, and
  // it must stay the same predicate the (also mocked) hook would use, or
  // this test can't catch the two drifting apart.
  const actual = await importOriginal<typeof import('./hooks/useEmailInbox')>();
  return {
    ...actual,
    useEmailInbox: () => ({
      items,
      unreadCount: items.filter((i) => i.unread).length,
      refetch,
    }),
    useMarkEmailRead: () => ({ markRead, markAllRead }),
    useEmailInboxRealtime: () => {},
  };
});

import { InboxPage } from './InboxPage';

function wrap(node: React.ReactNode) {
  const qc = new QueryClient();
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('InboxPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.isAdmin = false;
  });

  it('shows all rows on the "all" tab', () => {
    render(wrap(<InboxPage />));
    expect(screen.getByText('Unfiled subject')).toBeInTheDocument();
    expect(screen.getByText('Mine unread')).toBeInTheDocument();
    expect(screen.getByText('Read with lead')).toBeInTheDocument();
    expect(screen.getByText('Read with job')).toBeInTheDocument();
  });

  it('links a job-filed email to its job card, not the unfiled badge', () => {
    render(wrap(<InboxPage />));
    const row = screen.getByText('Read with job').closest('article');
    expect(row).not.toBeNull();
    const link = within(row as HTMLElement).getByRole('link', { name: 'inbox.card.job' });
    expect(link).toHaveAttribute('href', '/jobs/job-1');
    expect(within(row as HTMLElement).queryByText('inbox.unfiled_badge')).not.toBeInTheDocument();
  });

  it('switching to the unfiled tab leaves only the unfiled rows', async () => {
    const user = userEvent.setup();
    render(wrap(<InboxPage />));
    await user.click(screen.getByText('inbox.tabs.unfiled'));
    expect(screen.getByText('Unfiled subject')).toBeInTheDocument();
    expect(screen.getByText('Mine unread')).toBeInTheDocument();
    expect(screen.queryByText('Read with lead')).not.toBeInTheDocument();
  });

  it('shows a filing button on the unfiled row once opened', async () => {
    const user = userEvent.setup();
    render(wrap(<InboxPage />));
    const row = screen.getByText('Unfiled subject').closest('article');
    expect(row).not.toBeNull();
    await user.click(within(row as HTMLElement).getByRole('button'));
    expect(within(row as HTMLElement).getByText('inbox.file_action')).toBeInTheDocument();
  });

  it('clicking a row calls markRead with its id', async () => {
    const user = userEvent.setup();
    render(wrap(<InboxPage />));
    const row = screen.getByText('Mine unread').closest('article');
    expect(row).not.toBeNull();
    await user.click(within(row as HTMLElement).getByRole('button'));
    expect(markRead).toHaveBeenCalledWith('m-mine-unread');
  });

  it('hides the Άλλο chip for non-admins and excludes other-category items from Όλα', () => {
    authState.isAdmin = false;
    render(wrap(<InboxPage />));
    expect(screen.queryByText('inbox.cats.other')).not.toBeInTheDocument();
    expect(screen.queryByText('General inbox item')).not.toBeInTheDocument();
    expect(screen.getByText('Unfiled subject')).toBeInTheDocument();
    expect(screen.getByText('Mine unread')).toBeInTheDocument();
    expect(screen.getByText('Read with lead')).toBeInTheDocument();
    expect(screen.getByText('Read with job')).toBeInTheDocument();
  });

  it('excludes other-category items from the unread count non-admins see', () => {
    authState.isAdmin = false;
    render(wrap(<InboxPage />));
    const unreadChip = screen.getByText('inbox.tabs.unread').closest('button');
    expect(unreadChip).not.toBeNull();
    // Only "Mine unread" is visible to a non-admin — the other-category
    // unread item must not inflate the count.
    expect(within(unreadChip as HTMLElement).getByText('(1)')).toBeInTheDocument();
  });

  it('non-admin mark-all-read only marks the mail the admin never gated off', async () => {
    authState.isAdmin = false;
    const user = userEvent.setup();
    render(wrap(<InboxPage />));
    await user.click(screen.getByText('inbox.mark_all_read'));
    expect(markAllRead).toHaveBeenCalledWith(['m-mine-unread']);
  });

  it('shows the Άλλο chip for admins and filters to other-category items when selected', async () => {
    authState.isAdmin = true;
    const user = userEvent.setup();
    render(wrap(<InboxPage />));
    expect(screen.getByText('inbox.cats.other')).toBeInTheDocument();
    expect(screen.getByText('General inbox item')).toBeInTheDocument();

    await user.click(screen.getByText('inbox.cats.other'));
    expect(screen.getByText('General inbox item')).toBeInTheDocument();
    expect(screen.queryByText('Unfiled subject')).not.toBeInTheDocument();
  });

  it('admin mark-all-read includes the other-category mail', async () => {
    authState.isAdmin = true;
    const user = userEvent.setup();
    render(wrap(<InboxPage />));
    await user.click(screen.getByText('inbox.mark_all_read'));
    expect(markAllRead).toHaveBeenCalledWith(expect.arrayContaining(['m-mine-unread', 'm-other-admin']));
  });
});
