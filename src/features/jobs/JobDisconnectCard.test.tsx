import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { i18n } from '@/lib/i18n';
import { useAuthStore } from '@/lib/stores/authStore';

const mutateAsync = vi.fn().mockResolvedValue(undefined);
vi.mock('./hooks/useJobDisconnect', () => ({
  useSetJobDisconnected: () => ({ mutateAsync, isPending: false }),
}));

vi.mock('@/features/comments/hooks/useMentionableUsers', () => ({
  useMentionableUsers: () => ({
    data: [{ user_id: 'u-1', full_name: 'Dimitris Tzouvaras', email: 'd@example.com' }],
  }),
}));

import { JobDisconnectCard } from './JobDisconnectCard';
import type { JobRow } from './hooks/useJobs';

const closedJob = {
  id: 'j1',
  service_type: 'local_seo',
  stage: { id: 's-closed', code: 'closed', board: 'local_seo', display_names: {} },
  disconnected_at: null,
  disconnected_by: null,
} as unknown as JobRow;

const disconnectedJob = {
  ...closedJob,
  disconnected_at: '2026-08-28T10:00:00Z',
  disconnected_by: 'u-1',
} as unknown as JobRow;

function wrap(node: React.ReactNode) {
  return <I18nextProvider i18n={i18n}>{node}</I18nextProvider>;
}

describe('JobDisconnectCard', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18n.changeLanguage('en');
    useAuthStore.setState({ isAdmin: false, groupCodes: ['local_seo'] });
  });

  it('renders nothing for a local_seo job that is not closed', () => {
    const { container } = render(
      wrap(
        <JobDisconnectCard
          job={{ ...closedJob, stage: { ...closedJob.stage!, code: 'optimize' } } as JobRow}
        />,
      ),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('red state: alert with the reminder and a Disconnect button for local_seo members', () => {
    render(wrap(<JobDisconnectCard job={closedJob} />));
    expect(screen.getByRole('alert')).toHaveTextContent(
      /client closed — disconnect from the google business profile/i,
    );
    expect(screen.getByRole('button', { name: /^disconnect$/i })).toBeInTheDocument();
  });

  it('Disconnect → confirm dialog → mutate({ disconnected: true })', async () => {
    const user = userEvent.setup();
    render(wrap(<JobDisconnectCard job={closedJob} />));
    await user.click(screen.getByRole('button', { name: /^disconnect$/i }));
    expect(await screen.findByText(/mark as disconnected\?/i)).toBeInTheDocument();
    // The trigger and the dialog's confirm button share the label; the dialog's is last in DOM order.
    await user.click(screen.getAllByRole('button', { name: /^disconnect$/i }).at(-1)!);
    expect(mutateAsync).toHaveBeenCalledWith({ disconnected: true });
  });

  it('green state: shows the date, who did it, and an Undo that clears the flag', async () => {
    const user = userEvent.setup();
    render(wrap(<JobDisconnectCard job={disconnectedJob} />));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(/disconnected on/i)).toBeInTheDocument();
    expect(screen.getByText(/by dimitris tzouvaras/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /undo/i }));
    expect(mutateAsync).toHaveBeenCalledWith({ disconnected: false });
  });

  it('hides the buttons for users outside local_seo (accounting), but still shows the state', () => {
    useAuthStore.setState({ isAdmin: false, groupCodes: ['accounting'] });
    render(wrap(<JobDisconnectCard job={closedJob} />));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^disconnect$/i })).not.toBeInTheDocument();
  });

  it('admins may toggle', () => {
    useAuthStore.setState({ isAdmin: true, groupCodes: [] });
    render(wrap(<JobDisconnectCard job={closedJob} />));
    expect(screen.getByRole('button', { name: /^disconnect$/i })).toBeInTheDocument();
  });

  it('Greek copy', async () => {
    await i18n.changeLanguage('el');
    render(wrap(<JobDisconnectCard job={closedJob} />));
    expect(screen.getByRole('alert')).toHaveTextContent(/ο πελάτης έκλεισε/i);
    expect(screen.getByRole('button', { name: /^αποσύνδεση$/i })).toBeInTheDocument();
  });
});
