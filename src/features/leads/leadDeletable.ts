// A lead is permanently deletable only if it is NOT won and NOT converted —
// deleting those would orphan real customer/billing records.
export function isLeadDeletable(lead: {
  converted_at: string | null;
  stage?: { code?: string | null } | null;
}): boolean {
  if (lead.converted_at) return false;
  if (lead.stage?.code === 'won') return false;
  return true;
}
