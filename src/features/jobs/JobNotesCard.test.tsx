import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { i18n } from '@/lib/i18n';

const mutateAsync = vi.fn().mockResolvedValue('j1');
vi.mock('@/features/deals/hooks/useCustomJobMutations', () => ({
  useUpdateJobBilling: () => ({ mutateAsync, isPending: false }),
}));

const parentJobMap: Record<string, { description: string | null } | null> = {};
vi.mock('./hooks/useJob', () => ({
  useJob: (id: string) => ({ data: parentJobMap[id] ?? null }),
}));

import { JobNotesCard } from './JobNotesCard';

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </QueryClientProvider>
  );
}

describe('JobNotesCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(parentJobMap)) delete parentJobMap[k];
  });

  it('renders the description with newlines preserved', () => {
    render(
      wrap(
        <JobNotesCard
          jobId="j1"
          dealId="d1"
          description={'Line 1\nLine 2'}
          parentJobId={null}
        />,
      ),
    );
    const para = screen.getByTestId('job-notes-body');
    expect(para.textContent).toBe('Line 1\nLine 2');
    expect(para.className).toMatch(/whitespace-pre-wrap/);
  });

  it('renders empty state with an Add note button when description is null', () => {
    render(
      wrap(
        <JobNotesCard
          jobId="j1"
          dealId="d1"
          description={null}
          parentJobId={null}
        />,
      ),
    );
    expect(screen.getByText(/no notes yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add note/i })).toBeInTheDocument();
  });

  it('saves edits via useUpdateJobBilling and exits edit mode', async () => {
    const user = userEvent.setup();
    render(
      wrap(
        <JobNotesCard
          jobId="j1"
          dealId="d1"
          description={'Old note'}
          parentJobId={null}
        />,
      ),
    );

    await user.click(screen.getByTestId('job-notes-body'));
    const ta = await screen.findByRole('textbox');
    await user.clear(ta);
    await user.type(ta, 'New note');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync.mock.calls[0]![0]).toEqual({
      jobId: 'j1',
      description: 'New note',
    });
  });

  it('normalises an empty edit to null on save', async () => {
    const user = userEvent.setup();
    render(
      wrap(
        <JobNotesCard
          jobId="j1"
          dealId="d1"
          description={'Old'}
          parentJobId={null}
        />,
      ),
    );

    await user.click(screen.getByTestId('job-notes-body'));
    const ta = await screen.findByRole('textbox');
    await user.clear(ta);
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync.mock.calls[0]![0]).toEqual({
      jobId: 'j1',
      description: null,
    });
  });

  it('renders the AI SEO parent note when the parent job has a description', () => {
    parentJobMap['parent-1'] = { description: 'Parent says: rush job' };
    render(
      wrap(
        <JobNotesCard
          jobId="child-1"
          dealId="d1"
          description={'Child note'}
          parentJobId={'parent-1'}
        />,
      ),
    );

    expect(screen.getByText(/notes from ai seo parent/i)).toBeInTheDocument();
    expect(screen.getByText(/parent says: rush job/i)).toBeInTheDocument();
    expect(screen.getByTestId('job-notes-body').textContent).toBe('Child note');
  });

  it('hides the parent subsection when the parent has no note or no access', () => {
    // parentJobMap is empty → useJob returns { data: null }
    render(
      wrap(
        <JobNotesCard
          jobId="child-1"
          dealId="d1"
          description={'Child note'}
          parentJobId={'parent-1'}
        />,
      ),
    );

    expect(screen.queryByText(/notes from ai seo parent/i)).not.toBeInTheDocument();
  });
});
