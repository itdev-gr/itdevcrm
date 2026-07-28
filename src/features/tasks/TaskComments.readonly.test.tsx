import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import '@/lib/i18n';

vi.mock('./hooks/usePostTaskComment', () => ({
  usePostTaskComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/features/comments/hooks/useUploadCommentAttachment', () => ({
  useUploadCommentAttachment: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('./hooks/useTaskComments', () => ({
  useTaskComments: () => ({ data: [] }),
}));
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'me' }, isAdmin: false }),
}));
vi.mock('@/features/comments/hooks/useProfileDirectory', () => ({
  useProfileDirectory: () => ({ data: [] }),
}));

import { TaskComments } from './TaskComments';

describe('TaskComments readOnly', () => {
  it('hides the composer when readOnly', () => {
    const { container } = render(
      <TaskComments kind="user" taskId="t1" locale="en-GB" readOnly />,
    );
    expect(container.querySelector('form')).toBe(null);
    expect(container.querySelector('textarea')).toBe(null);
  });

  it('shows the composer by default', () => {
    const { container } = render(<TaskComments kind="user" taskId="t1" locale="en-GB" />);
    expect(container.querySelector('form')).not.toBe(null);
  });
});
