import { createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { from } = vi.hoisted(() => {
  const msgRows = [
    {
      id: 'm1',
      message_id: 'msg-1',
      thread_id: null,
      direction: 'inbound',
      from_email: 'unfiled@example.com',
      from_name: null,
      to_email: 'unfiled-box@itdev.gr',
      subject: 'Unfiled message',
      body_text: null,
      body_html: null,
      snippet: null,
      sent_at: '2026-09-01T10:00:00Z',
      department: null,
      job_id: null,
      lead_id: null,
      cc_emails: null,
      client_id: null,
      deal_id: null,
      captured_from_user_id: 'mb-sales',
    },
    {
      id: 'm2',
      message_id: 'msg-2',
      thread_id: null,
      direction: 'inbound',
      from_email: 'other@example.com',
      from_name: null,
      to_email: 'Me@ITDEV.gr',
      subject: 'For the viewer',
      body_text: null,
      body_html: null,
      snippet: null,
      sent_at: '2026-09-02T10:00:00Z',
      department: null,
      job_id: null,
      lead_id: null,
      cc_emails: null,
      client_id: 'c1',
      deal_id: null,
      captured_from_user_id: 'mb-info',
    },
    {
      id: 'm3',
      message_id: 'msg-3',
      thread_id: null,
      direction: 'inbound',
      from_email: 'someone@example.com',
      from_name: null,
      to_email: 'other-box@itdev.gr',
      subject: 'Already read, filed, and not mine',
      body_text: null,
      body_html: null,
      snippet: null,
      sent_at: '2026-09-03T10:00:00Z',
      department: null,
      job_id: null,
      lead_id: null,
      cc_emails: null,
      client_id: 'c2',
      deal_id: null,
      captured_from_user_id: 'u1',
    },
  ];
  const readRows = [{ message_pk: 'm3' }];
  const mailboxRows = [
    { user_id: 'mb-sales', email: 'sales@itdev.gr' },
    { user_id: 'mb-acc', email: 'accounting@itdev.gr' },
    { user_id: 'mb-sup', email: 'support@itdev.gr' },
    { user_id: 'mb-info', email: 'info@itdev.gr' },
  ];

  // A team-wide clear (user_id null) and somebody else's personal clear, which
  // must NOT hide the row for me.
  const dismissRows: { message_pk: string; user_id: string | null; dismissed_at: string }[] = [];
  (globalThis as unknown as { __dismissRows: typeof dismissRows }).__dismissRows = dismissRows;

  const from = vi.fn((table: string) => {
    if (table === 'email_messages') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: msgRows, error: null }),
            }),
          }),
        }),
      };
    }
    if (table === 'email_message_reads') {
      return {
        select: vi.fn().mockResolvedValue({ data: readRows, error: null }),
      };
    }
    if (table === 'shared_mailboxes') {
      return {
        select: vi.fn().mockResolvedValue({ data: mailboxRows, error: null }),
      };
    }
    if (table === 'email_message_dismissals') {
      return {
        select: vi.fn().mockResolvedValue({ data: dismissRows, error: null }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });
  return { from };
});

const authState = vi.hoisted(() => ({ isAdmin: true, groupCodes: [] as string[] }));
vi.mock('@/lib/supabase', () => ({ supabase: { from } }));
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (
    selector: (s: { user: { id: string; email: string } | null; isAdmin: boolean; groupCodes: string[] }) => unknown,
  ) =>
    selector({ user: { id: 'u1', email: 'me@itdev.gr' }, isAdmin: authState.isAdmin, groupCodes: authState.groupCodes }),
}));

import { useEmailInbox, useEmailInboxBadge } from './useEmailInbox';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, c);
}

describe('useEmailInbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.isAdmin = true;
    authState.groupCodes = [];
  });

  it('returns rows with per-user unread, unfiled, and mine flags', async () => {
    const { result } = renderHook(() => useEmailInbox(), {
      wrapper: ({ children }) => wrap(children),
    });

    await waitFor(() => expect(result.current.items.length).toBe(3));

    expect(result.current.unreadCount).toBe(2);

    const unfiled = result.current.items.find((i) => i.id === 'm1');
    expect(unfiled?.unfiled).toBe(true);

    const mine = result.current.items.find((i) => i.id === 'm2');
    expect(mine?.mine).toBe(true);

    const read = result.current.items.find((i) => i.id === 'm3');
    expect(read?.unread).toBe(false);
  });

  it('drops cleared mail from the queue: team-wide always, personal only mine', async () => {
    const rows = (globalThis as unknown as {
      __dismissRows: { message_pk: string; user_id: string | null; dismissed_at: string }[];
    }).__dismissRows;
    rows.length = 0;
    rows.push(
      // cleared for the whole team
      { message_pk: 'm1', user_id: null, dismissed_at: '2026-09-04T08:00:00Z' },
      // cleared by ME
      { message_pk: 'm2', user_id: 'u1', dismissed_at: '2026-09-04T08:00:00Z' },
      // cleared by a COLLEAGUE — must still be in my queue
      { message_pk: 'm3', user_id: 'u2', dismissed_at: '2026-09-04T08:00:00Z' },
    );

    const { result } = renderHook(() => useEmailInbox(), {
      wrapper: ({ children }) => wrap(children),
    });

    await waitFor(() => expect(result.current.items.length).toBe(1));
    expect(result.current.items[0]!.id).toBe('m3');
    expect(result.current.clearedItems.map((i) => i.id).sort()).toEqual(['m1', 'm2']);
    // A cleared unread message must not keep inflating the badge.
    expect(result.current.unreadCount).toBe(0);

    rows.length = 0;
  });

  it('badge counts the same mail the page would show, without fetching bodies', async () => {
    const rows = (globalThis as unknown as {
      __dismissRows: { message_pk: string; user_id: string | null; dismissed_at: string }[];
    }).__dismissRows;
    rows.length = 0;
    rows.push({ message_pk: 'm1', user_id: null, dismissed_at: '2026-09-04T08:00:00Z' });

    const { result } = renderHook(() => useEmailInboxBadge(), {
      wrapper: ({ children }) => wrap(children),
    });

    // m1 is unread but cleared for the team, m3 is read → only m2 is left. It
    // is 'other' category, and this suite runs as an admin, so it counts.
    await waitFor(() => expect(result.current.unreadCount).toBe(1));

    // The badge must never pull message bodies: only the id columns.
    const cols = from.mock.results
      .map((r) => r.value)
      .filter((v) => typeof v?.select === 'function')
      .flatMap((v) => (v.select as { mock?: { calls: unknown[][] } }).mock?.calls ?? [])
      .map((c) => String(c[0]));
    expect(cols.some((c) => c.includes('body_text') || c.includes('snippet'))).toBe(false);

    rows.length = 0;
  });

  it('classifies items by capturing mailbox', async () => {
    const { result } = renderHook(() => useEmailInbox(), {
      wrapper: ({ children }) => wrap(children),
    });

    await waitFor(() => expect(result.current.items.length).toBe(3));

    const sales = result.current.items.find((i) => i.id === 'm1');
    expect(sales?.category).toBe('sales');

    const other = result.current.items.find((i) => i.id === 'm2');
    expect(other?.category).toBe('other');

    const personal = result.current.items.find((i) => i.id === 'm3');
    expect(personal?.category).toBe('personal');
  });

  it('excludes other-category mail from unreadCount for non-admins, includes it for admins', async () => {
    authState.isAdmin = false;
    authState.groupCodes = ['sales'];
    const { result: nonAdmin } = renderHook(() => useEmailInbox(), {
      wrapper: ({ children }) => wrap(children),
    });
    await waitFor(() => expect(nonAdmin.current.items.length).toBe(3));
    // m1 (sales, unread) counts; m2 (other, unread) is gated off for a non-admin.
    expect(nonAdmin.current.unreadCount).toBe(1);

    authState.isAdmin = true;
    const { result: admin } = renderHook(() => useEmailInbox(), {
      wrapper: ({ children }) => wrap(children),
    });
    await waitFor(() => expect(admin.current.items.length).toBe(3));
    expect(admin.current.unreadCount).toBe(2);
  });
});
