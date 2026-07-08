import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/lib/i18n';

const mutateAsync = vi.fn(() => Promise.resolve(undefined));
vi.mock('./hooks/useCreateComment', () => ({
  useCreateComment: () => ({ mutateAsync, isPending: false }),
}));
vi.mock('./hooks/useMentionableUsers', () => ({
  useMentionableUsers: () => ({ data: [] }),
}));
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) =>
    sel({ user: { email: 'me@itdev.gr', user_metadata: {} } }),
}));

import { CommentForm } from './CommentForm';
import { useCommentDraftStore } from './commentDraftStore';

beforeEach(() => {
  mutateAsync.mockClear();
  useCommentDraftStore.setState({ drafts: {} });
  window.localStorage.clear();
});

describe('CommentForm Enter-to-post', () => {
  it('posts the comment when Enter is pressed (no Shift)', async () => {
    render(<CommentForm parentType="deal" parentId="d1" />);
    const ta = screen.getByRole('textbox');
    fireEvent.change(ta, { target: { value: 'ship it' } });
    fireEvent.keyDown(ta, { key: 'Enter' });
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ parent_type: 'deal', parent_id: 'd1', body: 'ship it' }),
    );
  });

  it('does not post on Shift+Enter (newline)', () => {
    render(<CommentForm parentType="deal" parentId="d1" />);
    const ta = screen.getByRole('textbox');
    fireEvent.change(ta, { target: { value: 'line one' } });
    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true });
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('does not post on Enter when the box is empty', () => {
    render(<CommentForm parentType="deal" parentId="d1" />);
    const ta = screen.getByRole('textbox');
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
