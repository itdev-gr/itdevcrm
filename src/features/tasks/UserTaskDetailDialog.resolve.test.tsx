import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { TaskCard } from './taskCard';

const auth = { isAdmin: false };
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: { isAdmin: boolean; user: { id: string } }) => unknown) =>
    sel({ isAdmin: auth.isAdmin, user: { id: 'me' } }),
}));
const resolveMutate = vi.fn().mockResolvedValue({ closed: true, your_side: 'assignee', awaiting: null });
const unresolveMutate = vi.fn().mockResolvedValue(undefined);
vi.mock('./hooks/useResolveTask', () => ({
  useResolveTask: () => ({ mutateAsync: resolveMutate, isPending: false }),
  useUnresolveTask: () => ({ mutateAsync: unresolveMutate, isPending: false }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k,
    i18n: { resolvedLanguage: 'en' },
  }),
}));
vi.mock('./StartTaskButton', () => ({ StartTaskButton: () => null }));
vi.mock('./TaskDetailShell', () => ({
  TaskDetailShell: ({ title, footer, children }: { title: string; footer?: React.ReactNode; children?: React.ReactNode }) => (
    <div>
      <span>{title}</span>
      {footer}
      {children}
    </div>
  ),
}));

import { UserTaskDetailDialog } from './UserTaskDetailDialog';

function card(p: Partial<TaskCard>): TaskCard {
  return {
    key: 'user:u1', kind: 'user', id: 'u1', title: 'T', importance: 'low',
    relation: 'other', resolved: false,
    assigneeId: 'a', creatorId: null, createdAtIso: null, dueAt: null,
    resolvedAt: null, startedAtIso: null, sourceCode: null, link: null,
    notes: null, clientName: null, clientId: null, leadName: null,
    creatorResolvedAt: null, assigneeResolvedAt: null, summary: null, ...p,
  };
}

describe('UserTaskDetailDialog resolve button', () => {
  beforeEach(() => { auth.isAdmin = false; resolveMutate.mockClear(); unresolveMutate.mockClear(); });

  it('assignee sees Resolve and it stamps their side via the RPC', async () => {
    // relation is derived from ids, so keep assigneeId consistent with the mocked user.
    render(<UserTaskDetailDialog card={card({ relation: 'mine', assigneeId: 'me' })} onOpenChange={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'tasks_page.resolve' }));
    expect(resolveMutate).toHaveBeenCalledWith({ kind: 'user', id: 'u1' });
  });

  it('creator (delegated) sees Resolve', () => {
    render(<UserTaskDetailDialog card={card({ relation: 'delegated', creatorId: 'me', assigneeId: 'a' })} onOpenChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'tasks_page.resolve' })).toBeTruthy();
  });

  it('admin non-party sees Resolve', () => {
    auth.isAdmin = true;
    render(<UserTaskDetailDialog card={card({ relation: 'other', assigneeId: 'a', creatorId: 'b' })} onOpenChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'tasks_page.resolve' })).toBeTruthy();
  });

  it('non-participant sees no Resolve; resolved tasks show none either', () => {
    const { rerender } = render(
      <UserTaskDetailDialog card={card({ relation: 'other', assigneeId: 'a', creatorId: 'b' })} onOpenChange={() => {}} />,
    );
    expect(screen.queryByRole('button', { name: 'tasks_page.resolve' })).toBeNull();
    rerender(<UserTaskDetailDialog card={card({ relation: 'mine', assigneeId: 'me', resolved: true })} onOpenChange={() => {}} />);
    expect(screen.queryByRole('button', { name: 'tasks_page.resolve' })).toBeNull();
  });
});
