import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const authRef = { isAdmin: true };
const healthRef: { data: unknown } = { data: null };
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: { isAdmin: boolean }) => unknown) => sel({ isAdmin: authRef.isAdmin }),
}));
vi.mock('./useGmailSyncHealth', () => ({ useGmailSyncHealth: () => healthRef }));
import { GmailSyncBanner } from './GmailSyncBanner';

function renderBanner() {
  return render(
    <MemoryRouter>
      <GmailSyncBanner />
    </MemoryRouter>,
  );
}

describe('GmailSyncBanner', () => {
  beforeEach(() => {
    authRef.isAdmin = true;
    healthRef.data = null;
  });

  it('renders nothing for a non-admin', () => {
    authRef.isAdmin = false;
    healthRef.data = { accounts: 3, stale_accounts: 3 };
    const { container } = renderBanner();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when sweeps are healthy', () => {
    healthRef.data = { accounts: 3, stale_accounts: 0 };
    const { container } = renderBanner();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the RPC errored (null data)', () => {
    healthRef.data = null;
    const { container } = renderBanner();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a red alert for an admin when all sweeps are stale', () => {
    healthRef.data = { accounts: 3, stale_accounts: 3 };
    renderBanner();
    expect(screen.getByRole('alert')).toHaveTextContent('Gmail sync: 3 of 3 mailbox(es) stale');
  });
});
