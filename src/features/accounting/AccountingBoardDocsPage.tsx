import { BoardDocView } from '@/features/tech/TechBoardDocsPage';

// Accounting spans several pages (not a single /tech board), so it gets its own
// /accounting/docs route rendering the shared board-docs view pinned to
// docs/boards/accounting.md.
export function AccountingBoardDocsPage() {
  return <BoardDocView slug="accounting" />;
}
