import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import '@/lib/i18n';
import { i18n } from '@/lib/i18n';

const { suppressMutateAsync, isAdminRef } = vi.hoisted(() => ({
  suppressMutateAsync: vi.fn(),
  isAdminRef: { value: true },
}));

vi.mock('@/features/email_marketing/hooks/useSuppressions', () => ({
  useAdminSuppressEmail: () => ({ mutateAsync: suppressMutateAsync, isPending: false }),
}));
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (selector: (s: { isAdmin: boolean }) => unknown) =>
    selector({ isAdmin: isAdminRef.value }),
}));

import { EmailOptoutAction } from './EmailOptoutAction';

describe('EmailOptoutAction', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('el');
  });
  beforeEach(() => {
    vi.clearAllMocks();
    isAdminRef.value = true;
  });

  it('is invisible to non-admins — only admins may change the list', () => {
    isAdminRef.value = false;
    const { container } = render(<EmailOptoutAction email="a@b.gr" state={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is invisible when the person already refused — the badge says it instead', () => {
    const { container } = render(<EmailOptoutAction email="a@b.gr" state="refused" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('still offers to block an address that merely bounces', () => {
    render(<EmailOptoutAction email="a@b.gr" state="undeliverable" />);
    expect(screen.getByRole('button', { name: /Να μη λαμβάνει email/ })).toBeInTheDocument();
  });

  it('is invisible when there is no address to block', () => {
    const { container } = render(<EmailOptoutAction email="  " state={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('requires a written reason before it will block anyone', async () => {
    const onDone = vi.fn();
    suppressMutateAsync.mockResolvedValueOnce(undefined);
    render(<EmailOptoutAction email="Stop@Example.gr" state={null} onDone={onDone} />);

    fireEvent.click(screen.getByRole('button', { name: /Να μη λαμβάνει email/ }));
    const confirm = screen.getByRole('button', { name: 'Αποκλεισμός' });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Γιατί (υποχρεωτικό)'), {
      target: { value: 'απάντησε ότι δεν θέλει' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Αποκλεισμός' }));

    await waitFor(() =>
      expect(suppressMutateAsync).toHaveBeenCalledWith({
        email: 'Stop@Example.gr',
        note: 'απάντησε ότι δεν θέλει',
        reason: 'unsubscribed',
      }),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});
