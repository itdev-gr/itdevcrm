import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import { describe, it, expect, beforeAll } from 'vitest';
import { i18n } from '@/lib/i18n';
import { useAuthStore } from '@/lib/stores/authStore';

// The badge components each pull their own query hook — stub every one so
// this test needs no QueryClientProvider / network, same pattern as
// src/features/jobs/JobsListPage.test.tsx.
vi.mock('@/features/leads/hooks/useLeadIntake', () => ({
  useLeadIntakeCount: () => ({ data: 0 }),
}));
vi.mock('@/features/under_development/hooks/useSalesTasksBadge', () => ({
  useSalesTasksBadge: () => 0,
}));
vi.mock('@/features/accounting/alerts/hooks/useAlertsCount', () => ({
  useAlertsCount: () => ({ data: 0 }),
}));
vi.mock('@/features/tasks/hooks/useTaskBadgeCounts', () => ({
  useTaskBadgeCounts: () => ({ total: 0, newCount: 0 }),
}));

import { SidebarNav } from './Sidebar';

function wrap(node: React.ReactNode) {
  return (
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>{node}</I18nextProvider>
    </MemoryRouter>
  );
}

describe('SidebarNav — Company section (admin-only)', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('el');
  });

  it('is absent for a non-admin', () => {
    useAuthStore.setState({ isAdmin: false, groupCodes: [] });
    render(wrap(<SidebarNav />));
    expect(screen.queryByText('Εταιρεία')).not.toBeInTheDocument();
    expect(screen.queryByText('Email marketing')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /email marketing/i })).not.toBeInTheDocument();
  });

  it('shows the Company section and Email marketing link for an admin', () => {
    useAuthStore.setState({ isAdmin: true, groupCodes: [] });
    render(wrap(<SidebarNav />));
    expect(screen.getByText('Εταιρεία')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /email marketing/i });
    expect(link).toHaveAttribute('href', '/company/email-marketing');
  });
});
