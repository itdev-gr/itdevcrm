import type { ReactNode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const release = vi.fn();
const discard = vi.fn();
const { useLeadIntake } = vi.hoisted(() => ({ useLeadIntake: vi.fn() }));

vi.mock('./hooks/useLeadIntake', () => ({ useLeadIntake }));
vi.mock('./hooks/useReleaseLeadIntake', () => ({
  useReleaseLeadIntake: () => ({ mutate: release, isPending: false }),
}));
vi.mock('./hooks/useDiscardLeadIntake', () => ({
  useDiscardLeadIntake: () => ({ mutate: discard, isPending: false }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('react-router-dom', () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));

import { LeadIntakePage } from './LeadIntakePage';

describe('LeadIntakePage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a held lead with its match and fires release', () => {
    useLeadIntake.mockReturnValue({
      data: [
        {
          id: 'i1',
          title: 'AI SEO form',
          contact_first_name: 'Xenia',
          contact_last_name: 'Kara',
          email: 'x@kara.gr',
          phone: '+306900000001',
          created_at: '2026-06-19T10:00:00Z',
          matched_on: ['email'],
          matches: [
            {
              match_type: 'lead',
              record_id: 'L1',
              display_name: 'Old Lead',
              context: 'Won',
              matched_field: 'email',
            },
          ],
        },
      ],
      isLoading: false,
    });
    render(<LeadIntakePage />);
    expect(screen.getByText('x@kara.gr')).toBeInTheDocument();
    expect(screen.getByText('Old Lead')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'leads:intake.release' }));
    expect(release).toHaveBeenCalledWith('i1');
  });

  it('shows a clean (no-duplicate) lead with the clean indicator', () => {
    useLeadIntake.mockReturnValue({
      data: [
        {
          id: 'i2',
          title: 'Contact form',
          contact_first_name: 'New',
          contact_last_name: 'Person',
          email: 'new@person.gr',
          phone: '+306900000002',
          created_at: '2026-06-19T11:00:00Z',
          matched_on: [],
          matches: [],
        },
      ],
      isLoading: false,
    });
    render(<LeadIntakePage />);
    expect(screen.getByText('new@person.gr')).toBeInTheDocument();
    expect(screen.getByText(/leads:intake.clean/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'leads:intake.release' }));
    expect(release).toHaveBeenCalledWith('i2');
  });

  it('shows the empty state', () => {
    useLeadIntake.mockReturnValue({ data: [], isLoading: false });
    render(<LeadIntakePage />);
    expect(screen.getByText('leads:intake.empty')).toBeInTheDocument();
  });
});
