// Pure grouping for the client_flow_for_range RPC rows (kind-typed, one row
// per entity) so the section renders counts and drill-down lists from one call.
export type ClientFlowKind = 'new_deal' | 'stopped_client' | 'renewal_client';

export type ClientFlowRow = {
  kind: ClientFlowKind;
  client_id: string;
  client_name: string;
  deal_id: string | null;
  deal_code: string | null;
  event_date: string; // YYYY-MM-DD
};

export type ClientFlowGroups = {
  newDeals: ClientFlowRow[];
  stopped: ClientFlowRow[];
  renewals: ClientFlowRow[];
};

export function groupClientFlow(rows: ClientFlowRow[]): ClientFlowGroups {
  const byName = (a: ClientFlowRow, b: ClientFlowRow) =>
    a.client_name.localeCompare(b.client_name, 'el');
  return {
    newDeals: rows.filter((r) => r.kind === 'new_deal').sort(byName),
    stopped: rows.filter((r) => r.kind === 'stopped_client').sort(byName),
    renewals: rows.filter((r) => r.kind === 'renewal_client').sort(byName),
  };
}
