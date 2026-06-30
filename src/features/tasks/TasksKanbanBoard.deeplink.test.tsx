import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const { useTaskBoardData } = vi.hoisted(() => ({ useTaskBoardData: vi.fn() }));
const { useMentionableUsers } = vi.hoisted(() => ({ useMentionableUsers: vi.fn() }));
vi.mock('./hooks/useTaskBoardData', () => ({
  useTaskBoardData,
  isoDaysAgo: () => '2026-05-23T00:00:00Z',
}));
vi.mock('./hooks/useTaskBoardActions', () => ({
  useTaskBoardActions: () => ({ mutate: vi.fn() }),
}));
vi.mock('@/features/comments/hooks/useMentionableUsers', () => ({ useMentionableUsers }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { resolvedLanguage: 'en' },
  }),
}));
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ isAdmin: false, user: { id: 'me' } }),
}));

vi.mock('@/features/assigned_tasks/AssignedTaskDetailDialog', () => ({
  AssignedTaskDetailDialog: ({ taskId }: { taskId: string }) => (
    <div data-testid="assigned-dialog">assigned:{taskId}</div>
  ),
}));
vi.mock('./UserTaskDetailDialog', () => ({
  UserTaskDetailDialog: ({ card }: { card: { id: string } }) => (
    <div data-testid="user-dialog">user:{card.id}</div>
  ),
}));

import { TasksKanbanBoard } from './TasksKanbanBoard';

const assignedRow = (id: string) => ({
  id,
  title: `task-${id}`,
  assignee_user_id: 'me',
  created_by_user_id: 'someone',
  status: 'open',
  resolved_at: null,
  importance: 'urgent',
  source_code: 'X-1',
  deal_id: 'd1',
  job_id: null,
  description: null,
  client: null,
  department: null,
});
const userRow = (id: string) => ({
  id,
  title: `personal-${id}`,
  user_id: 'me',
  created_by: 'someone',
  completed_at: null,
  importance: 'urgent',
  due_at: null,
  created_at: '2026-06-30T08:00:00Z',
  started_at: null,
  notes: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  useMentionableUsers.mockReturnValue({ data: [] });
});

describe('TasksKanbanBoard deep-link via ?open=', () => {
  it('opens the assigned-task dialog when the URL says ?open=assigned:<id>', () => {
    useTaskBoardData.mockReturnValue({
      userRows: [],
      assignedRows: [assignedRow('a1'), assignedRow('a2')],
      isLoading: false,
    });
    render(
      <MemoryRouter initialEntries={['/tasks?open=assigned:a2']}>
        <TasksKanbanBoard />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('assigned-dialog')).toHaveTextContent('assigned:a2');
    expect(screen.queryByTestId('user-dialog')).not.toBeInTheDocument();
  });

  it('opens the user-task dialog when the URL says ?open=user:<id>', () => {
    useTaskBoardData.mockReturnValue({
      userRows: [userRow('u1')],
      assignedRows: [],
      isLoading: false,
    });
    render(
      <MemoryRouter initialEntries={['/tasks?open=user:u1']}>
        <TasksKanbanBoard />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('user-dialog')).toHaveTextContent('user:u1');
  });

  it('opens nothing when ?open is absent', () => {
    useTaskBoardData.mockReturnValue({
      userRows: [],
      assignedRows: [assignedRow('a1')],
      isLoading: false,
    });
    render(
      <MemoryRouter initialEntries={['/tasks']}>
        <TasksKanbanBoard />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('assigned-dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('user-dialog')).not.toBeInTheDocument();
  });

  it('ignores ?open= pointing at a task that is not on the board', () => {
    useTaskBoardData.mockReturnValue({
      userRows: [],
      assignedRows: [assignedRow('a1')],
      isLoading: false,
    });
    render(
      <MemoryRouter initialEntries={['/tasks?open=assigned:missing']}>
        <TasksKanbanBoard />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('assigned-dialog')).not.toBeInTheDocument();
  });
});
