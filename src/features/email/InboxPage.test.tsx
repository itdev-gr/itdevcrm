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

const authState = vi.hoisted(() => ({ isAdmin: false, groupCodes: ['sales', 'accounting'] as string[] }));
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (selector: (s: { isAdmin: boolean; groupCodes: string[] }) => unknown) => selector(authState),
}));

const dismiss = vi.fn().mockResolvedValue(undefined);
const restore = vi.fn().mockResolvedValue(undefined);
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
    dismissed: false,
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
    dismissed: false,
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
    dismissed: false,
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
    dismissed: false,
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
    dismissed: false,
    mine: false,
    category: 'other',
  },
];

// Cleared mail never appears in `items` — the hook filters it out — so the page
// can only reach it through the Cleared tab.
const clearedItems: InboxItem[] = [
  {
    ...items[0]!,
    id: 'm-cleared',
    message_id: 'mid-6',
    subject: 'Cleared subject',
    dismissed: true,
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
      clearedItems,
      unreadCount: items.filter((i) => i.unread).length,
      refetch,
    }),
    useMarkEmailRead: () => ({ markRead, markAllRead }),
    useDismissEmail: () => ({ dismiss, restore }),
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
    // sales+accounting membership allows every fixture category except 'other'
    authState.groupCodes = ['sales', 'accounting'];
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
    await user.click(within(row as HTMLElement).getByText('Unfiled subject'));
    expect(within(row as HTMLElement).getByText('inbox.file_action')).toBeInTheDocument();
  });

  it('clicking a row calls markRead with its id', async () => {
    const user = userEvent.setup();
    render(wrap(<InboxPage />));
    const row = screen.getByText('Mine unread').closest('article');
    expect(row).not.toBeNull();
    await user.click(within(row as HTMLElement).getByText('Mine unread'));
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

  it('non-admins get no Όλα chip; chips follow the group matrix (owner example: accounting)', async () => {
    authState.isAdmin = false;
    authState.groupCodes = ['accounting'];
    const user = userEvent.setup();
    render(wrap(<InboxPage />));
    // No Όλα, no Sales, no Άλλο — only the accounting matrix: Accounting + Support.
    expect(screen.queryByText('inbox.cats.all')).not.toBeInTheDocument();
    expect(screen.queryByText('inbox.cats.sales')).not.toBeInTheDocument();
    expect(screen.queryByText('inbox.cats.other')).not.toBeInTheDocument();
    expect(screen.getByText('inbox.cats.accounting')).toBeInTheDocument();
    expect(screen.getByText('inbox.cats.support')).toBeInTheDocument();
    // Sales-category mail is gone from the list and the unread count entirely.
    expect(screen.queryByText('Unfiled subject')).not.toBeInTheDocument();
    expect(screen.queryByText('Mine unread')).not.toBeInTheDocument();
    expect(screen.getByText('Read with lead')).toBeInTheDocument();
    expect(screen.getByText('Read with job')).toBeInTheDocument();
    // Clicking a chip filters; clicking it again clears back to the role union.
    await user.click(screen.getByText('inbox.cats.accounting'));
    expect(screen.queryByText('Read with job')).not.toBeInTheDocument();
    await user.click(screen.getByText('inbox.cats.accounting'));
    expect(screen.getByText('Read with job')).toBeInTheDocument();
  });

  it('a pure sales rep sees only the Sales chip and only sales-category mail', () => {
    authState.isAdmin = false;
    authState.groupCodes = ['sales'];
    render(wrap(<InboxPage />));
    expect(screen.queryByText('inbox.cats.all')).not.toBeInTheDocument();
    expect(screen.queryByText('inbox.cats.accounting')).not.toBeInTheDocument();
    expect(screen.queryByText('inbox.cats.support')).not.toBeInTheDocument();
    expect(screen.getByText('inbox.cats.sales')).toBeInTheDocument();
    expect(screen.getByText('Unfiled subject')).toBeInTheDocument();
    expect(screen.queryByText('Read with lead')).not.toBeInTheDocument();
    expect(screen.queryByText('Read with job')).not.toBeInTheDocument();
  });

  it('the clear button dismisses without opening the email', async () => {
    authState.isAdmin = false;
    const user = userEvent.setup();
    render(wrap(<InboxPage />));
    const row = screen.getByText('Unfiled subject').closest('article')!;
    await user.click(within(row).getByRole('button', { name: 'inbox.clear_action' }));
    expect(dismiss).toHaveBeenCalledWith(expect.objectContaining({ id: 'm-unfiled' }));
    // The row's own click handler must not have fired: the body stays closed
    // and unread mail would otherwise have been marked read.
    expect(within(row).queryByRole('button', { name: 'inbox.file_action' })).not.toBeInTheDocument();
    expect(markRead).not.toHaveBeenCalled();
  });

  it('cleared mail lives only in the Cleared tab, and can be restored', async () => {
    authState.isAdmin = false;
    const user = userEvent.setup();
    render(wrap(<InboxPage />));
    expect(screen.queryByText('Cleared subject')).not.toBeInTheDocument();

    await user.click(screen.getByText('inbox.tabs.cleared'));
    expect(screen.getByText('Cleared subject')).toBeInTheDocument();
    expect(screen.queryByText('Unfiled subject')).not.toBeInTheDocument();

    const row = screen.getByText('Cleared subject').closest('article')!;
    await user.click(within(row).getByRole('button', { name: 'inbox.restore_action' }));
    expect(restore).toHaveBeenCalledWith(expect.objectContaining({ id: 'm-cleared' }));
  });
});
