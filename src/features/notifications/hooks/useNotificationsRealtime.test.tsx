import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Mock the Supabase client to enforce the real-world invariant that broke us:
//   calling .channel(name) twice with the same name returns the SAME instance,
//   and that instance throws on .on() once it has been .subscribe()'d.
// If two consumers (Bell + Column) used the same channel name, the second
// mount would hit this throw.
const channelStore = new Map<string, FakeChannel>();
const channelCalls: string[] = [];

class FakeChannel {
  name: string;
  subscribed = false;
  constructor(name: string) {
    this.name = name;
  }
  on(_event: string, _filter: unknown, _cb: () => void) {
    if (this.subscribed) {
      throw new Error(
        `cannot add postgres_changes callbacks for realtime:${this.name} after subscribe()`,
      );
    }
    return this;
  }
  subscribe() {
    this.subscribed = true;
    return this;
  }
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: (name: string) => {
      channelCalls.push(name);
      let ch = channelStore.get(name);
      if (!ch) {
        ch = new FakeChannel(name);
        channelStore.set(name, ch);
      }
      return ch;
    },
    removeChannel: vi.fn(),
  },
}));

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: { id: 'user-1' } }),
}));

import { useNotificationsRealtime } from './useNotificationsRealtime';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useNotificationsRealtime', () => {
  beforeEach(() => {
    channelStore.clear();
    channelCalls.length = 0;
  });

  it('two consumers in the same tree subscribe to DIFFERENT channel names', () => {
    // Regression for the home-page crash where Bell and Column both called
    // this hook and Supabase rejected the second .on() with
    // "cannot add postgres_changes callbacks after subscribe()".
    function Pair() {
      useNotificationsRealtime();
      useNotificationsRealtime();
      return null;
    }
    expect(() => renderHook(() => Pair(), { wrapper })).not.toThrow();

    // Both consumers must use a notifications-* channel, but the names must
    // not collide — useId() provides the unique suffix.
    const notifNames = channelCalls.filter((n) => n.startsWith('notifications-'));
    expect(notifNames.length).toBe(2);
    expect(new Set(notifNames).size).toBe(2);
  });

  it('single consumer subscribes exactly once', () => {
    renderHook(() => useNotificationsRealtime(), { wrapper });
    const notifNames = channelCalls.filter((n) => n.startsWith('notifications-'));
    expect(notifNames.length).toBe(1);
  });
});
