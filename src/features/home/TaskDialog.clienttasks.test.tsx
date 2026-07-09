import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect } from 'vitest';
import { i18n } from '@/lib/i18n';
import type { UserTaskRow } from './hooks/useUserTasks';
import type { TaskCard } from '@/features/tasks/taskCard';

type AuthState = { user: { id: string } | null; isAdmin: boolean; groupCodes: string[] };
const authState: AuthState = { user: { id: 'me' }, isAdmin: false, groupCodes: ['sales'] };
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: AuthState) => unknown) => sel(authState),
}));
vi.mock('@/features/comments/hooks/useMentionableUsers', () => ({
  useMentionableUsers: () => ({ data: [{ user_id: 'me', full_name: 'Me', email: 'me@x', is_admin: false, group_codes: ['sales'] }] }),
}));
vi.mock('./hooks/useUpsertTask', () => ({ useUpsertTask: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock('./hooks/useDeleteTask', () => ({ useDeleteTask: () => ({ mutateAsync: vi.fn(), isPending: false }) }));

const openCard: TaskCard = {
  key: 'user:u1', kind: 'user', id: 'u1', title: 'Sibling task', importance: 'low',
  relation: 'other', resolved: false, assigneeId: 'me', creatorId: 'me', createdAtIso: null,
  dueAt: null, resolvedAt: null, startedAtIso: null, sourceCode: null, link: null,
  notes: null, clientName: null, leadName: null,
};
vi.mock('@/features/clients/hooks/useClientTasks', () => ({
  useClientTasks: () => ({ cards: [openCard], isLoading: false }),
}));

import { TaskDialog } from './TaskDialog';

function wrap(node: React.ReactNode) {
  const qc = new QueryClient();
  return (
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>{node}</I18nextProvider>
    </QueryClientProvider>
  );
}

describe('TaskDialog — client open-tasks list', () => {
  it("lists the client's open tasks when a client is selected in create mode", () => {
    render(wrap(<TaskDialog open onOpenChange={() => {}} defaultClient={{ id: 'C1', name: 'ACME' }} />));
    expect(screen.getByText('Sibling task')).toBeInTheDocument();
  });

  it('hides the list in lead mode (no client selected)', () => {
    render(wrap(<TaskDialog open onOpenChange={() => {}} />));
    expect(screen.queryByText('Sibling task')).not.toBeInTheDocument();
  });

  it('hides the list in edit mode', () => {
    const task = {
      id: 'T1', title: 'Editing', notes: null, due_at: new Date().toISOString(),
      completed_at: null, user_id: 'me', created_by: 'me', client_id: 'C1', lead_id: null,
      importance: 'low', started_at: null, created_at: null,
    } as unknown as UserTaskRow;
    render(wrap(<TaskDialog open onOpenChange={() => {}} task={task} />));
    expect(screen.queryByText('Sibling task')).not.toBeInTheDocument();
  });
});
