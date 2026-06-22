import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { i18n } from '@/lib/i18n';

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: { isAdmin: boolean; user: { id: string } | null; groupCodes: string[] }) => unknown) =>
    sel({ isAdmin: false, user: { id: 'u-me' }, groupCodes: ['accounting'] }),
}));

vi.mock('./hooks/useAssignedTasksRealtime', () => ({
  useAssignedTasksRealtime: () => undefined,
}));

vi.mock('./hooks/useAssignedTasksOpen', () => ({
  useAssignedTasksOpen: ({ assigneeUserId }: { assigneeUserId: string | null }) => ({
    data:
      assigneeUserId === 'u-me'
        ? [
            {
              id: 't1', title: 'Renew domain', description: 'before May 30',
              deal_id: 'd1', job_id: null, client_id: 'c1', source_code: '000013',
              assignee_user_id: 'u-me', created_by_user_id: 'u-other',
              status: 'open', resolved_at: null, resolved_by_user_id: null,
              created_at: new Date().toISOString(),
              client: { id: 'c1', name: 'Acme Ltd' },
              department: { id: 'g1', code: 'web_dev', display_names: { en: 'Web Dev', el: 'Web Dev' }, position: 50 },
            },
          ]
        : [],
    isLoading: false,
  }),
}));

vi.mock('./hooks/useAssignedTaskDetail', () => ({
  useAssignedTaskDetail: (id: string | null) => ({
    data: id
      ? {
          id: 't1', title: 'Renew domain', description: 'desc',
          deal_id: 'd1', job_id: null, client_id: 'c1', source_code: '000013',
          assignee_user_id: 'u-me', created_by_user_id: 'u-other',
          status: 'open' as const, resolved_at: null, resolved_by_user_id: null,
          created_at: new Date().toISOString(),
          department_group_id: 'g1',
          client: {
            id: 'c1', name: 'Acme Ltd', industry: 'Retail',
            contact_first_name: 'Jane', contact_last_name: 'Doe',
            email: 'jane@acme.gr', phone: '+30 1',
          },
          creator: { user_id: 'u-other', full_name: 'Smoke Test', email: 's@t.gr' },
          department: { id: 'g1', code: 'web_dev', display_names: { en: 'Web Dev', el: 'Web Dev' }, position: 50 },
        }
      : undefined,
    isLoading: false,
    error: null,
  }),
}));

const { personalData, togglePersonalSpy } = vi.hoisted(() => ({
  personalData: { current: [] as Array<Record<string, unknown>> },
  togglePersonalSpy: vi.fn(),
}));

vi.mock('@/features/home/hooks/useOpenUserTasks', () => ({
  useOpenUserTasks: ({ assigneeUserId }: { assigneeUserId: string | null }) => ({
    data: assigneeUserId === 'u-me' ? personalData.current : [],
    isLoading: false,
  }),
}));

vi.mock('@/features/home/hooks/useDeleteTask', () => ({
  useToggleTaskComplete: () => ({ mutate: togglePersonalSpy, isPending: false }),
  useDeleteTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/features/home/TaskDialog', () => ({
  TaskDialog: ({ open, task }: { open: boolean; task?: unknown }) =>
    open ? (
      <div role="dialog" aria-label={task ? 'edit task' : 'new task'}>
        task dialog
      </div>
    ) : null,
}));

import { AssignedTasksColumn } from './AssignedTasksColumn';

function wrap(children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

const personalTask = {
  id: 'p1',
  user_id: 'u-me',
  created_by: null,
  title: 'Call back lead',
  notes: 'ring at 3pm',
  due_at: new Date(Date.now() + 3_600_000).toISOString(),
  completed_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe('AssignedTasksColumn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    personalData.current = [];
  });

  it('shows personal calendar tasks assigned to me next to deal/job tasks', () => {
    personalData.current = [personalTask];
    render(wrap(<AssignedTasksColumn />));
    expect(screen.getByText('Call back lead')).toBeInTheDocument();
    expect(screen.getByText('Renew domain')).toBeInTheDocument();
    expect(screen.getByText('(2)')).toBeInTheDocument();
  });

  it('clicking a personal task opens the edit dialog', async () => {
    const user = userEvent.setup();
    personalData.current = [personalTask];
    render(wrap(<AssignedTasksColumn />));
    await user.click(screen.getByRole('button', { name: /call back lead/i }));
    expect(screen.getByRole('dialog', { name: /edit task/i })).toBeInTheDocument();
  });

  it('resolving a personal task marks it complete', async () => {
    const user = userEvent.setup();
    personalData.current = [personalTask];
    render(wrap(<AssignedTasksColumn />));
    // Personal tasks render first, so its Resolve button is the first one.
    const resolveButtons = screen.getAllByRole('button', { name: /resolve/i });
    await user.click(resolveButtons[0]!);
    expect(togglePersonalSpy).toHaveBeenCalledWith({ id: 'p1', completed: true });
  });

  it('renders the open tasks for the current user', () => {
    render(wrap(<AssignedTasksColumn />));
    expect(screen.getByText('Renew domain')).toBeInTheDocument();
    expect(screen.getByText('Acme Ltd')).toBeInTheDocument();
    expect(screen.getByText(/000013/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /resolve/i })).toBeInTheDocument();
  });

  it('links the source code to the originating deal', () => {
    render(wrap(<AssignedTasksColumn />));
    const link = screen.getByRole('link', { name: /000013/i });
    expect(link).toHaveAttribute('href', '/deals/d1');
  });

  it('shows the department chip on the row', () => {
    render(wrap(<AssignedTasksColumn />));
    expect(screen.getByText('Web Dev')).toBeInTheDocument();
  });

  it('clicking the row opens the detail dialog', async () => {
    const user = userEvent.setup();
    render(wrap(<AssignedTasksColumn />));
    await user.click(screen.getByRole('button', { name: /renew domain/i }));
    expect(screen.getByRole('dialog', { name: /task detail/i })).toBeInTheDocument();
  });

  it('clicking the source-code badge does not also open the dialog', async () => {
    const user = userEvent.setup();
    render(wrap(<AssignedTasksColumn />));
    await user.click(screen.getByRole('link', { name: /000013/i }));
    expect(screen.queryByRole('dialog', { name: /task detail/i })).not.toBeInTheDocument();
  });

  it('clicking Resolve does not open the dialog', async () => {
    const user = userEvent.setup();
    render(wrap(<AssignedTasksColumn />));
    await user.click(screen.getByRole('button', { name: /resolve/i }));
    expect(screen.queryByRole('dialog', { name: /task detail/i })).not.toBeInTheDocument();
  });
});
