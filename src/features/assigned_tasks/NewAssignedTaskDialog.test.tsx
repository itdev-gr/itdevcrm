import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { i18n } from '@/lib/i18n';

const mutateAsync = vi.fn().mockResolvedValue('new-id');
vi.mock('./hooks/useCreateAssignedTask', () => ({
  useCreateAssignedTask: () => ({ mutateAsync, isPending: false }),
}));
vi.mock('@/features/leads/hooks/useAssignableOwners', () => ({
  useAssignableOwners: () => ({
    data: [{ user_id: 'u1', full_name: 'Mkifokeris', email: 'mk@itdev.gr' }],
  }),
}));
vi.mock('@/features/groups/hooks/useGroups', () => ({
  useGroups: () => ({
    data: [
      { id: 'g1', code: 'web_dev', display_names: { en: 'Web Dev', el: 'Web Dev' }, position: 50, parent_label: 'Technical' },
      { id: 'g2', code: 'hosting', display_names: { en: 'Hosting', el: 'Hosting' }, position: 80, parent_label: 'Technical' },
    ],
  }),
}));

import { NewAssignedTaskDialog } from './NewAssignedTaskDialog';

function wrap(children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </QueryClientProvider>
  );
}

describe('NewAssignedTaskDialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps submit disabled until title, assignee, and a department are picked', async () => {
    const user = userEvent.setup();
    render(wrap(<NewAssignedTaskDialog open onOpenChange={() => {}} source={{ kind: 'deal', id: 'd1' }} />));

    const submit = screen.getByRole('button', { name: /create task/i });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(/task title/i), 'My task');
    await user.selectOptions(screen.getByLabelText(/assign to/i), 'u1');
    expect(submit).toBeDisabled(); // no department yet

    await user.click(screen.getByRole('radio', { name: 'Web Dev' }));
    expect(submit).toBeEnabled();
  });

  it('clicking a second chip replaces the first (single-select)', async () => {
    const user = userEvent.setup();
    render(wrap(<NewAssignedTaskDialog open onOpenChange={() => {}} source={{ kind: 'deal', id: 'd1' }} />));

    await user.type(screen.getByLabelText(/task title/i), 'My task');
    await user.selectOptions(screen.getByLabelText(/assign to/i), 'u1');
    await user.click(screen.getByRole('radio', { name: 'Web Dev' }));
    await user.click(screen.getByRole('radio', { name: 'Hosting' }));
    await user.click(screen.getByRole('button', { name: /create task/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(mutateAsync).toHaveBeenCalledWith({
      source: { kind: 'deal', id: 'd1' },
      title: 'My task',
      description: null,
      assigneeUserId: 'u1',
      departmentId: 'g2', // hosting replaced web_dev
    });
  });
});
