import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/lib/i18n';
import { AppShell } from './AppShell';

describe('AppShell', () => {
  it('renders children with topbar and sidebar', () => {
    render(
      <MemoryRouter>
        <AppShell>
          <p>child</p>
        </AppShell>
      </MemoryRouter>,
    );
    expect(screen.getByText('child')).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument(); // <header>
  });
});
