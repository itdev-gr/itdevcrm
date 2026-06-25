import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect } from 'vitest';
import { i18n } from '@/lib/i18n';
import { UserTaskDetailDialog } from './UserTaskDetailDialog';

const card = {
  key: 'user:u1', kind: 'user' as const, id: 'u1', title: 'Call ACME',
  importance: 'high' as const, relation: 'mine' as const, resolved: false,
  assigneeId: 'me', creatorId: 'me', createdAtIso: '2025-12-20T08:30:00Z',
  dueAt: '2026-07-01T09:00:00Z',
  resolvedAt: null, startedAtIso: null, sourceCode: null, link: null,
  notes: 'ring after lunch', clientName: 'ACME',
};

function wrap(n: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>{n}</I18nextProvider>
    </QueryClientProvider>
  );
}

describe('UserTaskDetailDialog', () => {
  it('shows title, notes, and client', () => {
    render(wrap(<UserTaskDetailDialog card={card} onOpenChange={() => {}} />));
    expect(screen.getByText('Call ACME')).toBeInTheDocument();
    expect(screen.getByText('ring after lunch')).toBeInTheDocument();
    expect(screen.getAllByText(/ACME/).length).toBeGreaterThan(0);
  });

  it('shows who created the task and when', () => {
    render(wrap(<UserTaskDetailDialog card={card} creatorName="Maria Pap" onOpenChange={() => {}} />));
    expect(screen.getByText('Maria Pap')).toBeInTheDocument();
    expect(screen.getByText(/2025/)).toBeInTheDocument();
  });

  it('renders nothing when card is null', () => {
    const { container } = render(wrap(<UserTaskDetailDialog card={null} onOpenChange={() => {}} />));
    expect(container).toBeEmptyDOMElement();
  });
});
