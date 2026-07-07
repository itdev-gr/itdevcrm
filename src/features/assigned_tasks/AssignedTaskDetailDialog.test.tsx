import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import '@/lib/i18n';

const { taskData, authState, resolveMutate } = vi.hoisted(() => ({
  taskData: { current: null as Record<string, unknown> | null },
  authState: { current: { userId: 'me', isAdmin: false, groupCodes: ['accounting'] as string[] } },
  resolveMutate: vi.fn(),
}));

vi.mock('./hooks/useAssignedTaskDetail', () => ({
  useAssignedTaskDetail: () => ({ data: taskData.current, isLoading: false, error: null }),
}));
vi.mock('./hooks/useResolveAssignedTask', () => ({
  useResolveAssignedTask: () => ({ mutateAsync: resolveMutate, isPending: false }),
}));
vi.mock('./hooks/useDealServiceJob', () => ({
  useDealServiceJob: () => ({ data: null }),
}));
vi.mock('@/features/tasks/TaskComments', () => ({
  TaskComments: () => <p>COMMENTS_THREAD</p>,
}));
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      user: { id: authState.current.userId },
      isAdmin: authState.current.isAdmin,
      groupCodes: authState.current.groupCodes,
    }),
}));

import { AssignedTaskDetailDialog } from './AssignedTaskDetailDialog';

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MemoryRouter>
  );
}

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    title: 'Do the thing',
    description: null,
    deal_id: 'deal-1',
    job_id: null,
    client_id: 'c1',
    source_code: '005230',
    assignee_user_id: 'other-user',
    created_by_user_id: 'another-user',
    status: 'open',
    resolved_at: null,
    resolved_by_user_id: null,
    created_at: '2026-07-07T00:00:00Z',
    importance: 'medium',
    started_at: null,
    department_group_id: null,
    client: null,
    department: null,
    assignee: { full_name: 'Other User', email: 'o@x.gr' },
    creator: { full_name: 'Another User', email: 'a@x.gr' },
    ...overrides,
  };
}

const fullDetail = {
  id: 't1', title: 'TEST — smoke', description: 'desc',
  deal_id: 'd1', job_id: null, client_id: 'c1', source_code: '000017',
  assignee_user_id: 'u-me', created_by_user_id: 'u-other',
  status: 'open', resolved_at: null, resolved_by_user_id: null,
  created_at: new Date().toISOString(), importance: 'medium', started_at: null,
  department_group_id: 'g1',
  client: {
    id: 'c1', name: 'Pindos Outdoor Gear', industry: 'fitness_sports',
    contact_first_name: 'Christos', contact_last_name: 'Tsilis',
    email: 'ct@p.gr', phone: '+30 1',
  },
  creator: { user_id: 'u-other', full_name: 'Smoke Test', email: 's@t.gr' },
  assignee: { user_id: 'u-me', full_name: 'Me', email: 'me@t.gr' },
  department: { id: 'g1', code: 'web_dev', display_names: { en: 'Web Dev', el: 'Web Dev' }, position: 50 },
};

// Admin viewer → can open the deal, so a deal-scoped task keeps the "Open deal" link.
// (The technical-user → "Open job" branch is covered by taskOpenLink.test.ts.)
describe('AssignedTaskDetailDialog — rendering + resolve (admin party)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.current = { userId: 'u-me', isAdmin: true, groupCodes: [] };
    taskData.current = fullDetail;
  });

  it('renders title, department, client + contact, and links the source', () => {
    render(wrap(<AssignedTaskDetailDialog taskId="t1" onOpenChange={() => {}} />));
    expect(screen.getByText('TEST — smoke')).toBeInTheDocument();
    expect(screen.getByText('Web Dev')).toBeInTheDocument();
    expect(screen.getByText('Pindos Outdoor Gear')).toBeInTheDocument();
    // Industry codes render as display labels, never raw slugs.
    expect(screen.getByText(/Fitness & Sports/)).toBeInTheDocument();
    expect(screen.queryByText(/fitness_sports/)).not.toBeInTheDocument();
    expect(screen.getByText('Christos Tsilis')).toBeInTheDocument();
    expect(screen.getByText('+30 1')).toBeInTheDocument();
    expect(screen.getByText('ct@p.gr')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open deal/i })).toHaveAttribute('href', '/deals/d1');
  });

  it('Resolve calls the mutation and closes the dialog', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(wrap(<AssignedTaskDetailDialog taskId="t1" onOpenChange={onOpenChange} />));
    await user.click(screen.getByRole('button', { name: /resolve/i }));
    await waitFor(() => expect(resolveMutate).toHaveBeenCalledWith({ id: 't1' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('AssignedTaskDetailDialog — non-party accounting viewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.current = { userId: 'me', isAdmin: false, groupCodes: ['accounting'] };
  });

  it('hides Resolve and shows the participants-only note for a non-party', () => {
    taskData.current = task();
    render(wrap(<AssignedTaskDetailDialog taskId="t1" onOpenChange={() => {}} />));
    expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull();
    expect(screen.queryByText('COMMENTS_THREAD')).toBeNull();
    expect(screen.getByText("Comments are visible to the task's participants only.")).toBeTruthy();
  });

  it('shows Resolve and the thread for the assignee', () => {
    taskData.current = task({ assignee_user_id: 'me' });
    render(wrap(<AssignedTaskDetailDialog taskId="t1" onOpenChange={() => {}} />));
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeTruthy();
    expect(screen.getByText('COMMENTS_THREAD')).toBeTruthy();
  });

  it('shows Resolve and the thread for an admin', () => {
    authState.current = { userId: 'me', isAdmin: true, groupCodes: [] };
    taskData.current = task();
    render(wrap(<AssignedTaskDetailDialog taskId="t1" onOpenChange={() => {}} />));
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeTruthy();
    expect(screen.getByText('COMMENTS_THREAD')).toBeTruthy();
  });
});
