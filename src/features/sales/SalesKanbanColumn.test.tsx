import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { SalesKanbanColumn } from './SalesKanbanColumn';

// i18next falls back to keys in tests; we assert on the lock glyph, not copy.
function renderCol(locked: boolean) {
  return render(
    <DndContext>
      <SalesKanbanColumn stageId="s1" stageLabel="Unique Lead" leads={[]} locked={locked} />
    </DndContext>,
  );
}

describe('SalesKanbanColumn', () => {
  it('shows a lock when locked', () => {
    renderCol(true);
    expect(screen.getByTitle('locked')).toBeInTheDocument();
  });

  it('shows no lock when not locked', () => {
    renderCol(false);
    expect(screen.queryByTitle('locked')).not.toBeInTheDocument();
  });
});
