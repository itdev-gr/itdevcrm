import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const userTask: { row: Record<string, unknown> | null; isLoading: boolean } = { row: null, isLoading: false };
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: { user: { id: string } }) => unknown) => sel({ user: { id: 'me' } }),
}));
vi.mock('@/features/tasks/hooks/useUserTask', () => ({
  useUserTask: () => ({ data: userTask.row, isLoading: userTask.isLoading }),
}));
vi.mock('@/features/assigned_tasks/AssignedTaskDetailDialog', () => ({
  AssignedTaskDetailDialog: ({ taskId }: { taskId: string }) => <div>assigned-dialog:{taskId}</div>,
}));
vi.mock('@/features/tasks/UserTaskDetailDialog', () => ({
  UserTaskDetailDialog: ({ card }: { card: { id: string } }) => <div>user-dialog:{card.id}</div>,
}));

import { TaskCommentLink } from './TaskCommentLink';

const UUID = '0d3a4f21-9bcd-4bf5-b09b-0ccb7341a7ad';

describe('TaskCommentLink', () => {
  beforeEach(() => { userTask.row = null; userTask.isLoading = false; });

  it('renders nothing for a malformed key', () => {
    const { container } = render(<TaskCommentLink taskKey="garbage" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('opens the assigned task dialog on click', async () => {
    render(<TaskCommentLink taskKey={`assigned:${UUID}`} />);
    await userEvent.click(screen.getByRole('button', { name: /open task/i }));
    expect(screen.getByText(`assigned-dialog:${UUID}`)).toBeInTheDocument();
  });

  it('opens the user task dialog when the row is accessible', async () => {
    userTask.row = { id: UUID, title: 'T', user_id: 'me', created_by: 'me', due_at: null, completed_at: null, importance: 'low', notes: null, created_at: null, started_at: null, client_id: null, lead_id: null };
    render(<TaskCommentLink taskKey={`user:${UUID}`} />);
    await userEvent.click(screen.getByRole('button', { name: /open task/i }));
    expect(screen.getByText(`user-dialog:${UUID}`)).toBeInTheDocument();
  });

  it("shows the no-access message when the user task row is not readable", async () => {
    userTask.row = null;
    render(<TaskCommentLink taskKey={`user:${UUID}`} />);
    await userEvent.click(screen.getByRole('button', { name: /open task/i }));
    expect(screen.getByText(/not found or you don't have access/i)).toBeInTheDocument();
  });
});
