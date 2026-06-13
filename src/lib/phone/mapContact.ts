// Shape returned by the find_contact_by_phone RPC.
export type ContactRow = {
  id: string;
  name: string | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
  email: string | null;
  phone: string | null;
  source: 'client' | 'lead';
};

// Exact envelope Yeastar's PBX expects back on a caller-ID lookup.
export type YeastarContact = {
  contact: {
    id: string;
    firstname: string;
    lastname: string;
    company: string;
    email: string;
    businessphone: string;
    mobilephone: string;
    url: string;
  };
};

export function toYeastarContact(row: ContactRow, appBase: string): YeastarContact {
  const base = appBase.replace(/\/+$/, '');
  const path = row.source === 'client' ? 'clients' : 'leads';
  return {
    contact: {
      id: row.id,
      firstname: row.contact_first_name ?? '',
      lastname: row.contact_last_name ?? '',
      company: row.name ?? '',
      email: row.email ?? '',
      businessphone: row.phone ?? '',
      mobilephone: '',
      url: `${base}/${path}/${row.id}`,
    },
  };
}
