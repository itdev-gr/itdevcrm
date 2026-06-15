import { BoardDocView } from '@/features/tech/TechBoardDocsPage';

// Sales lives outside /tech/:serviceType, so it gets its own /sales/docs route
// that renders the shared board-docs view pinned to docs/boards/sales.md.
export function SalesBoardDocsPage() {
  return <BoardDocView slug="sales" />;
}
