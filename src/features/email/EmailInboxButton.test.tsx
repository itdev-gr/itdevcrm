import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('./hooks/useEmailInbox', () => ({
  useEmailInbox: () => ({ unreadCount: 3, items: [] }),
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
