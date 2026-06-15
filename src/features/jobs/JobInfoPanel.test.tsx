import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JobInfoPanel } from './JobInfoPanel';

function renderPanel(serviceType: string, details: Record<string, unknown> = {}) {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <JobInfoPanel jobId="j1" serviceType={serviceType} initialDetails={details} />
    </QueryClientProvider>,
  );
}

describe('JobInfoPanel', () => {
  it('renders a web_seo password input masked by default', () => {
    renderPanel('web_seo', { website_password: 'secret' });
    const input = screen.getByDisplayValue('secret') as HTMLInputElement;
    expect(input.type).toBe('password');
  });
  it('shows both sections for ai_seo', () => {
    renderPanel('ai_seo');
    expect(screen.getByText('Local SEO')).toBeInTheDocument();
    expect(screen.getByText('Web SEO')).toBeInTheDocument();
  });
});
