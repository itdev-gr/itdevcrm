import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@/lib/i18n';
import { AppShell } from './AppShell';

describe('AppShell', () => {
  it('renders children with topbar and sidebar', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <AppShell>
            <p>child</p>
          </AppShell>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText('child')).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument(); // <header>
  });
});
