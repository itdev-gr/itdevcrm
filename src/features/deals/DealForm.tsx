import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { COUNTRIES } from '@/lib/countries';
import { INDUSTRIES } from '@/lib/industries';
import { autoSaveLabel, useAutoSave } from '@/lib/autosave';
import {
  AdditionalContactsField,
  parseAdditionalContacts,
  type AdditionalContact,
} from '@/features/contacts/AdditionalContactsField';
import { useClient } from '@/features/clients/hooks/useClient';
import type { DealRow } from './hooks/useDeals';

type Props = {
  initial: DealRow;
};

function splitName(first?: string | null, last?: string | null): string {
  return [first, last].filter(Boolean).join(' ');
}

function joinName(full: string): { first: string | null; last: string | null } {
  const trimmed = full.trim();
  if (!trimmed) return { first: null, last: null };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { first: parts[0] ?? null, last: null };
  return { first: parts[0] ?? null, last: parts.slice(1).join(' ') || null };
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
        <div className="h-px flex-1 bg-border" />
      </div>
      {children}
    </section>
  );
}

export function DealForm({ initial }: Props) {
  const { t, i18n } = useTranslation('deals');
  const { t: tLeads } = useTranslation('leads');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const qc = useQueryClient();

  const client = initial.client;
  const clientId = initial.client_id ?? client?.id ?? null;

  // Pull the full client row (the embedded `client` only carries some columns)
  // so contact_info + additional_contacts are available to seed the form.
  const { data: fullClient } = useClient(clientId ?? '');

  const [title, setTitle] = useState(initial.title ?? '');
  const [fullName, setFullName] = useState(
    splitName(client?.contact_first_name, client?.contact_last_name),
  );
  const [email, setEmail] = useState(client?.email ?? '');
  const [phone, setPhone] = useState(client?.phone ?? '');
  const [contactInfo, setContactInfo] = useState<string>('');
  const [additionalContacts, setAdditionalContacts] = useState<AdditionalContact[]>([]);
  const [website, setWebsite] = useState(client?.website ?? '');
  const [companyName, setCompanyName] = useState(client?.name ?? '');
  const [vatNumber, setVatNumber] = useState(client?.vat_number ?? '');
  const [country, setCountry] = useState(client?.country ?? '');
  const [industry, setIndustry] = useState(client?.industry ?? '');
  const [address, setAddress] = useState(client?.address ?? '');
  const [paymentMethod, setPaymentMethod] = useState(initial.payment_method ?? '');
  const [tempDealAmount, setTempDealAmount] = useState(initial.temp_deal_amount ?? '');

  // When the full client loads, hydrate the contact-info + additional-contacts
  // fields. Use a one-shot ref-style sentinel so subsequent realtime refreshes
  // don't clobber edits in progress.
  const seededRef = useState<{ done: boolean }>({ done: false })[0];
   
  if (fullClient && !seededRef.done) {
    // eslint-disable-next-line react-hooks/immutability -- one-shot seeding sentinel; ref-style pattern via useState
    seededRef.done = true;
    setContactInfo((fullClient as unknown as { contact_info?: string | null }).contact_info ?? '');
    setAdditionalContacts(
      parseAdditionalContacts(
        (fullClient as unknown as { additional_contacts?: unknown }).additional_contacts,
      ),
    );
  }

  const dealPatch = useMemo(
    () => ({
      title: title.trim() || initial.title || '',
      payment_method: paymentMethod || null,
      temp_deal_amount: tempDealAmount.trim() || null,
    }),
    [title, paymentMethod, tempDealAmount, initial.title],
  );

  const clientPatch = useMemo(() => {
    const { first, last } = joinName(fullName);
    return {
      contact_first_name: first,
      contact_last_name: last,
      email: email.trim() || null,
      phone: phone.trim() || null,
      contact_info: contactInfo.trim() || null,
      additional_contacts: additionalContacts,
      website: website.trim() || null,
      name: companyName.trim() || client?.name || '',
      vat_number: vatNumber.trim() || null,
      country: country.trim() || null,
      industry: industry.trim() || null,
      address: address.trim() || null,
    };
  }, [
    fullName,
    email,
    phone,
    contactInfo,
    additionalContacts,
    website,
    companyName,
    vatNumber,
    country,
    industry,
    address,
    client?.name,
  ]);

  const dealStatus = useAutoSave(dealPatch, async (next) => {
    const { error } = await supabase
      .from('deals')
      .update({
        title: next.title,
        payment_method: next.payment_method,
        temp_deal_amount: next.temp_deal_amount,
      })
      .eq('id', initial.id);
    if (error) throw new Error(error.message);
    void qc.invalidateQueries({ queryKey: queryKeys.deal(initial.id) });
    void qc.invalidateQueries({ queryKey: queryKeys.deals() });
    void qc.invalidateQueries({ queryKey: queryKeys.accountingDeals() });
  });

  const clientStatus = useAutoSave(
    clientPatch,
    async (next) => {
      if (!clientId) return;
      const { error } = await supabase.from('clients').update(next).eq('id', clientId);
      if (error) throw new Error(error.message);
      void qc.invalidateQueries({ queryKey: queryKeys.deal(initial.id) });
      void qc.invalidateQueries({ queryKey: queryKeys.deals() });
      void qc.invalidateQueries({ queryKey: queryKeys.accountingDeals() });
      void qc.invalidateQueries({ queryKey: queryKeys.client(clientId) });
      void qc.invalidateQueries({ queryKey: queryKeys.clients() });
    },
    { enabled: !!clientId },
  );

  const combinedStatus =
    dealStatus === 'error' || clientStatus === 'error'
      ? 'error'
      : dealStatus === 'saving' || clientStatus === 'saving'
        ? 'saving'
        : dealStatus === 'saved' || clientStatus === 'saved'
          ? 'saved'
          : 'idle';

  return (
    <div className="space-y-6">
      <Section title={t('form.section_deal', { defaultValue: 'Deal' })}>
        <div>
          <Label htmlFor="title">{t('form.title')}</Label>
          <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
      </Section>

      <Section title={tLeads('form.section_primary_contact', { defaultValue: 'Primary contact' })}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="fn">{tLeads('form.full_name')}</Label>
            <Input id="fn" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="email">{tLeads('form.email')}</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="phone">{tLeads('form.phone')}</Label>
            <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="contact-info">
              {tLeads('form.contact_info', { defaultValue: 'Info' })}
            </Label>
            <Input
              id="contact-info"
              value={contactInfo}
              onChange={(e) => setContactInfo(e.target.value)}
              placeholder="e.g. CEO · prefers WhatsApp"
            />
          </div>
        </div>
      </Section>

      <Section
        title={tLeads('form.section_additional_contacts', { defaultValue: 'Additional contacts' })}
      >
        <AdditionalContactsField
          value={additionalContacts}
          onChange={setAdditionalContacts}
        />
      </Section>

      <Section title={tLeads('form.section_company', { defaultValue: 'Company' })}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="co">{tLeads('form.company_name')}</Label>
            <Input id="co" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="vat">{tLeads('form.vat_number')}</Label>
            <Input id="vat" value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ws">{tLeads('form.website')}</Label>
            <Input
              id="ws"
              type="url"
              placeholder="https://"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="ind">{tLeads('form.industry')}</Label>
            <select
              id="ind"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">—</option>
              {INDUSTRIES.map((ind) => (
                <option key={ind.code} value={ind.code}>
                  {ind.labels[lang]}
                </option>
              ))}
              {industry && !INDUSTRIES.some((i) => i.code === industry) && (
                <option value={industry}>{industry} (legacy)</option>
              )}
            </select>
          </div>
          <div>
            <Label htmlFor="cnt">{tLeads('form.country')}</Label>
            <select
              id="cnt"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">—</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.storedValue}>
                  {c.storedValue} ({Math.round(c.vatRate * 100)}% VAT)
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="addr">{tLeads('form.address')}</Label>
            <Input id="addr" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
        </div>
      </Section>

      <Section title={tLeads('form.section_sales', { defaultValue: 'Sales' })}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="pm">{tLeads('form.payment_method')}</Label>
            <select
              id="pm"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">—</option>
              <option value="cash">{tLeads('form.payment_method_options.cash')}</option>
              <option value="online">{tLeads('form.payment_method_options.online')}</option>
            </select>
          </div>
          <div>
            <Label htmlFor="temp-deal-amount">{t('form.temp_deal_amount')}</Label>
            <Input
              id="temp-deal-amount"
              value={tempDealAmount}
              onChange={(e) => setTempDealAmount(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">{t('form.temp_deal_amount_hint')}</p>
          </div>
        </div>
      </Section>

      <div className="flex h-5 items-center text-xs text-muted-foreground">
        {autoSaveLabel(combinedStatus, lang)}
      </div>
    </div>
  );
}
