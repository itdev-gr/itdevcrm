export const UNASSIGNED = '__unassigned__';

export type LeadLike = {
  id: string;
  code: string | null;
  source: string | null;
  title: string | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  industry: string | null;
  company_name: string | null;
  owner_user_id: string | null;
  stage_id: string | null;
};

export type LeadSortKey =
  | 'code' | 'source' | 'title' | 'full_name' | 'email' | 'phone'
  | 'website' | 'industry' | 'company_name' | 'owner' | 'status';

export type LeadSort = { key: LeadSortKey; dir: 'asc' | 'desc' };

export type FilterOpts = {
  search?: string;
  statusId?: string | null;
  ownerId?: string | null; // uuid | UNASSIGNED | null
  sort?: LeadSort;
  ownerLabel?: (id: string | null) => string;
  statusLabel?: (stageId: string | null) => string;
};

function fullName(l: LeadLike): string {
  return [l.contact_first_name, l.contact_last_name].filter(Boolean).join(' ');
}

export function filterAndSortLeads<T extends LeadLike>(leads: T[], opts: FilterOpts): T[] {
  const { search = '', statusId = null, ownerId = null, ownerLabel, statusLabel } = opts;
  const sort = opts.sort ?? { key: 'code' as const, dir: 'asc' as const };

  let rows = leads;
  const q = search.trim().toLowerCase();
  if (q) {
    rows = rows.filter((l) =>
      [l.title, fullName(l), l.email, l.company_name].some((v) => (v ?? '').toLowerCase().includes(q)),
    );
  }
  if (statusId) rows = rows.filter((l) => l.stage_id === statusId);
  if (ownerId === UNASSIGNED) rows = rows.filter((l) => !l.owner_user_id);
  else if (ownerId) rows = rows.filter((l) => l.owner_user_id === ownerId);

  const val = (l: LeadLike): string => {
    switch (sort.key) {
      case 'full_name': return fullName(l);
      case 'owner': return ownerLabel ? ownerLabel(l.owner_user_id) : (l.owner_user_id ?? '');
      case 'status': return statusLabel ? statusLabel(l.stage_id) : (l.stage_id ?? '');
      default: return ((l as unknown as Record<string, unknown>)[sort.key] as string | null) ?? '';
    }
  };

  const sorted = [...rows].sort((a, b) =>
    val(a).localeCompare(val(b), undefined, { numeric: true, sensitivity: 'base' }),
  );
  return sort.dir === 'desc' ? sorted.reverse() : sorted;
}
