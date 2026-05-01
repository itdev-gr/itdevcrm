import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect } from 'vitest';
import '@/lib/i18n';

vi.mock('@/features/groups/hooks/useGroups', () => ({
  useGroups: () => ({
    data: [
      {
        id: 'g1',
        code: 'sales',
        display_names: { en: 'Sales', el: 'Π' },
        parent_label: 'Sales',
        position: 10,
      },
    ],
  }),
}));
vi.mock('./hooks/useCreateUser', () => ({
  useCreateUser: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
}));

import { CreateUserDialog } from './CreateUserDialog';

function wrap(ui: ReactNode) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe('CreateUserDialog', () => {
  it('renders form fields when open', () => {
    render(wrap(<CreateUserDialog open onOpenChange={() => {}} />));
    expect(screen.getByLabelText(/full name|πλήρες όνομα/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/temp|προσωρινός/i)).toBeInTheDocument();
  });
});
