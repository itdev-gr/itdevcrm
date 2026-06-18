import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import '@/lib/i18n';

// Mix of one unread + one already-read notification.
vi.mock('./hooks/useNotifications', () => ({
  useNotifications: () => ({
    data: [
      {
        id: 'unread-1',
        user_id: 'u',
        type: 'payment_overdue',
        payload: { parent_label: 'UnreadCo' },
        read_at: null,
        created_at: '2026-06-18T10:00:00.000Z',
      },
      {
        id: 'read-1',
        user_id: 'u',
        type: 'payment_overdue',
        payload: { parent_label: 'ReadCo' },
        read_at: '2026-06-18T09:00:00.000Z',
        created_at: '2026-06-18T08:00:00.000Z',
      },
    ],
  }),
}));
vi.mock('./hooks/useMarkNotificationRead', () => ({
  useMarkNotificationRead: () => ({ mutate: () => {}, isPending: false }),
}));
vi.mock('./hooks/useMarkAllNotificationsRead', () => ({
  useMarkAllNotificationsRead: () => ({ mutate: () => {}, isPending: false }),
}));
vi.mock('./hooks/useNotificationsRealtime', () => ({
  useNotificationsRealtime: () => undefined,
}));

import { NotificationsColumn } from './NotificationsColumn';

describe('NotificationsColumn', () => {
  it('shows unread notifications but hides ones that are already read', () => {
    render(
      <MemoryRouter>
        <NotificationsColumn />
      </MemoryRouter>,
    );
    expect(screen.getByText('UnreadCo')).toBeInTheDocument();
    expect(screen.queryByText('ReadCo')).not.toBeInTheDocument();
  });
});
