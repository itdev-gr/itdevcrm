import { describe, it, expect } from 'vitest';
import { groupThreads, categoryOf, type EmailMessageRow } from './useEmailThreads';

function row(p: Partial<EmailMessageRow>): EmailMessageRow {
  return {
    id: p.id ?? 'm1',
    message_id: p.message_id ?? 'x',
    thread_id: p.thread_id ?? null,
    direction: p.direction ?? 'outbound',
    from_email: p.from_email ?? 'me@itdev.gr',
    from_name: p.from_name ?? null,
    to_email: p.to_email ?? 'c@x.gr',
    subject: p.subject ?? null,
    body_text: p.body_text ?? null,
    snippet: p.snippet ?? null,
    sent_at: p.sent_at ?? null,
    department: p.department ?? null,
    job_id: p.job_id ?? null,
    lead_id: p.lead_id ?? null,
  };
}

describe('groupThreads', () => {
  it('sorts messages inside a thread newest-first', () => {
    const th = groupThreads([
      row({ id: 'a', thread_id: 't1', sent_at: '2026-07-01T10:00:00Z' }),
      row({ id: 'b', thread_id: 't1', sent_at: '2026-07-03T10:00:00Z' }),
      row({ id: 'c', thread_id: 't1', sent_at: '2026-07-02T10:00:00Z' }),
    ]);
    expect(th).toHaveLength(1);
    expect(th[0]!.messages.map((m) => m.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts threads by latest activity, newest first', () => {
    const th = groupThreads([
      row({ id: 'a', thread_id: 'old', sent_at: '2026-07-01T10:00:00Z' }),
      row({ id: 'b', thread_id: 'new', sent_at: '2026-07-09T10:00:00Z' }),
    ]);
    expect(th.map((x) => x.key)).toEqual(['new', 'old']);
  });

  it('groups Re:/Fwd: chains by normalized subject when thread_id is null', () => {
    const th = groupThreads([
      row({ id: 'a', subject: 'GBP access', sent_at: '2026-07-01T10:00:00Z' }),
      row({ id: 'b', subject: 'Re: GBP access', sent_at: '2026-07-02T10:00:00Z' }),
      row({ id: 'c', subject: 'RE: Re: GBP access', sent_at: '2026-07-03T10:00:00Z' }),
      row({ id: 'd', subject: 'Fwd: GBP access', sent_at: '2026-07-04T10:00:00Z' }),
    ]);
    expect(th).toHaveLength(1);
    expect(th[0]!.messages).toHaveLength(4);
  });

  it('keeps blank-subject strays separate', () => {
    const th = groupThreads([
      row({ id: 'a', subject: null, sent_at: '2026-07-01T10:00:00Z' }),
      row({ id: 'b', subject: '  ', sent_at: '2026-07-02T10:00:00Z' }),
    ]);
    expect(th).toHaveLength(2);
  });

  it('does not cross-group thread_id rows with same-subject strays', () => {
    const th = groupThreads([
      row({ id: 'a', thread_id: 't1', subject: 'X' }),
      row({ id: 'b', subject: 'X' }),
    ]);
    expect(th).toHaveLength(2);
  });
});

describe('categoryOf', () => {
  it('maps sales and accounting directly, everything else to technical', () => {
    expect(categoryOf('sales')).toBe('sales');
    expect(categoryOf('accounting')).toBe('accounting');
    expect(categoryOf('web_dev')).toBe('technical');
    expect(categoryOf('local_seo')).toBe('technical');
    expect(categoryOf(null)).toBe('technical');
  });
});

describe('thread category', () => {
  it('derives the category from the newest message in the thread', () => {
    const th = groupThreads([
      row({ id: 'a', thread_id: 't1', department: 'web_dev', sent_at: '2026-07-01T10:00:00Z' }),
      row({ id: 'b', thread_id: 't1', department: 'sales', sent_at: '2026-07-02T10:00:00Z' }),
    ]);
    expect(th[0]!.category).toBe('sales');
  });
});
