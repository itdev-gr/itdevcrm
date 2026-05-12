type Contact = {
  name: string;
  email?: string | null;
  phone?: string | null;
  info?: string | null;
};

type Props = {
  client: {
    contact_first_name?: string | null;
    contact_last_name?: string | null;
    email?: string | null;
    phone?: string | null;
    contact_info?: string | null;
    additional_contacts?:
      | { full_name?: string | null; email?: string | null; phone?: string | null; info?: string | null }[]
      | null;
  } | null;
};

function compact(value: string | null | undefined): string {
  return (value ?? '').trim();
}

export function ContactsCard({ client }: Props) {
  const primaryName = compact(
    [compact(client?.contact_first_name), compact(client?.contact_last_name)].filter(Boolean).join(' '),
  );
  const contacts: Contact[] = [];

  if (primaryName || client?.email || client?.phone || client?.contact_info) {
    contacts.push({
      name: primaryName || '—',
      email: client?.email ?? null,
      phone: client?.phone ?? null,
      info: client?.contact_info ?? null,
    });
  }
  for (const c of client?.additional_contacts ?? []) {
    if (!compact(c?.full_name) && !compact(c?.email) && !compact(c?.phone) && !compact(c?.info)) continue;
    contacts.push({
      name: compact(c?.full_name) || '—',
      email: c?.email ?? null,
      phone: c?.phone ?? null,
      info: c?.info ?? null,
    });
  }

  if (contacts.length === 0) {
    return (
      <div className="rounded-md border bg-slate-50 px-4 py-3 text-sm text-slate-500">
        No contact info on file.
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-white">
      <header className="border-b bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
        Contacts ({contacts.length})
      </header>
      <ul className="divide-y">
        {contacts.map((c, i) => (
          <li key={`${c.name}-${c.email ?? ''}-${i}`} className="px-4 py-3 text-sm">
            <div className="font-medium text-slate-900">{c.name}</div>
            {(c.email || c.phone) && (
              <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-600">
                {c.email && (
                  <a href={`mailto:${c.email}`} className="text-blue-700 hover:underline">
                    {c.email}
                  </a>
                )}
                {c.phone && (
                  <a href={`tel:${c.phone}`} className="text-blue-700 hover:underline">
                    {c.phone}
                  </a>
                )}
              </div>
            )}
            {c.info && <div className="mt-0.5 text-[11px] italic text-slate-500">{c.info}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}
