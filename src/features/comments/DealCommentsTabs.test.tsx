import { render, screen, within } from '@testing-library/react';
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
const unreadRef: { map: Record<string, boolean> } = { map: {} };
vi.mock('./hooks/useDealCommentUnread', () => ({
  useDealCommentUnread: () => ({ data: unreadRef.map }),
}));

import { DealCommentsTabs } from './DealCommentsTabs';

describe('DealCommentsTabs', () => {
  beforeEach(() => {
    ref.jobs = [];
    unreadRef.map = {};
  });

  it('renders the plain General thread (no tab strip) when the deal has no channel jobs', () => {
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

  it('shows an Ads tab for an ads job and opens the deal_ads thread', async () => {
    ref.jobs = [{ id: 'j1', service_type: 'ads' }];
    render(<DealCommentsTabs dealId="D1" />);
    await userEvent.click(screen.getByRole('tab', { name: 'Ads' }));
    expect(screen.getByText('panel:deal_ads:D1')).toBeInTheDocument();
  });

  it('shows a Social tab for a social_media job and opens the deal_social thread', async () => {
    ref.jobs = [{ id: 'j1', service_type: 'social_media' }];
    render(<DealCommentsTabs dealId="D1" />);
    await userEvent.click(screen.getByRole('tab', { name: 'Social' }));
    expect(screen.getByText('panel:deal_social:D1')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Dev' })).not.toBeInTheDocument();
  });

  it('shows all five tabs in stable order when every service exists', () => {
    ref.jobs = [
      { id: 'j1', service_type: 'web_dev' },
      { id: 'j2', service_type: 'web_seo' },
      { id: 'j3', service_type: 'ads' },
      { id: 'j4', service_type: 'social_media' },
    ];
    render(<DealCommentsTabs dealId="D1" />);
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['General', 'Dev', 'SEO', 'Ads', 'Social']);
    expect(screen.getByText('panel:deal:D1')).toBeInTheDocument();
  });

  it('shows an unread dot on inactive tabs that have new comments', () => {
    ref.jobs = [{ id: 'j1', service_type: 'ads' }];
    unreadRef.map = { ads: true, general: false };
    render(<DealCommentsTabs dealId="D1" />);
    const adsTab = screen.getByRole('tab', { name: /Ads/ });
    expect(within(adsTab).getByLabelText('new comments')).toBeInTheDocument();
    const generalTab = screen.getByRole('tab', { name: /General/ });
    expect(within(generalTab).queryByLabelText('new comments')).not.toBeInTheDocument();
  });

  it('never shows a dot on the tab the user is currently viewing', () => {
    ref.jobs = [{ id: 'j1', service_type: 'ads' }];
    unreadRef.map = { general: true, ads: true };
    render(<DealCommentsTabs dealId="D1" />);
    // General is the active default tab -> its dot is suppressed.
    const generalTab = screen.getByRole('tab', { name: /General/ });
    expect(within(generalTab).queryByLabelText('new comments')).not.toBeInTheDocument();
    const adsTab = screen.getByRole('tab', { name: /Ads/ });
    expect(within(adsTab).getByLabelText('new comments')).toBeInTheDocument();
  });
});
