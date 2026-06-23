import type { ReactNode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

vi.mock('./TasksKanbanBoard', () => ({ TasksKanbanBoard: () => <div>BOARD</div> }));
vi.mock('./ResolvedArchive', () => ({ ResolvedArchive: () => <div>ARCHIVE</div> }));
// The page now renders TaskDialog (data hooks); this test only covers tab switching.
vi.mock('@/features/home/TaskDialog', () => ({ TaskDialog: () => null }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { resolvedLanguage: 'en' } }),
}));
vi.mock('@/lib/utils', () => ({ cn: (...a: unknown[]) => a.filter(Boolean).join(' ') }));

import { MyTasksPage } from './MyTasksPage';

const wrap = (ui: ReactNode) => render(<>{ui}</>);

describe('MyTasksPage', () => {
  it('shows the board by default and switches to the archive tab', () => {
    wrap(<MyTasksPage />);
    expect(screen.getByText('BOARD')).toBeInTheDocument();
    expect(screen.queryByText('ARCHIVE')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('tasks_page.tab_archive'));
    expect(screen.getByText('ARCHIVE')).toBeInTheDocument();
    expect(screen.queryByText('BOARD')).not.toBeInTheDocument();
  });
});
