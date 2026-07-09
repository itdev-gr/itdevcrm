import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const ref: { jobs: Array<{ id: string; service_type: string }> } = { jobs: [] };
vi.mock('@/features/jobs/hooks/useJobsForDeal', () => ({
  useJobsForDeal: () => ({ data: ref.jobs }),
}));
vi.mock('./CommentsPanel', () => ({
  CommentsPanel: ({ parentType, parentId }: { parentType: string; parentId: string }) => (
    <div>panel:{parentType}:{parentId}</div>
  ),
}));

import { DealCommentsTabs } from './DealCommentsTabs';

describe('DealCommentsTabs', () => {
  beforeEach(() => { ref.jobs = []; });

  it('renders the plain General thread (no tab strip) when the deal has no dev/seo jobs', () => {
    ref.jobs = [{ id: 'j1', service_type: 'hosting' }];
    render(<DealCommentsTabs dealId="D1" />);
    expect(screen.getByText('panel:deal:D1')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('shows a Dev tab for a web_dev job and opens the deal_dev thread', async () => {
    ref.jobs = [{ id: 'j1', service_type: 'web_dev' }];
    render(<DealCommentsTabs dealId="D1" />);
    expect(screen.getByRole('tab', { name: 'General' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Dev' }));
    expect(screen.getByText('panel:deal_dev:D1')).toBeInTheDocument();
  });

  it('shows a SEO tab for any seo job and opens the deal_seo thread', async () => {
    ref.jobs = [{ id: 'j1', service_type: 'local_seo' }];
    render(<DealCommentsTabs dealId="D1" />);
    await userEvent.click(screen.getByRole('tab', { name: 'SEO' }));
    expect(screen.getByText('panel:deal_seo:D1')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Dev' })).not.toBeInTheDocument();
  });

  it('shows all three tabs when both dev and seo jobs exist, General first', () => {
    ref.jobs = [{ id: 'j1', service_type: 'web_dev' }, { id: 'j2', service_type: 'web_seo' }];
    render(<DealCommentsTabs dealId="D1" />);
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['General', 'Dev', 'SEO']);
    expect(screen.getByText('panel:deal:D1')).toBeInTheDocument();
  });
});
