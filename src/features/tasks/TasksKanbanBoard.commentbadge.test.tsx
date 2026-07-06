import type { ReactNode } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const { useTaskBoardData } = vi.hoisted(() => ({ useTaskBoardData: vi.fn() }));
const { useMentionableUsers } = vi.hoisted(() => ({ useMentionableUsers: vi.fn() }));
const { useUnreadCommentNotifs } = vi.hoisted(() => ({ useUnreadCommentNotifs: vi.fn() }));
const markRead = vi.fn();
vi.mock('./hooks/useTaskBoardData', () => ({ useTaskBoardData, isoDaysAgo: () => '2026-05-23T00:00:00Z' }));
vi.mock('./hooks/useTaskBoardActions', () => ({ useTaskBoardActions: () => ({ mutate: vi.fn() }) }));
vi.mock('@/features/comments/hooks/useMentionableUsers', () => ({ useMentionableUsers }));
vi.mock('@/features/notifications/hooks/useUnreadCommentNotifs', () => ({ useUnreadCommentNotifs }));
vi.mock('@/features/notifications/hooks/useMarkNotificationsRead', () => ({
  useMarkNotificationsRead: () => ({ mutate: markRead }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o?.name ? `${k}:${o.name}` : k), i18n: { resolvedLanguage: 'en' } }),
}));
vi.mock('react-router-dom', () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  useSearchParams: () => [new URLSearchParams(), () => {}] as const,
}));
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ isAdmin: false, user: { id: 'me' } }),
}));
vi.mock('@/features/assigned_tasks/AssignedTaskDetailDialog', () => ({
  AssignedTaskDetailDialog: () => <div>assigned-dialog</div>,
}));
vi.mock('./UserTaskDetailDialog', () => ({ UserTaskDetailDialog: () => <div>user-dialog</div> }));

import { TasksKanbanBoard } from './TasksKanbanBoard';

const assignedRow = (o = {}) => ({
  id: 'a1', title: 'Mine urgent', assignee_user_id: 'me', created_by_user_id: 'me',
  status: 'open', resolved_at: null, importance: 'urgent', source_code: 'D-1',
  deal_id: 'd1', job_id: null, description: null, client: null, department: null, ...o,
});

describe('TasksKanbanBoard unread-comment badge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMentionableUsers.mockReturnValue({ data: [] });
    useTaskBoardData.mockReturnValue({ userRows: [], assignedRows: [assignedRow()], isLoading: false });
  });

  it('shows the 💬 count for a card with unread comments', () => {
    useUnreadCommentNotifs.mockReturnValue({ data: [
      { id: 'n1', payload: { task_kind: 'assigned_task', task_id: 'a1' } },
      { id: 'n2', payload: { task_kind: 'assigned_task', task_id: 'a1' } },
    ] });
    render(<TasksKanbanBoard />);
    expect(within(screen.getByTestId('tasks-col-urgent')).getByText('💬 2')).toBeInTheDocument();
  });

  it('shows no badge without unread comments', () => {
    useUnreadCommentNotifs.mockReturnValue({ data: [] });
    render(<TasksKanbanBoard />);
    expect(screen.queryByText(/💬/)).not.toBeInTheDocument();
  });

  it('opening the card marks exactly its notification ids read', () => {
    useUnreadCommentNotifs.mockReturnValue({ data: [
      { id: 'n1', payload: { task_kind: 'assigned_task', task_id: 'a1' } },
      { id: 'nOther', payload: { task_kind: 'assigned_task', task_id: 'zzz' } },
    ] });
    render(<TasksKanbanBoard />);
    fireEvent.click(within(screen.getByTestId('tasks-col-urgent')).getByText('Mine urgent'));
    expect(markRead).toHaveBeenCalledWith(['n1']);
  });

  it('opening a card without unread comments does not call mark-read', () => {
    useUnreadCommentNotifs.mockReturnValue({ data: [] });
    render(<TasksKanbanBoard />);
    fireEvent.click(within(screen.getByTestId('tasks-col-urgent')).getByText('Mine urgent'));
    expect(markRead).not.toHaveBeenCalled();
  });

  it('marks comments read when notifications resolve after the card was opened', () => {
    useUnreadCommentNotifs.mockReturnValue({ data: [] });
    const { rerender } = render(<TasksKanbanBoard />);
    fireEvent.click(within(screen.getByTestId('tasks-col-urgent')).getByText('Mine urgent'));
    expect(markRead).not.toHaveBeenCalled();
    useUnreadCommentNotifs.mockReturnValue({ data: [
      { id: 'nLate', payload: { task_kind: 'assigned_task', task_id: 'a1' } },
    ] });
    rerender(<TasksKanbanBoard />);
    expect(markRead).toHaveBeenCalledWith(['nLate']);
  });
});
