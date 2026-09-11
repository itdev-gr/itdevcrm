import { describe, it, expect, beforeAll } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import '@/lib/i18n';
import { i18n } from '@/lib/i18n';
import { SalesKanbanCard } from './SalesKanbanCard';
import type { LeadRow } from '@/features/leads/hooks/useLeads';

function lead(over: Partial<LeadRow>): LeadRow {
  return {
    id: 'l1',
    code: '006895',
    title: '',
    contact_first_name: null,
    contact_last_name: null,
    company_name: null,
    notes: null,
    source: 'import',
    services_planned: [],
    industry: null,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...over,
  } as unknown as LeadRow;
}

function renderCard(row: LeadRow) {
  return render(
    <MemoryRouter>
      <DndContext>
        <SalesKanbanCard lead={row} />
      </DndContext>
    </MemoryRouter>,
  );
}

describe('SalesKanbanCard — ΟΝΟΜΑ ΕΠΩΝΥΜΟ (SERVICE)', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('el');
  });

  it('keeps the service the title already carried instead of dropping it', () => {
    // The old card did `contactName || company_name || title`, so the label
    // vanished for every Meta lead that had a contact name — i.e. all of them.
    renderCard(
      lead({
        source: 'meta',
        title: 'Μαργαρίτα Γραβέζα (Local SEO)',
        contact_first_name: 'Μαργαρίτα',
        contact_last_name: 'Γραβέζα',
      }),
    );
    expect(screen.getByText('Μαργαρίτα Γραβέζα')).toBeInTheDocument();
    expect(screen.getByText('(Local SEO)')).toBeInTheDocument();
  });

  it('labels an imported lead whose form only survives in the notes', () => {
    renderCard(
      lead({
        company_name: 'Paintball Nafplio',
        title: 'Paintball Nafplio',
        notes: 'Φόρμα: 🧲 SOCIAL MEDIA LEAD FORM (ITDEV)\nέχεις google business profile: ναι',
      }),
    );
    expect(screen.getByText('Paintball Nafplio')).toBeInTheDocument();
    expect(screen.getByText('(Social Media)')).toBeInTheDocument();
  });

  it('labels a franchise lead even with no form anywhere', () => {
    renderCard(
      lead({ source: 'franchise', title: 'Κωνσταντίνος Κατσιδήμας', contact_first_name: 'Κωνσταντίνος' }),
    );
    expect(screen.getByText('(Franchise)')).toBeInTheDocument();
  });

  it('shows a bare name when nothing tells us the service', () => {
    renderCard(lead({ title: 'Akteon', company_name: 'Akteon', notes: 'clickup task id: 86ca724dj' }));
    expect(screen.getByText('Akteon')).toBeInTheDocument();
    expect(screen.queryByText(/^\(/)).not.toBeInTheDocument();
  });
});
