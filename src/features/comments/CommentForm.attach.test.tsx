import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/lib/i18n';

const createMutate = vi.fn(() => Promise.resolve({ id: 'c1' }));
const uploadMutate = vi.fn(() => Promise.resolve());
vi.mock('./hooks/useCreateComment', () => ({
  useCreateComment: () => ({ mutateAsync: createMutate, isPending: false }),
}));
vi.mock('./hooks/useUploadCommentAttachment', () => ({
  useUploadCommentAttachment: () => ({ mutateAsync: uploadMutate, isPending: false }),
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
  createMutate.mockClear();
  uploadMutate.mockClear();
  useCommentDraftStore.setState({ drafts: {} });
  window.localStorage.clear();
});

function pickFile(container: HTMLElement, file: File) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

describe('CommentForm attachments', () => {
  it('enables submit with a pending file even when the body is empty', () => {
    const { container } = render(<CommentForm parentType="deal" parentId="d1" />);
    const submit = screen.getByRole('button', { name: /post|submit|σχόλιο|αποστολή/i });
    expect(submit).toBeDisabled();
    pickFile(container, new File([new Uint8Array(8)], 'shot.png', { type: 'image/png' }));
    expect(submit).toBeEnabled();
  });

  it('uploads each pending file with the new comment id after the comment is posted', async () => {
    const { container } = render(<CommentForm parentType="deal" parentId="d1" />);
    const file = new File([new Uint8Array(8)], 'shot.png', { type: 'image/png' });
    pickFile(container, file);
    fireEvent.submit(screen.getByRole('textbox').closest('form')!);

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(uploadMutate).toHaveBeenCalledTimes(1));
    expect(uploadMutate).toHaveBeenCalledWith({ parent: { comment_id: 'c1' }, file });
  });
});
