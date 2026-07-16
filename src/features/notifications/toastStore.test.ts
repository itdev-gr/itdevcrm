import { beforeEach, describe, expect, it } from 'vitest';
import { useToastStore } from './toastStore';
import type { NotificationRow } from './hooks/useNotifications';

function makeNotif(id: string): NotificationRow {
  return {
    id,
    user_id: 'u1',
    type: 'task_assigned',
    payload: {},
    read_at: null,
    created_at: '2026-07-16T00:00:00.000Z',
  };
}

beforeEach(() => {
  // Ephemeral store is a module singleton — reset between tests.
  useToastStore.setState({ toasts: [] });
});

describe('toastStore', () => {
  it('push adds an entry keyed by the notif id', () => {
    useToastStore.getState().push(makeNotif('a'));
    const { toasts } = useToastStore.getState();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.id).toBe('a');
    expect(toasts[0]!.notif.id).toBe('a');
  });

  it('push of a duplicate id is a no-op (length unchanged)', () => {
    const { push } = useToastStore.getState();
    push(makeNotif('a'));
    push(makeNotif('a'));
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it('dismiss removes the entry with that id', () => {
    const { push, dismiss } = useToastStore.getState();
    push(makeNotif('a'));
    push(makeNotif('b'));
    dismiss('a');
    const { toasts } = useToastStore.getState();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.id).toBe('b');
  });

  it('caps the visible stack at 4, dropping the oldest', () => {
    const { push } = useToastStore.getState();
    ['a', 'b', 'c', 'd', 'e'].forEach((id) => push(makeNotif(id)));
    const ids = useToastStore.getState().toasts.map((t) => t.id);
    expect(ids).toHaveLength(4);
    // 'a' (oldest) dropped; newest four remain in push order.
    expect(ids).toEqual(['b', 'c', 'd', 'e']);
  });
});
