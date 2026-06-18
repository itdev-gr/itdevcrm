import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n';
import { GlobalSearch } from './GlobalSearch';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }));

function wrap() {
  const qc = new QueryClient();
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <GlobalSearch />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('GlobalSearch job hits', () => {
  it('renders a job hit that links to /jobs/:id', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          entity_type: 'job',
          entity_id: 'job-1',
          code: '000013-WEBSEO',
          label: 'Acme Ltd',
          sublabel: 'web_seo · 000013',
          rank: 0,
        },
      ],
      error: null,
    });
    render(wrap());
    await userEvent.type(screen.getByRole('searchbox'), '000013-WEBSEO');
    const link = await screen.findByRole('link', { name: /000013-WEBSEO/ });
    expect(link).toHaveAttribute('href', '/jobs/job-1');
    expect(screen.getByText('Job')).toBeInTheDocument();
  });
});
