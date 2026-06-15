import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DealServiceInfo } from './DealServiceInfo';

vi.mock('./hooks/useDealJobs', () => ({
  useDealJobs: () => ({
    data: [
      {
        id: 'j1', service_type: 'web_seo',
        details: { website_password: 'secret', web_report_url: 'https://report', seo_notes: 'looks good' },
      },
    ],
  }),
}));

describe('DealServiceInfo', () => {
  it('shows shared notes + report, never credentials', () => {
    render(<DealServiceInfo dealId="d1" />);
    expect(screen.getByText('looks good')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://report' })).toBeInTheDocument();
    expect(screen.queryByText('secret')).toBeNull();
  });
});
