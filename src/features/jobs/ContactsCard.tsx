import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AddContactDialog } from './AddContactDialog';
import {
  useUpdateClientAdditionalContacts,
  type AdditionalContact,
} from '@/features/clients/hooks/useUpdateClientAdditionalContacts';

type DisplayContact = {
  name: string;
  email?: string | null;
  phone?: string | null;
  info?: string | null;
  /** Index into clients.additional_contacts; null = primary contact (read-only here). */
  additionalIndex: number | null;
};

type Props = {
  client: {
    id?: string;
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
  const [addOpen, setAddOpen] = useState(false);
  const remove = useUpdateClientAdditionalContacts();

  const primaryName = compact(
    [compact(client?.contact_first_name), compact(client?.contact_last_name)].filter(Boolean).join(' '),
  );
  const contacts: DisplayContact[] = [];

  if (primaryName || client?.email || client?.phone || client?.contact_info) {
    contacts.push({
      name: primaryName || '—',
      email: client?.email ?? null,
      phone: client?.phone ?? null,
      info: client?.contact_info ?? null,
      additionalIndex: null,
    });
  }
  (client?.additional_contacts ?? []).forEach((c, idx) => {
    if (!compact(c?.full_name) && !compact(c?.email) && !compact(c?.phone) && !compact(c?.info)) return;
    contacts.push({
      name: compact(c?.full_name) || '—',
      email: c?.email ?? null,
      phone: c?.phone ?? null,
      info: c?.info ?? null,
      additionalIndex: idx,
    });
  });

  const existingAdditional: AdditionalContact[] = (client?.additional_contacts ?? []).map((c) => ({
    full_name: compact(c?.full_name),
    email: compact(c?.email),
    phone: compact(c?.phone),
    info: compact(c?.info),
  }));

  function onRemove(idx: number) {
    if (!client?.id) return;
    if (!confirm('Remove this contact?')) return;
    remove.mutate({
      clientId: client.id,
      contacts: existingAdditional.filter((_, i) => i !== idx),
    });
  }

  return (
    <div className="rounded-md border bg-white">
      <header className="flex items-center justify-between border-b bg-slate-50 px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Contacts ({contacts.length})
        </span>
        {client?.id && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setAddOpen(true)}
            className="h-7 px-2 text-xs"
          >
            + Add contact
          </Button>
        )}
      </header>
      {contacts.length === 0 ? (
        <p className="px-4 py-3 text-sm text-slate-500">No contact info on file.</p>
      ) : (
        <ul className="divide-y">
          {contacts.map((c) => (
            <li
              key={`${c.additionalIndex ?? 'primary'}-${c.name}-${c.email ?? ''}`}
              className="flex items-start gap-2 px-4 py-3 text-sm"
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium text-slate-900">
                  {c.name}
                  {c.additionalIndex === null && (
                    <span className="ml-2 text-[10px] font-normal uppercase tracking-wide text-slate-400">
                      Primary
                    </span>
                  )}
                </div>
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
                {c.info && (
                  <div className="mt-0.5 text-[11px] italic text-slate-500">{c.info}</div>
                )}
              </div>
              {c.additionalIndex !== null && client?.id && (
                <button
                  type="button"
                  onClick={() => onRemove(c.additionalIndex!)}
                  title="Remove contact"
                  aria-label="Remove contact"
                  className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                  disabled={remove.isPending}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {client?.id && (
        <AddContactDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          clientId={client.id}
          existing={existingAdditional}
        />
      )}
    </div>
  );
}
