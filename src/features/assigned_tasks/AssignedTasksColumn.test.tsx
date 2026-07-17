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

const { personalData, assignedData, resolveSpy, unresolveSpy } = vi.hoisted(() => ({
  personalData: { current: [] as Array<Record<string, unknown>> },
  assignedData: { current: [] as Array<Record<string, unknown>> },
  resolveSpy: vi.fn(),
  unresolveSpy: vi.fn(),
}));

vi.mock('./hooks/useAssignedTasksOpen', () => ({
  useAssignedTasksOpen: ({ assigneeUserId }: { assigneeUserId: string | null }) => ({
    data: assigneeUserId === 'u-me' ? assignedData.current : [],
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

vi.mock('@/features/home/hooks/useOpenUserTasks', () => ({
  useOpenUserTasks: ({ assigneeUserId }: { assigneeUserId: string | null }) => ({
    data: assigneeUserId === 'u-me' ? personalData.current : [],
    isLoading: false,
  }),
}));

vi.mock('@/features/home/hooks/useDeleteTask', () => ({
  useToggleTaskComplete: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/features/tasks/hooks/useResolveTask', () => ({
  useResolveTask: () => ({ mutate: resolveSpy, isPending: false }),
  useUnresolveTask: () => ({ mutate: unresolveSpy, isPending: false }),
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

// A deal/job-scoped assigned task where I'm the assignee, no stamps yet.
const assignedTask = {
  id: 't1', title: 'Renew domain', description: 'before May 30',
  deal_id: 'd1', job_id: null, client_id: 'c1', source_code: '000013',
  assignee_user_id: 'u-me', created_by_user_id: 'u-other',
  status: 'open', resolved_at: null, resolved_by_user_id: null,
  creator_resolved_at: null, assignee_resolved_at: null,
  created_at: new Date().toISOString(),
  client: { id: 'c1', name: 'Acme Ltd' },
  department: { id: 'g1', code: 'web_dev', display_names: { en: 'Web Dev', el: 'Web Dev' }, position: 50 },
};

const personalTask = {
  id: 'p1',
  user_id: 'u-me',
  created_by: null,
  title: 'Call back lead',
  notes: 'ring at 3pm',
  due_at: new Date(Date.now() + 3_600_000).toISOString(),
  completed_at: null,
  creator_resolved_at: null,
  assignee_resolved_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe('AssignedTasksColumn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    personalData.current = [];
    assignedData.current = [assignedTask];
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

  it('resolving a personal task stamps it via resolve_task (kind user)', async () => {
    const user = userEvent.setup();
    personalData.current = [personalTask];
    assignedData.current = [];
    render(wrap(<AssignedTasksColumn />));
    await user.click(screen.getByRole('button', { name: /resolve/i }));
    expect(resolveSpy).toHaveBeenCalledWith({ kind: 'user', id: 'p1' });
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
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('clicking the source-code badge does not also open the dialog', async () => {
    const user = userEvent.setup();
    render(wrap(<AssignedTasksColumn />));
    await user.click(screen.getByRole('link', { name: /000013/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('clicking Resolve does not open the dialog', async () => {
    const user = userEvent.setup();
    render(wrap(<AssignedTasksColumn />));
    await user.click(screen.getByRole('button', { name: /resolve/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  // --- Dual-resolve parity ---------------------------------------------------

  it('hides an open assigned task whose viewer side is already stamped', () => {
    // The viewer is the assignee and has already stamped their side while the
    // task is still open. Task 3: that row disappears from the viewer's widget
    // (it lives in the board's viewer-relative Resolved column instead). A row
    // still needing the viewer stays visible as a control.
    assignedData.current = [
      {
        ...assignedTask,
        id: 't-stamped', title: 'Stamped by me',
        assignee_user_id: 'u-me', created_by_user_id: 'u-other',
        assignee_resolved_at: new Date().toISOString(), creator_resolved_at: null,
      },
      {
        ...assignedTask,
        id: 't-open', title: 'Still needs me',
        assignee_user_id: 'u-me', created_by_user_id: 'u-other',
        assignee_resolved_at: null, creator_resolved_at: null,
      },
    ];
    personalData.current = [];
    render(wrap(<AssignedTasksColumn />));
    expect(screen.queryByText('Stamped by me')).not.toBeInTheDocument();
    expect(screen.getByText('Still needs me')).toBeInTheDocument();
  });

  it('hides an open personal task whose viewer side is already stamped', () => {
    // Same rule for the personal/user-task list: viewer = assignee (user_id),
    // own stamp set, still open → hidden; an unstamped personal row stays.
    personalData.current = [
      {
        ...personalTask,
        id: 'p-stamped', title: 'Personal stamped by me',
        user_id: 'u-me', created_by: 'u-other',
        assignee_resolved_at: new Date().toISOString(), creator_resolved_at: null,
      },
      {
        ...personalTask,
        id: 'p-open', title: 'Personal still open',
        user_id: 'u-me', created_by: 'u-other',
        assignee_resolved_at: null, creator_resolved_at: null,
      },
    ];
    assignedData.current = [];
    render(wrap(<AssignedTasksColumn />));
    expect(screen.queryByText('Personal stamped by me')).not.toBeInTheDocument();
    expect(screen.getByText('Personal still open')).toBeInTheDocument();
  });

  it('shows Confirm & close when the other side stamped first', () => {
    assignedData.current = [{
      ...assignedTask,
      assignee_user_id: 'u-me', created_by_user_id: 'u-other',
      assignee_resolved_at: null, creator_resolved_at: new Date().toISOString(),
    }];
    render(wrap(<AssignedTasksColumn />));
    expect(screen.getByRole('button', { name: /confirm & close/i })).toBeInTheDocument();
  });

  it('resolves a personal task delegated to me via resolve_task (kind user)', async () => {
    const user = userEvent.setup();
    personalData.current = [{
      ...personalTask,
      user_id: 'u-me', created_by: 'u-other',
      creator_resolved_at: null, assignee_resolved_at: null,
    }];
    assignedData.current = [];
    render(wrap(<AssignedTasksColumn />));
    await user.click(screen.getByRole('button', { name: /resolve/i }));
    expect(resolveSpy).toHaveBeenCalledWith({ kind: 'user', id: 'p1' });
  });

  it('shows no resolve button when I am neither party and not admin', () => {
    assignedData.current = [{
      ...assignedTask,
      assignee_user_id: 'u-other', created_by_user_id: 'u-third',
      assignee_resolved_at: null, creator_resolved_at: null,
    }];
    personalData.current = [];
    render(wrap(<AssignedTasksColumn />));
    expect(screen.getByText('Renew domain')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /resolve|withdraw|confirm/i }),
    ).not.toBeInTheDocument();
  });
});
