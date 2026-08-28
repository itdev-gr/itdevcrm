import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

const mockIsAdmin = vi.fn<() => boolean>(() => false);
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: { isAdmin: boolean }) => unknown) => sel({ isAdmin: mockIsAdmin() }),
}));
vi.mock('./useSendEmail', () => ({
  useSendEmail: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('./useGoogleConnection', () => ({
  useGoogleConnection: () => ({ connected: true, isLoading: false, connect: vi.fn(), disconnect: vi.fn() }),
}));
vi.mock('./SignaturePreview', () => ({ MySignaturePreview: () => null }));

const mockDeptCc = vi.fn<() => string[]>(() => []);
vi.mock('./useDeptCc', () => ({
  useDeptCc: () => ({ data: mockDeptCc() }),
}));

import { SendEmailDialog } from './SendEmailDialog';

const base = { open: true, identity: 'personal' as const, to: 'a@b.gr', subject: 's', body: 'b', onClose: () => {} };

describe('SendEmailDialog cc/bcc fields', () => {
  it('shows Cc but hides Bcc for non-admins', () => {
    mockIsAdmin.mockReturnValue(false);
    render(<SendEmailDialog {...base} />);
    expect(screen.getByLabelText(/^Cc/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Bcc/i)).not.toBeInTheDocument();
  });
  it('shows Bcc for admins', () => {
    mockIsAdmin.mockReturnValue(true);
    render(<SendEmailDialog {...base} />);
    expect(screen.getByLabelText(/^Bcc/i)).toBeInTheDocument();
  });
  it('prefills Cc with the department mailbox so the copy is visible', () => {
    mockIsAdmin.mockReturnValue(false);
    mockDeptCc.mockReturnValue(['sales@itdev.gr']);
    render(<SendEmailDialog {...base} />);
    expect(screen.getByLabelText(/^Cc/i)).toHaveValue('sales@itdev.gr');
  });
  it('does not prefill Cc for non-personal identities', () => {
    mockIsAdmin.mockReturnValue(false);
    mockDeptCc.mockReturnValue(['sales@itdev.gr']);
    render(<SendEmailDialog {...base} identity="accounting" />);
    expect(screen.getByLabelText(/^Cc/i)).toHaveValue('');
  });
});
