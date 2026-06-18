import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DndContext } from '@dnd-kit/core';
import { SalesKanbanColumn } from './SalesKanbanColumn';

const onLoadMore = vi.fn();

function makeLeads(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: String(i),
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
  })) as never[];
}

function renderCol(props: Partial<React.ComponentProps<typeof SalesKanbanColumn>> = {}) {
  return render(
    <MemoryRouter>
      <DndContext>
        <SalesKanbanColumn
          stageId="s1"
          stageLabel="New Lead"
          leads={[]}
          total={0}
          hasMore={false}
          onLoadMore={onLoadMore}
          isLoadingMore={false}
          isLoading={false}
          nameFor={() => ''}
          {...props}
        />
      </DndContext>
    </MemoryRouter>,
  );
}

describe('SalesKanbanColumn', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows a lock when locked', () => {
    renderCol({ locked: true });
    expect(screen.getByTitle('locked')).toBeInTheDocument();
  });

  it('renders the loaded cards plus a Load more button when there are more', () => {
    const { container } = renderCol({ leads: makeLeads(50), total: 533, hasMore: true });
    expect(container.querySelectorAll('[data-testid="kanban-card"]').length).toBe(50);
    expect(screen.getByTestId('load-more')).toBeInTheDocument();
  });

  it('clicking Load more calls onLoadMore', async () => {
    const user = userEvent.setup();
    renderCol({ leads: makeLeads(50), total: 533, hasMore: true });
    await user.click(screen.getByTestId('load-more'));
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it('shows no Load more button when everything is loaded', () => {
    renderCol({ leads: makeLeads(20), total: 20, hasMore: false });
    expect(screen.queryByTestId('load-more')).toBeNull();
  });
});
