import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>{node}</I18nextProvider>
    </QueryClientProvider>
  );
}

describe('LeadTasksTab', () => {
  it('shows the empty state and opens the new-task dialog', async () => {
    const userEvent = (await import('@testing-library/user-event')).default;
    const user = userEvent.setup();
    render(wrap(<LeadTasksTab leadId="L1" leadTitle="Bakery" />));
    expect(screen.getByText(/no tasks for this lead/i)).not.toBe(null);
    await user.click(screen.getByRole('button', { name: /new task/i }));
    expect(screen.getByText('task-dialog')).not.toBe(null);
  });

  it('lists a task the viewer is not party to and opens its detail dialog', async () => {
    const userEvent = (await import('@testing-library/user-event')).default;
    const user = userEvent.setup();
    cards.push({
      key: 'user:u9', kind: 'user', id: 'u9', title: 'Foreign task',
      importance: 'high', relation: 'other', resolved: false,
      assigneeId: 'a1', creatorId: 'c1', createdAtIso: null, dueAt: null,
      resolvedAt: null, startedAtIso: null, sourceCode: null, link: null,
      notes: null, clientName: null, clientId: null, leadName: null,
      creatorResolvedAt: null, assigneeResolvedAt: null, summary: null,
    });
    render(wrap(<LeadTasksTab leadId="L1" leadTitle="Bakery" />));
    await user.click(screen.getByText('Foreign task'));
    expect(screen.getAllByText('Foreign task').length).toBeGreaterThan(1);
    cards.length = 0;
  });
});
