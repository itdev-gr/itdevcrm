import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { UserTaskRow } from './hooks/useUserTasks';

const upsert = vi.fn().mockResolvedValue('id1');
// Completion no longer rides on the content upsert: ticking Completed routes
// through resolve_task, unticking reopens via a direct user_tasks update.
const resolve = vi.fn().mockResolvedValue({ closed: false, your_side: 'assignee', awaiting: 'c1' });
const { fromFn, updateFn, updateEq } = vi.hoisted(() => {
  const updateEq = vi.fn().mockResolvedValue({ error: null });
  const updateFn = vi.fn(() => ({ eq: updateEq }));
  const fromFn = vi.fn(() => ({ update: updateFn }));
  return { fromFn, updateFn, updateEq };
});
vi.mock('@/lib/supabase', () => ({ supabase: { from: fromFn } }));
vi.mock('./hooks/useUpsertTask', () => ({ useUpsertTask: () => ({ mutateAsync: upsert, isPending: false }) }));
vi.mock('./hooks/useDeleteTask', () => ({ useDeleteTask: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock('@/features/tasks/hooks/useResolveTask', () => ({
  useResolveTask: () => ({ mutateAsync: resolve, isPending: false }),
}));
vi.mock('@/features/comments/hooks/useMentionableUsers', () => ({
  useMentionableUsers: () => ({ data: [{ user_id: 'me', full_name: 'Me', email: 'me@x.gr', is_admin: false, group_codes: [] }] }),
}));
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'me' }, isAdmin: false, groupCodes: [] }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k }) }));
vi.mock('@/features/clients/ClientPicker', () => ({
  ClientPicker: ({ onChange }: { onChange: (c: { id: string; name: string } | null) => void }) => (
    <button type="button" onClick={() => onChange({ id: 'c-acme', name: 'ACME' })}>pick-acme</button>
  ),
}));
// TaskDialog now renders ClientOpenTasksList once a client is picked (create mode);
// stub its data hook so this test needs no QueryClientProvider / network.
vi.mock('@/features/clients/hooks/useClientTasks', () => ({
  useClientTasks: () => ({ cards: [], isLoading: false }),
}));

import { TaskDialog } from './TaskDialog';

function wrap(node: React.ReactNode) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

function makeTask(overrides: Partial<UserTaskRow>): UserTaskRow {
  return {
    id: 'T1', title: 'Editing', notes: null, due_at: new Date().toISOString(),
    completed_at: null, user_id: 'me', created_by: 'me', client_id: null, lead_id: null,
    importance: 'low', started_at: null, created_at: null,
    ...overrides,
  } as unknown as UserTaskRow;
}

describe('TaskDialog importance', () => {
  beforeEach(() => vi.clearAllMocks());

  it('submits the selected client_id on create', async () => {
    const user = userEvent.setup();
    render(wrap(<TaskDialog open onOpenChange={() => {}} />));
    await user.type(screen.getByLabelText('Title'), 'Call ACME');
    await user.click(screen.getByRole('button', { name: /pick-acme/i }));
    await user.selectOptions(screen.getByLabelText('Importance'), 'low');
    await user.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() =>
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Call ACME', client_id: 'c-acme' }),
      ),
    );
    // Content upsert never carries completion state anymore.
    expect(upsert.mock.calls.at(0)?.[0]).not.toHaveProperty('completed_at');
  });

  it('requires importance before Save is enabled, then includes it in the payload', async () => {
    render(wrap(<TaskDialog open onOpenChange={() => {}} />));
    // Title + due are prefilled (due defaults to now); importance starts empty → Save disabled.
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'My task' } });
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Importance'), { target: { value: 'high' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ importance: 'high', title: 'My task' }));
    expect(upsert.mock.calls.at(0)?.[0]).not.toHaveProperty('completed_at');
  });
});

describe('TaskDialog completion transitions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('routes ticking Completed on an open task through resolve_task', async () => {
    const user = userEvent.setup();
    render(wrap(<TaskDialog open onOpenChange={() => {}} task={makeTask({ completed_at: null })} />));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(resolve).toHaveBeenCalledWith({ kind: 'user', id: 'T1' }));
    // Never a direct completed_at write on the open→completed path.
    expect(fromFn).not.toHaveBeenCalled();
  });

  it('reopens a completed task via a direct user_tasks update, not resolve_task', async () => {
    const user = userEvent.setup();
    render(
      wrap(
        <TaskDialog open onOpenChange={() => {}} task={makeTask({ completed_at: '2026-07-01T00:00:00Z' })} />,
      ),
    );
    await user.click(screen.getByRole('checkbox')); // untick (starts checked)
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fromFn).toHaveBeenCalledWith('user_tasks'));
    expect(updateFn).toHaveBeenCalledWith({ completed_at: null });
    expect(updateEq).toHaveBeenCalledWith('id', 'T1');
    expect(resolve).not.toHaveBeenCalled();
  });
});
