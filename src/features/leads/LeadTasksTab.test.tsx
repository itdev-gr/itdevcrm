import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { vi, describe, it, expect } from 'vitest';
import { i18n } from '@/lib/i18n';
import type { TaskCard } from '@/features/tasks/taskCard';

const cards: TaskCard[] = [];
vi.mock('./hooks/useLeadTasks', () => ({
  useLeadTasks: () => ({ cards, isLoading: false }),
}));
vi.mock('@/features/home/TaskDialog', () => ({
  TaskDialog: ({ open }: { open: boolean }) => (open ? <div>task-dialog</div> : null),
}));
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: { user: { id: string } }) => unknown) => sel({ user: { id: 'me' } }),
}));

import { LeadTasksTab } from './LeadTasksTab';

function wrap(node: React.ReactNode) {
  return <I18nextProvider i18n={i18n}>{node}</I18nextProvider>;
}

describe('LeadTasksTab', () => {
  it('shows the empty state and opens the new-task dialog', async () => {
    const userEvent = (await import('@testing-library/user-event')).default;
    const user = userEvent.setup();
    render(wrap(<LeadTasksTab leadId="L1" leadTitle="Bakery" />));
    expect(screen.getByText(/no tasks for this lead/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /new task/i }));
    expect(screen.getByText('task-dialog')).toBeInTheDocument();
  });
});
