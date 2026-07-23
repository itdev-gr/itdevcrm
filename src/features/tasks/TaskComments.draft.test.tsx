import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/lib/i18n';

const mutateAsync = vi.fn(async () => ({ id: 'c1' }));
const uploadAsync = vi.fn(async () => {});
vi.mock('./hooks/usePostTaskComment', () => ({
  usePostTaskComment: () => ({ mutateAsync, isPending: false }),
}));
vi.mock('@/features/comments/hooks/useUploadCommentAttachment', () => ({
  useUploadCommentAttachment: () => ({ mutateAsync: uploadAsync }),
}));
vi.mock('./hooks/useTaskComments', () => ({
  useTaskComments: () => ({ data: [] }),
}));
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'me' } }),
}));
// useProfileDirectory became a react-query hook (098826e); stub it so this
// test needs no QueryClientProvider.
vi.mock('@/features/comments/hooks/useProfileDirectory', () => ({
  useProfileDirectory: () => ({ data: [] }),
}));

import { TaskComments } from './TaskComments';
import { useCommentDraftStore, taskThreadKey } from '@/features/comments/commentDraftStore';

beforeEach(() => {
  mutateAsync.mockClear();
  uploadAsync.mockClear();
  useCommentDraftStore.setState({ drafts: {} });
  window.localStorage.clear();
});

describe('TaskComments draft persistence', () => {
  it('restores a saved draft into the textarea', () => {
    useCommentDraftStore.getState().setDraft(taskThreadKey('assigned', 't1'), 'wip note');
    render(<TaskComments kind="assigned" taskId="t1" locale="en-GB" />);
    expect(screen.getByRole('textbox')).toHaveValue('wip note');
  });

  it('persists typed text under the task thread key', () => {
    render(<TaskComments kind="assigned" taskId="t1" locale="en-GB" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'typing' } });
    expect(useCommentDraftStore.getState().getDraft(taskThreadKey('assigned', 't1'))).toBe('typing');
  });

  it('clears the draft after a successful post', async () => {
    render(<TaskComments kind="assigned" taskId="t1" locale="en-GB" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'done' } });
    fireEvent.submit(screen.getByRole('textbox').closest('form')!);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    await waitFor(() =>
      expect(useCommentDraftStore.getState().getDraft(taskThreadKey('assigned', 't1'))).toBe(''),
    );
  });

  it('enables the send button with a pending file and empty body', () => {
    const { container } = render(<TaskComments kind="assigned" taskId="t1" locale="en-GB" />);
    const send = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(send).toBeDisabled();
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'shot.png', { type: 'image/png' });
    fireEvent.change(fileInput, { target: { files: [file] } });
    expect(send).not.toBeDisabled();
  });
});
