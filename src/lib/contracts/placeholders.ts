// Contract-template placeholder resolution. Values come from the client card;
// resolution happens once when a contract is created from a template — the
// resolved text is snapshotted onto the contract and stays editable.

export type ClientPlaceholderFields = {
  name: string | null;
  email: string | null;
  phone: string | null;
  vat_number: string | null;
  address: string | null;
  city: string | null;
  postcode: string | null;
  country: string | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
};

export const CONTRACT_PLACEHOLDERS = [
  'client_name',
  'contact_first_name',
  'contact_last_name',
  'contact_full_name',
  'email',
  'phone',
  'vat_number',
  'address',
  'city',
  'postcode',
  'country',
  'date',
] as const;

function formatDateGr(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export function buildPlaceholderData(
  client: ClientPlaceholderFields,
  today: Date = new Date(),
): Record<string, string> {
  const first = client.contact_first_name ?? '';
  const last = client.contact_last_name ?? '';
  return {
    client_name: client.name ?? '',
    contact_first_name: first,
    contact_last_name: last,
    contact_full_name: [first, last].filter(Boolean).join(' '),
    email: client.email ?? '',
    phone: client.phone ?? '',
    vat_number: client.vat_number ?? '',
    address: client.address ?? '',
    city: client.city ?? '',
    postcode: client.postcode ?? '',
    country: client.country ?? '',
    date: formatDateGr(today),
  };
}

export function resolvePlaceholders(body: string, data: Record<string, string>): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => data[key] ?? '');
}
