import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { TaskCard } from './taskCard';

const auth = { isAdmin: false };
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: { isAdmin: boolean; user: { id: string } }) => unknown) =>
    sel({ isAdmin: auth.isAdmin, user: { id: 'me' } }),
}));
const mutateAsync = vi.fn().mockResolvedValue(undefined);
vi.mock('@/features/home/hooks/useDeleteTask', () => ({
  useToggleTaskComplete: () => ({ mutateAsync, isPending: false }),
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
    notes: null, clientName: null, leadName: null, ...p,
  };
}

describe('UserTaskDetailDialog resolve button', () => {
  beforeEach(() => { auth.isAdmin = false; mutateAsync.mockClear(); });

  it('assignee sees Resolve and it completes the task', async () => {
    render(<UserTaskDetailDialog card={card({ relation: 'mine' })} onOpenChange={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'tasks_page.resolve' }));
    expect(mutateAsync).toHaveBeenCalledWith({ id: 'u1', completed: true });
  });

  it('creator (delegated) sees Resolve', () => {
    render(<UserTaskDetailDialog card={card({ relation: 'delegated' })} onOpenChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'tasks_page.resolve' })).toBeInTheDocument();
  });

  it('admin non-party sees Resolve', () => {
    auth.isAdmin = true;
    render(<UserTaskDetailDialog card={card({ relation: 'other' })} onOpenChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'tasks_page.resolve' })).toBeInTheDocument();
  });

  it('non-participant sees no Resolve; resolved tasks show none either', () => {
    const { rerender } = render(
      <UserTaskDetailDialog card={card({ relation: 'other' })} onOpenChange={() => {}} />,
    );
    expect(screen.queryByRole('button', { name: 'tasks_page.resolve' })).not.toBeInTheDocument();
    rerender(<UserTaskDetailDialog card={card({ relation: 'mine', resolved: true })} onOpenChange={() => {}} />);
    expect(screen.queryByRole('button', { name: 'tasks_page.resolve' })).not.toBeInTheDocument();
  });
});
