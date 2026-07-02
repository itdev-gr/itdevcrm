import type { ReactNode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const release = vi.fn();
const discard = vi.fn();
const { useLeadIntake } = vi.hoisted(() => ({ useLeadIntake: vi.fn() }));

vi.mock('./hooks/useLeadIntake', () => ({ useLeadIntake }));
vi.mock('./hooks/useReleaseLeadIntake', () => ({
  useReleaseLeadIntake: () => ({ mutate: release, isPending: false }),
}));
vi.mock('./hooks/useDiscardLeadIntake', () => ({
  useDiscardLeadIntake: () => ({ mutate: discard, isPending: false }),
}));
const merge = vi.fn();
vi.mock('./hooks/useMergeLeadIntake', () => ({
  useMergeLeadIntake: () => ({ mutate: merge, isPending: false }),
}));
const { useDeadEndLeads } = vi.hoisted(() => ({ useDeadEndLeads: vi.fn() }));
vi.mock('./hooks/useDeadEndLeads', () => ({ useDeadEndLeads }));
const { useColdLeads } = vi.hoisted(() => ({ useColdLeads: vi.fn() }));
vi.mock('./hooks/useColdLeads', () => ({ useColdLeads }));
const reengage = vi.fn();
vi.mock('./hooks/useReengageLeadIntake', () => ({
  useReengageLeadIntake: () => ({ mutate: reengage, isPending: false }),
}));
const setAutoMerge = vi.fn();
vi.mock('./hooks/useAutoMerge', () => ({
  useAutoMerge: () => ({
    autoEnabled: false,
    isLoading: false,
    setEnabled: { mutate: setAutoMerge, isPending: false },
  }),
}));
const setAutoRelease = vi.fn();
vi.mock('./hooks/useAutoRelease', () => ({
  useAutoRelease: () => ({
    autoEnabled: false,
    isLoading: false,
    setEnabled: { mutate: setAutoRelease, isPending: false },
  }),
}));
const bulkMerge = vi.fn();
vi.mock('./hooks/useBulkMergeIntake', () => ({
  useBulkMergeIntake: () => ({ mutateAsync: bulkMerge, isPending: false }),
}));
const { useBulkMergePreview } = vi.hoisted(() => ({ useBulkMergePreview: vi.fn() }));
vi.mock('./hooks/useBulkMergePreview', () => ({ useBulkMergePreview }));
const bulkRelease = vi.fn();
vi.mock('./hooks/useBulkReleaseIntake', () => ({
  useBulkReleaseIntake: () => ({ mutateAsync: bulkRelease, isPending: false }),
}));
const { useBulkReleasePreview } = vi.hoisted(() => ({ useBulkReleasePreview: vi.fn() }));
vi.mock('./hooks/useBulkReleasePreview', () => ({ useBulkReleasePreview }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('react-router-dom', () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
vi.mock('./LeadImportControls', () => ({ LeadImportControls: () => null }));

import { LeadIntakePage } from './LeadIntakePage';

describe('LeadIntakePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useBulkMergePreview.mockReturnValue({ data: { mergeable: 0, dead_end: 0 }, isLoading: false });
    useBulkReleasePreview.mockReturnValue({ data: { releasable: 0 }, isLoading: false });
    useDeadEndLeads.mockReturnValue(new Set());
    useColdLeads.mockReturnValue(new Set());
  });

  it('confirms before releasing a flagged (duplicate) lead, then forces release', () => {
    useLeadIntake.mockReturnValue({
      data: [
        {
          id: 'i1',
          title: 'AI SEO form',
          contact_first_name: 'Xenia',
          contact_last_name: 'Kara',
          email: 'x@kara.gr',
          phone: '+306900000001',
          created_at: '2026-06-19T10:00:00Z',
          matched_on: ['email'],
          matches: [
            {
              match_type: 'lead',
              record_id: 'L1',
              display_name: 'Old Lead',
              context: 'Won',
              matched_field: 'email',
              matched_email: 'old@kara.gr',
              matched_phone: '6900000099',
            },
          ],
        },
      ],
      isLoading: false,
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<LeadIntakePage />);
    expect(screen.getByText('x@kara.gr')).toBeInTheDocument();
    expect(screen.getByText('Old Lead')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'leads:intake.release' }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith({ id: 'i1', force: true });
  });

  it('does not release a flagged lead when the confirm is dismissed', () => {
    useLeadIntake.mockReturnValue({
      data: [
        {
          id: 'i1',
          title: 'AI SEO form',
          email: 'x@kara.gr',
          phone: '+306900000001',
          created_at: '2026-06-19T10:00:00Z',
          matched_on: ['email'],
          matches: [
            {
              match_type: 'lead',
              record_id: 'L1',
              display_name: 'Old Lead',
              context: 'Won',
              matched_field: 'email',
              matched_email: 'old@kara.gr',
              matched_phone: null,
            },
          ],
        },
      ],
      isLoading: false,
    });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<LeadIntakePage />);
    fireEvent.click(screen.getByRole('button', { name: 'leads:intake.release' }));
    expect(release).not.toHaveBeenCalled();
  });

  it('shows a clean (no-duplicate) lead with the clean indicator', () => {
    useLeadIntake.mockReturnValue({
      data: [
        {
          id: 'i2',
          title: 'Contact form',
          contact_first_name: 'New',
          contact_last_name: 'Person',
          email: 'new@person.gr',
          phone: '+306900000002',
          created_at: '2026-06-19T11:00:00Z',
          matched_on: [],
          matches: [],
        },
      ],
      isLoading: false,
    });
    render(<LeadIntakePage />);
    expect(screen.getByText('new@person.gr')).toBeInTheDocument();
    expect(screen.getByText(/leads:intake.clean/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'leads:intake.release' }));
    expect(release).toHaveBeenCalledWith({ id: 'i2', force: false });
  });

  it('shows the empty state', () => {
    useLeadIntake.mockReturnValue({ data: [], isLoading: false });
    render(<LeadIntakePage />);
    expect(screen.getByText('leads:intake.empty')).toBeInTheDocument();
  });

  it('opens the picker and merges into the chosen lead when there are 2+ matches', () => {
    useLeadIntake.mockReturnValue({
      data: [
        {
          id: 'i9',
          title: 'Form',
          email: 'd@x.gr',
          phone: '+306900000009',
          created_at: '2026-06-19T13:00:00Z',
          matched_on: ['phone'],
          matches: [
            {
              match_type: 'lead',
              record_id: 'L1',
              display_name: 'Lead One',
              context: 'New',
              matched_field: 'phone',
              matched_email: null,
              matched_phone: '6900000009',
            },
            {
              match_type: 'lead',
              record_id: 'L2',
              display_name: 'Lead Two',
              context: 'Won',
              matched_field: 'phone',
              matched_email: null,
              matched_phone: '6900000009',
            },
          ],
        },
      ],
      isLoading: false,
    });
    render(<LeadIntakePage />);
    // First click opens the picker (does not merge yet — ambiguous).
    fireEvent.click(screen.getByRole('button', { name: 'leads:intake.merge' }));
    expect(merge).not.toHaveBeenCalled();
    // Choosing a specific lead merges into it.
    fireEvent.click(screen.getByRole('button', { name: /Lead Two/ }));
    expect(merge).toHaveBeenCalledWith({ id: 'i9', targetLeadId: 'L2' });
  });

  it('merges directly when there is exactly one lead match', () => {
    useLeadIntake.mockReturnValue({
      data: [
        {
          id: 'i1',
          title: 'AI SEO form',
          email: 'x@kara.gr',
          phone: '+306900000001',
          created_at: '2026-06-19T10:00:00Z',
          matched_on: ['email'],
          matches: [
            {
              match_type: 'lead',
              record_id: 'L1',
              display_name: 'Old Lead',
              context: 'Won',
              matched_field: 'email',
              matched_email: 'old@kara.gr',
              matched_phone: null,
            },
          ],
        },
      ],
      isLoading: false,
    });
    render(<LeadIntakePage />);
    fireEvent.click(screen.getByRole('button', { name: 'leads:intake.merge' }));
    expect(merge).toHaveBeenCalledWith({ id: 'i1', targetLeadId: 'L1' });
  });

  it('disables Merge when there is no lead match', () => {
    useLeadIntake.mockReturnValue({
      data: [
        {
          id: 'i3',
          title: 'Contact',
          email: 'c@x.gr',
          phone: '+306900000003',
          created_at: '2026-06-19T12:00:00Z',
          matched_on: ['email'],
          matches: [
            {
              match_type: 'deal_client',
              record_id: 'C1',
              display_name: 'Existing Customer',
              context: 'D-1',
              matched_field: 'email',
              matched_email: 'c@x.gr',
              matched_phone: null,
            },
          ],
        },
      ],
      isLoading: false,
    });
    render(<LeadIntakePage />);
    expect(screen.getByRole('button', { name: 'leads:intake.merge' })).toBeDisabled();
  });

  it('shows the bulk merge count and runs it after confirm', () => {
    useBulkMergePreview.mockReturnValue({ data: { mergeable: 3, dead_end: 1 }, isLoading: false });
    useLeadIntake.mockReturnValue({ data: [], isLoading: false });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    bulkMerge.mockResolvedValue({ ok: true, merged: 3, dropped: 1, remaining: 0 });
    render(<LeadIntakePage />);
    fireEvent.click(screen.getByRole('button', { name: /leads:intake.bulk_merge/ }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(bulkMerge).toHaveBeenCalled();
  });

  it('shows the bulk release count and runs it after confirm', () => {
    useBulkReleasePreview.mockReturnValue({ data: { releasable: 5 }, isLoading: false });
    useLeadIntake.mockReturnValue({ data: [], isLoading: false });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    bulkRelease.mockResolvedValue({ ok: true, released: 5, remaining: 0 });
    render(<LeadIntakePage />);
    fireEvent.click(screen.getByRole('button', { name: /leads:intake.bulk_release/ }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(bulkRelease).toHaveBeenCalled();
  });

  it('disables bulk release when the count is zero', () => {
    useBulkReleasePreview.mockReturnValue({ data: { releasable: 0 }, isLoading: false });
    useLeadIntake.mockReturnValue({ data: [], isLoading: false });
    render(<LeadIntakePage />);
    expect(screen.getByRole('button', { name: /leads:intake.bulk_release/ })).toBeDisabled();
  });

  it('disables bulk merge when the count is zero', () => {
    useBulkMergePreview.mockReturnValue({ data: { mergeable: 0, dead_end: 0 }, isLoading: false });
    useLeadIntake.mockReturnValue({ data: [], isLoading: false });
    render(<LeadIntakePage />);
    expect(screen.getByRole('button', { name: /leads:intake.bulk_merge/ })).toBeDisabled();
  });

  it('warns before merging into a dead-end target and merges only on confirm', () => {
    useDeadEndLeads.mockReturnValue(new Set(['L1']));
    useLeadIntake.mockReturnValue({
      data: [
        {
          id: 'i9',
          title: 'Form',
          email: 'd@x.gr',
          phone: '+306900000009',
          created_at: '2026-06-19T13:00:00Z',
          matched_on: ['phone'],
          matches: [
            { match_type: 'lead', record_id: 'L1', display_name: 'Lead One', context: 'Not Interested', matched_field: 'phone', matched_email: null, matched_phone: '6900000009' },
            { match_type: 'lead', record_id: 'L2', display_name: 'Lead Two', context: 'New', matched_field: 'phone', matched_email: null, matched_phone: '6900000009' },
          ],
        },
      ],
      isLoading: false,
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<LeadIntakePage />);
    fireEvent.click(screen.getByRole('button', { name: 'leads:intake.merge' })); // opens picker
    fireEvent.click(screen.getByRole('button', { name: /Lead One/ })); // dead-end target
    expect(confirmSpy).toHaveBeenCalled();
    expect(merge).toHaveBeenCalledWith({ id: 'i9', targetLeadId: 'L1' });
  });

  it('does not direct-merge a single dead-end match when confirm is dismissed', () => {
    useDeadEndLeads.mockReturnValue(new Set(['L1']));
    useLeadIntake.mockReturnValue({
      data: [
        {
          id: 'i1',
          title: 'AI SEO form',
          email: 'x@kara.gr',
          phone: '+306900000001',
          created_at: '2026-06-19T10:00:00Z',
          matched_on: ['email'],
          matches: [
            { match_type: 'lead', record_id: 'L1', display_name: 'Old Lead', context: 'Dead End', matched_field: 'email', matched_email: 'old@kara.gr', matched_phone: null },
          ],
        },
      ],
      isLoading: false,
    });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<LeadIntakePage />);
    fireEvent.click(screen.getByRole('button', { name: 'leads:intake.merge' }));
    expect(merge).not.toHaveBeenCalled();
  });

  it('keeps the picker open when the dead-end confirm is dismissed', () => {
    useDeadEndLeads.mockReturnValue(new Set(['L1']));
    useLeadIntake.mockReturnValue({
      data: [
        {
          id: 'i9',
          title: 'Form',
          email: 'd@x.gr',
          phone: '+306900000009',
          created_at: '2026-06-19T13:00:00Z',
          matched_on: ['phone'],
          matches: [
            { match_type: 'lead', record_id: 'L1', display_name: 'Lead One', context: 'Not Interested', matched_field: 'phone', matched_email: null, matched_phone: '6900000009' },
            { match_type: 'lead', record_id: 'L2', display_name: 'Lead Two', context: 'New', matched_field: 'phone', matched_email: null, matched_phone: '6900000009' },
          ],
        },
      ],
      isLoading: false,
    });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<LeadIntakePage />);
    fireEvent.click(screen.getByRole('button', { name: 'leads:intake.merge' })); // open picker
    fireEvent.click(screen.getByRole('button', { name: /Lead One/ })); // dead-end target, confirm dismissed
    expect(merge).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Lead Two/ })).toBeInTheDocument(); // picker still open
  });

  it('re-engages a cold lead on Release for a Meta row matching a single cold lead', () => {
    useColdLeads.mockReturnValue(new Set(['cold-lead-1']));
    useLeadIntake.mockReturnValue({
      data: [
        {
          id: 'row1',
          source: 'meta',
          title: 'Meta form',
          email: 'cold@test.gr',
          phone: '+306900000010',
          created_at: '2026-06-22T10:00:00Z',
          matched_on: ['email'],
          matches: [
            {
              match_type: 'lead',
              record_id: 'cold-lead-1',
              display_name: 'Old Lead',
              context: 'Cold',
              matched_field: 'email',
              matched_email: 'cold@test.gr',
              matched_phone: null,
            },
          ],
        },
      ],
      isLoading: false,
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<LeadIntakePage />);
    fireEvent.click(screen.getByRole('button', { name: 'leads:intake.release' }));
    expect(reengage).toHaveBeenCalledWith({ id: 'row1', targetLeadId: 'cold-lead-1' });
    expect(release).not.toHaveBeenCalled();
  });
});
