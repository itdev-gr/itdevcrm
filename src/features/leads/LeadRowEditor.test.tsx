import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import { i18n } from '@/lib/i18n';

const mutateAsync = vi.fn().mockResolvedValue(undefined);

vi.mock('./hooks/useUpdateLead', () => ({
  useUpdateLead: () => ({ mutateAsync }),
}));

import { LeadRowEditor } from './LeadRowEditor';
import type { LeadRow } from './hooks/useLeads';
import type { AssignableOwner } from './hooks/useAssignableOwners';
import type { StageRow } from '@/features/stages/hooks/usePipelineStages';

const baseLead: LeadRow = {
  id: 'lead-1',
  code: 'L-001',
  title: 'Test Lead',
  source: 'manual',
  contact_first_name: 'John',
  contact_last_name: 'Doe',
  email: 'john@example.com',
  phone: '6900000000',
  website: 'https://example.com',
  company_name: 'Acme Ltd',
  owner_user_id: null,
  stage_id: 's1',
  industry: null,
  archived: false,
  archived_at: null,
  archived_by: null,
  archived_reason: null,
  additional_contacts: [],
  additional_notes: null,
  address: null,
  automations_enabled: true,
  contact_info: null,
  converted_at: null,
  converted_client_id: null,
  converted_deal_id: null,
  country: null,
  created_at: new Date().toISOString(),
  created_by: null,
  email_opt_out: false,
  estimated_monthly_value: 0,
  estimated_one_time_value: 0,
  expected_close_date: null,
  notes: null,
  payment_method: null,
  scheduled_for: null,
  services_planned: [],
  source_data: null,
  unsubscribe_token: 'tok',
  updated_at: new Date().toISOString(),
  vat_number: null,
  won_by_user_id: null,
  stage: null,
};

const owners: AssignableOwner[] = [
  { user_id: 'u1', full_name: 'Alice', email: 'alice@itdev.gr', is_admin: true },
];

const stages: StageRow[] = [
  {
    id: 's1',
    board: 'leads',
    code: 'new',
    display_names: { en: 'New', el: 'Νέο' },
    position: 0,
    color: null,
    is_terminal: false,
    terminal_outcome: null,
    triggers_action: null,
    archived: false,
    restricted_to_user_id: null,
  },
];

function renderRow(lead: LeadRow = baseLead) {
  render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <table>
          <tbody>
            <LeadRowEditor
              lead={lead}
              owners={owners}
              stages={stages}
              currentUserId={null}
              lang="en"
              selected={false}
              onToggleSelect={() => {}}
            />
          </tbody>
        </table>
      </I18nextProvider>
    </MemoryRouter>,
  );
}

describe('LeadRowEditor patch mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blurring Full Name with a new value calls mutateAsync with contact_first_name and contact_last_name: null', async () => {
    const user = userEvent.setup();
    renderRow();

    // The Full Name input shows "John Doe" (the joined name from baseLead)
    const input = screen.getByDisplayValue('John Doe');
    await user.clear(input);
    await user.type(input, 'Jane Smith');
    await user.tab(); // blur

    expect(mutateAsync).toHaveBeenCalledOnce();
    const call = mutateAsync.mock.calls[0] as [{ id: string; patch: Record<string, unknown> }];
    expect(call[0].patch).toEqual({ contact_first_name: 'Jane Smith', contact_last_name: null });
  });

  it('changing Assign-to select to Unassigned calls mutateAsync with owner_user_id: null', async () => {
    const user = userEvent.setup();
    // Render with a pre-selected owner so the change to unassigned is distinct
    renderRow({ ...baseLead, owner_user_id: 'u1' });

    const select = screen.getByDisplayValue('Alice');
    await user.selectOptions(select, '__unassigned__');

    expect(mutateAsync).toHaveBeenCalledOnce();
    const call = mutateAsync.mock.calls[0] as [{ id: string; patch: Record<string, unknown> }];
    expect(call[0].patch).toEqual({ owner_user_id: null });
  });

  it('blurring Lead title with empty value makes no mutateAsync call (required field reverts)', async () => {
    const user = userEvent.setup();
    renderRow();

    // Find the Title input — it shows the lead.title value "Test Lead"
    const input = screen.getByDisplayValue('Test Lead');
    await user.clear(input);
    await user.tab(); // blur with empty value → should revert, not commit

    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
