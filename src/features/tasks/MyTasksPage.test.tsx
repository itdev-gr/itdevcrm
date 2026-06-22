import type { ReactNode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const { useOpenUserTasks } = vi.hoisted(() => ({ useOpenUserTasks: vi.fn() }));
const { useAssignedTasksOpen } = vi.hoisted(() => ({ useAssignedTasksOpen: vi.fn() }));
const complete = vi.fn();
const resolve = vi.fn();
vi.mock('@/features/home/hooks/useOpenUserTasks', () => ({ useOpenUserTasks }));
vi.mock('@/features/assigned_tasks/hooks/useAssignedTasksOpen', () => ({ useAssignedTasksOpen }));
vi.mock('@/features/home/hooks/useDeleteTask', () => ({
  useToggleTaskComplete: () => ({ mutate: complete, isPending: false }),
}));
vi.mock('@/features/assigned_tasks/hooks/useResolveAssignedTask', () => ({
  useResolveAssignedTask: () => ({ mutate: resolve, isPending: false }),
}));
vi.mock('@/features/assigned_tasks/DepartmentChip', () => ({ DepartmentChip: () => null }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { resolvedLanguage: 'en' } }),
}));
vi.mock('react-router-dom', () => ({ Link: ({ children }: { children: ReactNode }) => <a>{children}</a> }));
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) =>
    sel({ isAdmin: false, user: { id: 'me' } }),
}));

import { MyTasksPage } from './MyTasksPage';

describe('MyTasksPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('unions both task types, sorts urgent before low, and shows badges', () => {
    useOpenUserTasks.mockReturnValue({
      data: [
        { id: 'p1', title: 'Low personal', user_id: 'me', due_at: '2026-07-01T10:00:00Z', notes: null, importance: 'low' },
      ],
    });
    useAssignedTasksOpen.mockReturnValue({
      data: [
        { id: 'a1', title: 'Urgent assigned', assignee_user_id: 'me', source_code: 'D-1', deal_id: 'd1', job_id: null, description: null, client: null, department: null, importance: 'urgent' },
      ],
    });
    render(<MyTasksPage />);
    const titles = screen.getAllByText(/personal|assigned/i).map((n) => n.textContent);
    // urgent assigned task must appear before the low personal task
    expect(titles.indexOf('Urgent assigned')).toBeLessThan(titles.indexOf('Low personal'));
    expect(screen.getByText('importance.urgent')).toBeInTheDocument();
    expect(screen.getByText('importance.low')).toBeInTheDocument();
  });

  it('resolves an assigned task and completes a personal task', () => {
    useOpenUserTasks.mockReturnValue({
      data: [{ id: 'p1', title: 'P', user_id: 'me', due_at: '2026-07-01T10:00:00Z', notes: null, importance: 'low' }],
    });
    useAssignedTasksOpen.mockReturnValue({
      data: [{ id: 'a1', title: 'A', assignee_user_id: 'me', source_code: 'D-1', deal_id: 'd1', job_id: null, description: null, client: null, department: null, importance: 'high' }],
    });
    render(<MyTasksPage />);
    const buttons = screen.getAllByRole('button', { name: /assigned_tasks.resolve/ });
    fireEvent.click(buttons[0]!); // assigned task (high) sorts first
    expect(resolve).toHaveBeenCalledWith({ id: 'a1' });
    fireEvent.click(buttons[1]!); // personal task
    expect(complete).toHaveBeenCalledWith({ id: 'p1', completed: true });
  });

  it('shows the empty state when there are no tasks', () => {
    useOpenUserTasks.mockReturnValue({ data: [] });
    useAssignedTasksOpen.mockReturnValue({ data: [] });
    render(<MyTasksPage />);
    expect(screen.getByText('tasks_page.empty')).toBeInTheDocument();
  });
});
