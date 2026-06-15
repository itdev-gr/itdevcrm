import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n';
import { AppShell } from './AppShell';

describe('AppShell', () => {
  it('renders children with topbar and sidebar', () => {
    const qc = new QueryClient();
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
