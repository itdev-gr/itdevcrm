import { render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { describe, it, expect } from 'vitest';
import { JobsKanbanColumn } from './JobsKanbanColumn';

// Regression coverage for fix-round-1: the archived column used to inherit
// the shared component's red/lock "blocked" treatment purely because both
// are non-interactive, which read as a bug ("why is finished work marked as
// blocked?"). Blocked must keep its red/lock look; archived must read as
// neutral/filed-away instead — driven off stageCode, not off `interactive`.
function renderColumn(props: Partial<Parameters<typeof JobsKanbanColumn>[0]> = {}) {
  return render(
    <DndContext>
      <JobsKanbanColumn
        stageId="col-1"
        stageIndex={0}
        stageLabel="Column"
        jobs={[]}
        {...props}
      />
    </DndContext>,
  );
}

describe('JobsKanbanColumn — blocked vs archived styling', () => {
  it('__blocked__ keeps the red/lock treatment', () => {
    const { container } = renderColumn({
      stageId: '__blocked__',
      stageCode: 'blocked',
      interactive: false,
    });
    expect(container.querySelector('.lucide-lock')).toBeInTheDocument();
    expect(container.querySelector('.lucide-archive')).not.toBeInTheDocument();
    expect(container.querySelector('.bg-red-50\\/30')).toBeInTheDocument();
  });

  it('__archived__ reads as neutral/filed-away, not red/blocked', () => {
    const { container } = renderColumn({
      stageId: '__archived__',
      stageCode: 'archived',
      interactive: false,
    });
    expect(container.querySelector('.lucide-archive')).toBeInTheDocument();
    expect(container.querySelector('.lucide-lock')).not.toBeInTheDocument();
    expect(container.querySelector('.bg-red-50\\/30')).not.toBeInTheDocument();
    expect(container.querySelector('.bg-muted\\/30')).toBeInTheDocument();
  });

  it('archived stays a non-drop-target, same as blocked', () => {
    renderColumn({ stageId: '__archived__', stageCode: 'archived', interactive: false });
    // No "Drop jobs here" placeholder — that copy is interactive-only.
    expect(screen.queryByText('Drop jobs here')).not.toBeInTheDocument();
  });
});
