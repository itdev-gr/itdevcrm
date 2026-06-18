import { describe, it, expect } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { SalesKanbanColumn } from './SalesKanbanColumn';

// i18next falls back to keys in tests, so we assert on structure (hrefs, card
// count, the lock glyph) rather than translated/interpolated copy.
const HREF = '/sales/leads?stage=s1';

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
          overflowHref={HREF}
          nameFor={() => ''}
          {...props}
        />
      </DndContext>
    </MemoryRouter>,
  );
}

describe('SalesKanbanColumn', () => {
  it('shows a lock when locked', () => {
    renderCol({ locked: true });
    expect(screen.getByTitle('locked')).toBeInTheDocument();
  });

  it('renders zero cards when collapsed, with a link to the list', () => {
    const { container } = renderCol({ collapsed: true, leads: makeLeads(2), total: 1744 });
    expect(container.querySelectorAll('[data-testid="kanban-card"]').length).toBe(0);
    expect(container.querySelector(`a[href="${HREF}"]`)).toBeTruthy();
  });

  it('mounts the shown cards plus an overflow link when total exceeds shown', () => {
    const { container } = renderCol({ leads: makeLeads(50), total: 533 });
    expect(container.querySelectorAll('[data-testid="kanban-card"]').length).toBe(50);
    expect(container.querySelector(`a[href="${HREF}"]`)).toBeTruthy();
  });

  it('shows no overflow link when everything is shown', () => {
    const { container } = renderCol({ leads: makeLeads(3), total: 3 });
    expect(container.querySelector(`a[href="${HREF}"]`)).toBeNull();
  });
});
