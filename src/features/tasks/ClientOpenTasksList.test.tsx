import { render, screen, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { i18n } from '@/lib/i18n';
import type { TaskCard } from '@/features/tasks/taskCard';

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: { user: { id: string } }) => unknown) => sel({ user: { id: 'me' } }),
}));

const hookRef: { cards: TaskCard[]; isLoading: boolean } = { cards: [], isLoading: false };
vi.mock('@/features/clients/hooks/useClientTasks', () => ({
  useClientTasks: () => hookRef,
}));
vi.mock('@/features/assigned_tasks/AssignedTaskDetailDialog', () => ({
  AssignedTaskDetailDialog: ({ taskId }: { taskId: string }) => <div>assigned-detail:{taskId}</div>,
}));
vi.mock('@/features/tasks/UserTaskDetailDialog', () => ({
  UserTaskDetailDialog: ({ card }: { card: TaskCard }) => <div>user-detail:{card.id}</div>,
}));

import { ClientOpenTasksList } from './ClientOpenTasksList';

function card(p: Partial<TaskCard>): TaskCard {
  return {
    key: p.key ?? `${p.kind ?? 'user'}:${p.id ?? 'x'}`,
    kind: p.kind ?? 'user',
    id: p.id ?? 'x',
    title: p.title ?? 'Task',
    importance: p.importance ?? 'low',
    relation: 'other',
    resolved: p.resolved ?? false,
    assigneeId: 'a',
    creatorId: null,
    createdAtIso: null,
    dueAt: null,
    resolvedAt: null,
    startedAtIso: null,
    sourceCode: p.sourceCode ?? null,
    link: null,
    notes: null,
    clientName: null,
    leadName: null,
    creatorResolvedAt: null,
    assigneeResolvedAt: null,
    summary: null,
  };
}

function wrap(node: React.ReactNode) {
  return <I18nextProvider i18n={i18n}>{node}</I18nextProvider>;
}

describe('ClientOpenTasksList', () => {
  beforeEach(() => {
    hookRef.cards = [];
    hookRef.isLoading = false;
  });

  it('shows only open tasks with a count and labels', () => {
    hookRef.cards = [
      card({ kind: 'user', id: 'u1', title: 'Open personal' }),
      card({ kind: 'user', id: 'u2', title: 'Done personal', resolved: true }),
      card({ kind: 'assigned', id: 'a1', title: 'Deal task', sourceCode: '000512-WEBSEO' }),
    ];
    render(wrap(<ClientOpenTasksList clientId="C1" />));
    expect(screen.getByText(/open tasks on this client/i)).toHaveTextContent('(2)');
    expect(screen.getByText('Open personal')).toBeInTheDocument();
    expect(screen.getByText('Deal task')).toBeInTheDocument();
    expect(screen.getByText('000512-WEBSEO')).toBeInTheDocument();
    expect(screen.queryByText('Done personal')).not.toBeInTheDocument();
  });

  it('renders the empty message when there are no open tasks', () => {
    hookRef.cards = [card({ kind: 'user', id: 'u2', resolved: true })];
    render(wrap(<ClientOpenTasksList clientId="C1" />));
    expect(screen.getByText(/no open tasks on this client/i)).toBeInTheDocument();
  });

  it('opens the user detail dialog when a personal row is clicked', () => {
    hookRef.cards = [card({ kind: 'user', id: 'u1', title: 'Open personal' })];
    render(wrap(<ClientOpenTasksList clientId="C1" />));
    fireEvent.click(screen.getByText('Open personal'));
    expect(screen.getByText('user-detail:u1')).toBeInTheDocument();
  });

  it('opens the assigned detail dialog when a deal/job row is clicked', () => {
    hookRef.cards = [card({ kind: 'assigned', id: 'a1', title: 'Deal task' })];
    render(wrap(<ClientOpenTasksList clientId="C1" />));
    fireEvent.click(screen.getByText('Deal task'));
    expect(screen.getByText('assigned-detail:a1')).toBeInTheDocument();
  });
});
