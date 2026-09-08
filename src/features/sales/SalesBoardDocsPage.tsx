import { BoardDocView } from '@/features/tech/TechBoardDocsPage';

// Sales lives outside /tech/:serviceType, so it gets its own /sales/docs route
// that renders the shared board-docs view. Since 2026-09-08 the sales pipeline
// IS the Under Development board (the classic board was retired), so the docs
// point at docs/boards/under-development.md.
export function SalesBoardDocsPage() {
  return <BoardDocView slug="under-development" />;
}
