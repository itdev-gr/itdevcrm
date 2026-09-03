import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/lib/i18n';

// useEntityCommentFiles is a react-query hook, so the component needs either a
// QueryClientProvider or a stub. Stubbing keeps these tests about which SECTIONS
// render per parentType, matching how every other collaborator here is mocked —
// the hook's own behaviour is covered in hooks/useEntityCommentFiles.test.ts.
const { commentFiles } = vi.hoisted(() => ({ commentFiles: { value: [] as unknown[] } }));
vi.mock('./hooks/useEntityCommentFiles', () => ({
  useEntityCommentFiles: () => ({ data: commentFiles.value }),
}));
vi.mock('./AttachmentGallery', () => ({
  AttachmentGallery: () => <div data-testid="comment-files-panel" />,
}));

vi.mock('./AttachmentsPanel', () => ({
  AttachmentsPanel: () => <div data-testid="files-panel" />,
}));
vi.mock('@/features/offers/OffersTab', () => ({
  OffersTab: () => <div data-testid="offers-panel" />,
}));
vi.mock('@/features/proformas/ProFormasTab', () => ({
  ProFormasTab: () => <div data-testid="proformas-panel" />,
}));
vi.mock('@/features/contracts/ContractsTab', () => ({
  ContractsTab: () => <div data-testid="contracts-panel" />,
}));
vi.mock('@/features/deals/DealJobFiles', () => ({
  DealJobFiles: () => <div data-testid="job-files-panel" />,
}));

import { CombinedAttachmentsTab } from './CombinedAttachmentsTab';

describe('CombinedAttachmentsTab', () => {
  beforeEach(() => {
    commentFiles.value = [];
  });

  it('deal: shows files, offers, pro formas and contracts', () => {
    render(
      <CombinedAttachmentsTab parentType="deal" parentId="d1" dealId="d1" clientId="c1" />,
    );
    expect(screen.getByTestId('files-panel')).toBeInTheDocument();
    expect(screen.getByTestId('offers-panel')).toBeInTheDocument();
    expect(screen.getByTestId('proformas-panel')).toBeInTheDocument();
    expect(screen.getByTestId('contracts-panel')).toBeInTheDocument();
  });

  it('lead: shows files, offers, pro formas — no contracts', () => {
    render(<CombinedAttachmentsTab parentType="lead" parentId="l1" leadId="l1" />);
    expect(screen.getByTestId('files-panel')).toBeInTheDocument();
    expect(screen.getByTestId('offers-panel')).toBeInTheDocument();
    expect(screen.getByTestId('proformas-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('contracts-panel')).not.toBeInTheDocument();
  });

  it('client: shows files, contracts and offers — but no pro formas', () => {
    // Offers can be filed straight on a client (accounting/upsell flow); pro
    // formas are still only drafted from a lead or a deal.
    render(<CombinedAttachmentsTab parentType="client" parentId="c1" clientId="c1" />);
    expect(screen.getByTestId('files-panel')).toBeInTheDocument();
    expect(screen.getByTestId('contracts-panel')).toBeInTheDocument();
    expect(screen.getByTestId('offers-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('proformas-panel')).not.toBeInTheDocument();
  });

  it('deal without client: no contracts section', () => {
    render(<CombinedAttachmentsTab parentType="deal" parentId="d1" dealId="d1" />);
    expect(screen.queryByTestId('contracts-panel')).not.toBeInTheDocument();
  });

  it('hides the comment-files section when there are none', () => {
    render(<CombinedAttachmentsTab parentType="deal" parentId="d1" dealId="d1" />);
    expect(screen.queryByTestId('comment-files-panel')).not.toBeInTheDocument();
  });

  it('shows the comment-files section once a comment carries a file', () => {
    commentFiles.value = [{ id: 'f1' }];
    render(<CombinedAttachmentsTab parentType="deal" parentId="d1" dealId="d1" />);
    expect(screen.getByTestId('comment-files-panel')).toBeInTheDocument();
  });
});
