import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect } from 'vitest';
import { i18n } from '@/lib/i18n';

vi.mock('./TasksKanbanBoard', () => ({ TasksKanbanBoard: () => <div>board</div> }));
vi.mock('./ResolvedArchive', () => ({ ResolvedArchive: () => <div>archive</div> }));
const dialogOpen = vi.fn();
vi.mock('@/features/home/TaskDialog', () => ({
  TaskDialog: ({ open }: { open: boolean }) => { dialogOpen(open); return open ? <div>task-dialog</div> : null; },
}));

import { MyTasksPage } from './MyTasksPage';

function wrap(node: React.ReactNode) {
  const qc = new QueryClient();
  return <MemoryRouter><QueryClientProvider client={qc}><I18nextProvider i18n={i18n}>{node}</I18nextProvider></QueryClientProvider></MemoryRouter>;
}

describe('MyTasksPage New task button', () => {
  it('opens the task dialog', async () => {
    const user = userEvent.setup();
    render(wrap(<MyTasksPage />));
    expect(screen.queryByText('task-dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: /new task/i }));
    expect(screen.getByText('task-dialog')).toBeTruthy();
  });
});
