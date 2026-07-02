import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { EmailHealthBanner } from './EmailHealthBanner';

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: { isAdmin: boolean }) => unknown) => sel({ isAdmin: true }),
}));
vi.mock('./useEmailHealth', () => ({
  useEmailHealth: () => ({ data: { status: 'down', reason: 'drain last ran 7200s ago' } }),
}));

describe('EmailHealthBanner', () => {
  it('shows a red alert for an admin when the pipeline is down', () => {
    render(
      <MemoryRouter>
        <EmailHealthBanner />
      </MemoryRouter>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Email: drain last ran 7200s ago');
  });
});
