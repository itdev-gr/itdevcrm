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
      <div className="rounded-md border bg-muted px-4 py-3 text-sm text-muted-foreground">
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
    // Contact-fields-only RPC: a direct clients UPDATE is RLS-gated on
    // clients:edit (accounting/admin only) and fails with 0 rows and NO error
    // for everyone else — the autosave used to report success while nothing
    // was saved. The RPC allows any clients:view holder and raises on failure.
    // Omitted args fall back to the RPC's `default null`, which clears the
    // column — exactly what an erased field means (exactOptionalPropertyTypes
    // forbids passing explicit undefined).
    const { error } = await supabase.rpc('update_client_contacts', {
      p_client_id: clientId,
      ...(next.contact_first_name != null && { p_first: next.contact_first_name }),
      ...(next.contact_last_name != null && { p_last: next.contact_last_name }),
      ...(next.email != null && { p_email: next.email }),
      ...(next.phone != null && { p_phone: next.phone }),
      ...(next.contact_info != null && { p_info: next.contact_info }),
      p_additional: next.additional_contacts as unknown as never,
    });
    if (error) throw new Error(error.message);
  });

  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-sm">
      <header className="flex items-center justify-between border-b border-border/60 bg-muted/30 px-4 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Contacts
        </span>
        <span className="text-[11px] text-muted-foreground">{autoSaveLabel(status)}</span>
      </header>

      <div className="space-y-4 p-4">
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
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
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Additional contacts
          </h3>
          <AdditionalContactsField value={additional} onChange={setAdditional} />
        </section>
      </div>
    </div>
  );
}
