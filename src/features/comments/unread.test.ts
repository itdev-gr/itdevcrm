import { describe, it, expect } from 'vitest';
import { deriveUnread } from './unread';

const T1 = '2026-07-16T10:00:00Z';
const T2 = '2026-07-16T11:00:00Z';
const other = (created_at: string) => ({ author_id: 'them', created_at });

describe('deriveUnread', () => {
  it('empty thread -> read', () => {
    expect(deriveUnread(['general', 'ads'], { general: null, ads: null }, [], 'me')).toEqual({
      general: false,
      ads: false,
    });
  });

  it('newest comment is my own -> read', () => {
    expect(
      deriveUnread(['ads'], { ads: { author_id: 'me', created_at: T2 } }, [], 'me'),
    ).toEqual({ ads: false });
  });

  it("someone else's comment with no read row -> unread", () => {
    expect(deriveUnread(['ads'], { ads: other(T1) }, [], 'me')).toEqual({ ads: true });
  });

  it('comment newer than my last_seen -> unread', () => {
    expect(
      deriveUnread(['ads'], { ads: other(T2) }, [{ parent_type: 'deal_ads', last_seen_at: T1 }], 'me'),
    ).toEqual({ ads: true });
  });

  it('comment at or before my last_seen -> read', () => {
    expect(
      deriveUnread(['ads'], { ads: other(T1) }, [{ parent_type: 'deal_ads', last_seen_at: T2 }], 'me'),
    ).toEqual({ ads: false });
    expect(
      deriveUnread(['ads'], { ads: other(T1) }, [{ parent_type: 'deal_ads', last_seen_at: T1 }], 'me'),
    ).toEqual({ ads: false });
  });

  it('read rows only clear their own tab (keyed by parent_type)', () => {
    expect(
      deriveUnread(
        ['dev', 'social'],
        { dev: other(T2), social: other(T2) },
        [{ parent_type: 'deal_dev', last_seen_at: T2 }],
        'me',
      ),
    ).toEqual({ dev: false, social: true });
  });

  it('general tab reads its state from the plain deal thread', () => {
    expect(
      deriveUnread(['general'], { general: other(T2) }, [{ parent_type: 'deal', last_seen_at: T1 }], 'me'),
    ).toEqual({ general: true });
  });
});
