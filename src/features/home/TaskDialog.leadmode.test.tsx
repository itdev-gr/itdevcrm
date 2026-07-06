import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect } from 'vitest';
import { i18n } from '@/lib/i18n';

type AuthState = { user: { id: string } | null; isAdmin: boolean; groupCodes: string[] };
const authState: AuthState = { user: { id: 'me' }, isAdmin: false, groupCodes: ['sales'] };
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: AuthState) => unknown) => sel(authState),
}));
vi.mock('@/features/comments/hooks/useMentionableUsers', () => ({
  useMentionableUsers: () => ({
    data: [
      { user_id: 'me', full_name: 'Me Sales', email: 'me@x', is_admin: false, group_codes: ['sales'] },
      { user_id: 'adm', full_name: 'Ada Admin', email: 'a@x', is_admin: true, group_codes: [] },
      { user_id: 'acc', full_name: 'Nia Accounting', email: 'n@x', is_admin: false, group_codes: ['accounting'] },
      { user_id: 'tech', full_name: 'Ted Tech', email: 't@x', is_admin: false, group_codes: ['web_seo'] },
    ],
  }),
}));
vi.mock('./hooks/useUpsertTask', () => ({
  useUpsertTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('./hooks/useDeleteTask', () => ({
  useDeleteTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { TaskDialog } from './TaskDialog';

function wrap(node: React.ReactNode) {
  const qc = new QueryClient();
  return (
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>{node}</I18nextProvider>
    </QueryClientProvider>
  );
}

describe('TaskDialog for sales users', () => {
  it('shows the lead picker instead of the client picker', () => {
    render(wrap(<TaskDialog open onOpenChange={() => {}} />));
    expect(screen.getByPlaceholderText(/search lead/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/search client/i)).not.toBeInTheDocument();
  });

  it('limits Assign-to to sales + admins + accounting', () => {
    render(wrap(<TaskDialog open onOpenChange={() => {}} />));
    const select = screen.getByLabelText(/assign to/i);
    const names = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(names).toContain('Ada Admin');
    expect(names).toContain('Nia Accounting');
    expect(names).not.toContain('Ted Tech');
  });
});
