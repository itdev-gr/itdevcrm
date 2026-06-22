import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const upsert = vi.fn().mockResolvedValue('id1');
vi.mock('./hooks/useUpsertTask', () => ({ useUpsertTask: () => ({ mutateAsync: upsert, isPending: false }) }));
vi.mock('./hooks/useDeleteTask', () => ({ useDeleteTask: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock('@/features/leads/hooks/useAssignableOwners', () => ({
  useAssignableOwners: () => ({ data: [{ user_id: 'me', full_name: 'Me', email: 'me@x.gr' }] }),
}));
vi.mock('@/lib/stores/authStore', () => ({ useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'me' } }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k }) }));

import { TaskDialog } from './TaskDialog';

describe('TaskDialog importance', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires importance before Save is enabled, then includes it in the payload', async () => {
    render(<TaskDialog open onOpenChange={() => {}} />);
    // Title + due are prefilled (due defaults to now); importance starts empty → Save disabled.
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'My task' } });
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Importance'), { target: { value: 'high' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ importance: 'high', title: 'My task' }));
  });
});
