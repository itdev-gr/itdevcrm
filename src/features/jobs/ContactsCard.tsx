import { useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { autoSaveLabel, useAutoSave } from '@/lib/autosave';
import {
  AdditionalContactsField,
  parseAdditionalContacts,
  type AdditionalContact,
} from '@/features/contacts/AdditionalContactsField';
import { EditableContact } from '@/features/contacts/EditableContact';

type ClientShape = {
  id?: string;
  contact_first_name?: string | null;
  contact_last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  contact_info?: string | null;
  additional_contacts?:
    | { full_name?: string | null; email?: string | null; phone?: string | null; info?: string | null }[]
    | null;
};

type Props = { client: ClientShape | null };

function joinName(first: string | null | undefined, last: string | null | undefined): string {
  return [first ?? '', last ?? ''].filter((s) => s.trim().length > 0).join(' ');
}

function splitName(full: string): { first: string | null; last: string | null } {
  const trimmed = full.trim();
  if (!trimmed) return { first: null, last: null };
  const parts = trimmed.split(/\s+/);
  const first = parts[0] ?? null;
  const last = parts.length > 1 ? parts.slice(1).join(' ') : null;
  return { first, last };
}

export function ContactsCard({ client }: Props) {
  if (!client?.id) {
    return (
      <div className="rounded-md border bg-slate-50 px-4 py-3 text-sm text-slate-500">
        No client linked.
      </div>
    );
  }
  return <ContactsForm key={client.id} client={client} clientId={client.id} />;
}

function ContactsForm({ client, clientId }: { client: ClientShape; clientId: string }) {
  const [fullName, setFullName] = useState<string>(
    joinName(client.contact_first_name, client.contact_last_name),
  );
  const [email, setEmail] = useState<string>(client.email ?? '');
  const [phone, setPhone] = useState<string>(client.phone ?? '');
  const [contactInfo, setContactInfo] = useState<string>(client.contact_info ?? '');
  const [additional, setAdditional] = useState<AdditionalContact[]>(
    parseAdditionalContacts(client.additional_contacts ?? []),
  );

  const patch = useMemo(() => {
    const { first, last } = splitName(fullName);
    return {
      contact_first_name: first,
      contact_last_name: last,
      email: email.trim() || null,
      phone: phone.trim() || null,
      contact_info: contactInfo.trim() || null,
      additional_contacts: additional,
    };
  }, [fullName, email, phone, contactInfo, additional]);

  const status = useAutoSave(patch, async (next) => {
    const { error } = await supabase.from('clients').update(next).eq('id', clientId);
    if (error) throw new Error(error.message);
  });

  return (
    <div className="rounded-md border bg-white">
      <header className="flex items-center justify-between border-b bg-slate-50 px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Contacts
        </span>
        <span className="text-[11px] text-slate-500">{autoSaveLabel(status)}</span>
      </header>

      <div className="space-y-4 p-4">
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Primary contact
          </h3>
          <EditableContact
            value={{ full_name: fullName, email, phone, info: contactInfo }}
            onChange={(c) => {
              setFullName(c.full_name);
              setEmail(c.email);
              setPhone(c.phone);
              setContactInfo(c.info);
            }}
            startEditing={!fullName && !email && !phone && !contactInfo}
            idPrefix="cc-primary"
          />
        </section>

        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Additional contacts
          </h3>
          <AdditionalContactsField value={additional} onChange={setAdditional} />
        </section>
      </div>
    </div>
  );
}
