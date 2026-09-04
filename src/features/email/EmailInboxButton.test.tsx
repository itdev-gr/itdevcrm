import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('./hooks/useEmailInbox', () => ({
  // The badge deliberately uses its own light query, not the page's.
  useEmailInboxBadge: () => ({ unreadCount: 3 }),
  useEmailInboxRealtime: () => {},
}));

import { EmailInboxButton } from './EmailInboxButton';

describe('EmailInboxButton', () => {
  it('shows unread badge and links to /inbox', () => {
    render(
      <MemoryRouter>
        <EmailInboxButton />
      </MemoryRouter>,
    );
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /inbox/i })).toHaveAttribute('href', '/inbox');
  });
});
