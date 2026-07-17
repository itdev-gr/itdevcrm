import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect } from 'vitest';
import type { UserTaskRow } from './hooks/useUserTasks';
import { canDeleteUserTask } from './taskDialogRules';

describe('canDeleteUserTask', () => {
  it('creator can delete a delegated task', () => {
    expect(canDeleteUserTask({ user_id: 'b', created_by: 'a' }, 'a')).toBe(true);
  });
  it('assignee cannot delete a task delegated to them', () => {
    expect(canDeleteUserTask({ user_id: 'b', created_by: 'a' }, 'b')).toBe(false);
  });
  it('owner can delete own self-created task', () => {
    expect(canDeleteUserTask({ user_id: 'a', created_by: 'a' }, 'a')).toBe(true);
  });
  it('owner can delete legacy personal task (created_by null)', () => {
    expect(canDeleteUserTask({ user_id: 'a', created_by: null }, 'a')).toBe(true);
  });
  it('third party cannot delete', () => {
    expect(canDeleteUserTask({ user_id: 'b', created_by: 'a' }, 'c')).toBe(false);
  });
});

// Component gate: the Delete button must hide for a delegated assignee and show
// for the creator, mirroring the user_tasks_delete RLS policy. Mocks follow
// TaskDialog.test.tsx (authStore fixes the current user to 'me').
vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn(() => ({ update: vi.fn(() => ({ eq: vi.fn() })) })) },
}));
vi.mock('./hooks/useUpsertTask', () => ({
  useUpsertTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('./hooks/useDeleteTask', () => ({
  useDeleteTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/features/tasks/hooks/useResolveTask', () => ({
  useResolveTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/features/comments/hooks/useMentionableUsers', () => ({
  useMentionableUsers: () => ({
    data: [{ user_id: 'me', full_name: 'Me', email: 'me@x.gr', is_admin: false, group_codes: [] }],
  }),
}));
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) =>
    sel({ user: { id: 'me' }, isAdmin: false, groupCodes: [] }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k }),
}));
vi.mock('@/features/clients/ClientPicker', () => ({
  ClientPicker: () => <div data-testid="client-picker" />,
}));
vi.mock('@/features/clients/hooks/useClientTasks', () => ({
  useClientTasks: () => ({ cards: [], isLoading: false }),
}));

import { TaskDialog } from './TaskDialog';

function wrap(node: React.ReactNode) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

function makeTask(overrides: Partial<UserTaskRow>): UserTaskRow {
  return {
    id: 'T1', title: 'Editing', notes: null, due_at: new Date().toISOString(),
    completed_at: null, user_id: 'me', created_by: 'me', client_id: null, lead_id: null,
    importance: 'low', started_at: null, created_at: null,
    ...overrides,
  } as unknown as UserTaskRow;
}

describe('TaskDialog delete gate', () => {
  it('hides Delete for a delegated assignee', () => {
    // I ('me') am the assignee; someone else delegated the task to me.
    render(wrap(<TaskDialog open onOpenChange={() => {}} task={makeTask({ user_id: 'me', created_by: 'other' })} />));
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('shows Delete for the creator', () => {
    // I ('me') created the task and delegated it to someone else.
    render(wrap(<TaskDialog open onOpenChange={() => {}} task={makeTask({ user_id: 'other', created_by: 'me' })} />));
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });
});
