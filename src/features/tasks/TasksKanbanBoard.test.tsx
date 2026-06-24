import type { ReactNode } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const { useTaskBoardData } = vi.hoisted(() => ({ useTaskBoardData: vi.fn() }));
const { useMentionableUsers } = vi.hoisted(() => ({ useMentionableUsers: vi.fn() }));
const apply = vi.fn();
vi.mock('./hooks/useTaskBoardData', () => ({ useTaskBoardData, isoDaysAgo: () => '2026-05-23T00:00:00Z' }));
vi.mock('./hooks/useTaskBoardActions', () => ({ useTaskBoardActions: () => ({ mutate: apply }) }));
vi.mock('@/features/comments/hooks/useMentionableUsers', () => ({ useMentionableUsers }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o?.name ? `${k}:${o.name}` : k), i18n: { resolvedLanguage: 'en' } }),
}));
vi.mock('react-router-dom', () => ({ Link: ({ children }: { children: ReactNode }) => <a>{children}</a> }));
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ isAdmin: false, user: { id: 'me' } }),
}));

import { TasksKanbanBoard } from './TasksKanbanBoard';

const assignedRow = (o = {}) => ({
  id: 'a1', title: 'Mine urgent', assignee_user_id: 'me', created_by_user_id: 'me',
  status: 'open', resolved_at: null, importance: 'urgent', source_code: 'D-1',
  deal_id: 'd1', job_id: null, description: null, client: null, department: null, ...o,
});

describe('TasksKanbanBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMentionableUsers.mockReturnValue({ data: [{ user_id: 'colleague', full_name: 'Colleague', email: 'c@x.gr', is_admin: false, group_codes: [] }] });
  });

  it('places my urgent task in the Urgent column and resolves via the button', () => {
    useTaskBoardData.mockReturnValue({ userRows: [], assignedRows: [assignedRow()], isLoading: false });
    render(<TasksKanbanBoard />);
    const urgent = screen.getByTestId('tasks-col-urgent');
    expect(within(urgent).getByText('Mine urgent')).toBeInTheDocument();
    fireEvent.click(within(urgent).getByRole('button', { name: /tasks_page.resolve/ }));
    expect(apply).toHaveBeenCalledWith({ card: expect.objectContaining({ id: 'a1' }), action: { type: 'resolve' } });
  });

  it('By me filter shows delegated tasks (read-only) and hides my own', () => {
    useTaskBoardData.mockReturnValue({
      userRows: [],
      assignedRows: [assignedRow(), assignedRow({ id: 'a2', title: 'Handed off', assignee_user_id: 'colleague', importance: 'high' })],
      isLoading: false,
    });
    render(<TasksKanbanBoard />);
    fireEvent.click(screen.getByText('tasks_page.filter_by_me'));
    expect(screen.queryByText('Mine urgent')).not.toBeInTheDocument();
    const high = screen.getByTestId('tasks-col-high');
    expect(within(high).getByText('Handed off')).toBeInTheDocument();
    expect(within(high).queryByRole('button', { name: /tasks_page.resolve/ })).not.toBeInTheDocument();
    expect(within(high).getByText('tasks_page.assigned_to:Colleague')).toBeInTheDocument();
  });
});
