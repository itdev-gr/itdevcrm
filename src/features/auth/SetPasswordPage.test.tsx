import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n';
import { SetPasswordPage } from './SetPasswordPage';

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('SetPasswordPage', () => {
  it('renders new + confirm password fields and submit', () => {
    render(wrap(<SetPasswordPage />));
    expect(screen.getByLabelText(/new password|νέος κωδικός/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password|επιβεβαίωση/i)).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});
