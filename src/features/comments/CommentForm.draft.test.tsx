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
import { useCommentDraftStore, commentThreadKey } from './commentDraftStore';

beforeEach(() => {
  mutateAsync.mockClear();
  useCommentDraftStore.setState({ drafts: {} });
  window.localStorage.clear();
});

describe('CommentForm draft persistence', () => {
  it('restores a saved draft for this thread into the textarea', () => {
    useCommentDraftStore.getState().setDraft(commentThreadKey('deal', 'd1'), 'unsent text');
    render(<CommentForm parentType="deal" parentId="d1" />);
    expect(screen.getByRole('textbox')).toHaveValue('unsent text');
  });

  it('persists typed text to the store under the thread key', () => {
    render(<CommentForm parentType="deal" parentId="d1" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hi there' } });
    expect(useCommentDraftStore.getState().getDraft(commentThreadKey('deal', 'd1'))).toBe('hi there');
  });

  it('clears the stored draft after a successful post', async () => {
    render(<CommentForm parentType="deal" parentId="d1" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'send me' } });
    fireEvent.submit(screen.getByRole('textbox').closest('form')!);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    await waitFor(() =>
      expect(useCommentDraftStore.getState().getDraft(commentThreadKey('deal', 'd1'))).toBe(''),
    );
  });

  it('keys reply drafts separately from the top-level draft', () => {
    useCommentDraftStore.getState().setDraft(commentThreadKey('deal', 'd1', 'c9'), 'reply draft');
    render(<CommentForm parentType="deal" parentId="d1" replyToId="c9" onCancelReply={() => {}} />);
    expect(screen.getByRole('textbox')).toHaveValue('reply draft');
  });
});
