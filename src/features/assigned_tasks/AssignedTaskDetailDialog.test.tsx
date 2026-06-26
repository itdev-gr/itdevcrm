import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { i18n } from '@/lib/i18n';

const resolveMutate = vi.fn().mockResolvedValue(undefined);
vi.mock('./hooks/useResolveAssignedTask', () => ({
  useResolveAssignedTask: () => ({ mutateAsync: resolveMutate, isPending: false }),
}));

// Admin viewer → can open the deal, so a deal-scoped task keeps the "Open deal" link.
// (The technical-user → "Open job" branch is covered by taskOpenLink.test.ts.)
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: { user: { id: string } | null; isAdmin: boolean; groupCodes: string[] }) => unknown) =>
    sel({ user: { id: 'u-me' }, isAdmin: true, groupCodes: [] }),
}));

const detail = {
  id: 't1', title: 'TEST — smoke', description: 'desc',
  deal_id: 'd1', job_id: null, client_id: 'c1', source_code: '000017',
  assignee_user_id: 'u-me', created_by_user_id: 'u-other',
  status: 'open' as const, resolved_at: null, resolved_by_user_id: null,
  created_at: new Date().toISOString(),
  department_group_id: 'g1',
  client: {
    id: 'c1', name: 'Pindos Outdoor Gear', industry: 'fitness_sports',
    contact_first_name: 'Christos', contact_last_name: 'Tsilis',
    email: 'ct@p.gr', phone: '+30 1',
  },
  creator: { user_id: 'u-other', full_name: 'Smoke Test', email: 's@t.gr' },
  department: { id: 'g1', code: 'web_dev', display_names: { en: 'Web Dev', el: 'Web Dev' }, position: 50 },
};
vi.mock('./hooks/useAssignedTaskDetail', () => ({
  useAssignedTaskDetail: (id: string | null) => ({
    data: id ? detail : undefined,
    isLoading: false,
    error: null,
  }),
}));

import { AssignedTaskDetailDialog } from './AssignedTaskDetailDialog';

function wrap(children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe('AssignedTaskDetailDialog', () => {
  beforeEach(() => vi.clearAllMocks());

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
