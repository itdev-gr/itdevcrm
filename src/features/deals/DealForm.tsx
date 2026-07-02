import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FilterSelect } from '@/components/layout/page-shell';
import { EditableContact } from '@/features/contacts/EditableContact';
import {
  AdditionalContactsField,
  parseAdditionalContacts,
  type AdditionalContact,
} from '@/features/contacts/AdditionalContactsField';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { COUNTRIES } from '@/lib/countries';
import { INDUSTRIES } from '@/lib/industries';
import { autoSaveLabel, useAutoSave } from '@/lib/autosave';
import { cn } from '@/lib/utils';
import { useClient } from '@/features/clients/hooks/useClient';
import type { DealRow } from './hooks/useDeals';

type Props = {
  initial: DealRow;
};

function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-xl border border-border/60 bg-card p-5 shadow-sm', className)}>
      <h2 className="mb-4 text-sm font-semibold tracking-tight text-foreground">{title}</h2>
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
  const { data: fullClient } = useClient(clientId ?? '');

  const [title, setTitle] = useState(initial.title ?? '');
  const [fullName, setFullName] = useState(
    [client?.contact_first_name, client?.contact_last_name].filter(Boolean).join(' '),
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
  const [cashChargeVat, setCashChargeVat] = useState<boolean>(initial.cash_charge_vat ?? false);
  const [tempDealAmount, setTempDealAmount] = useState(initial.temp_deal_amount ?? '');

  const seededRef = useRef(false);

  useEffect(() => {
    if (seededRef.current || !fullClient) return;
    seededRef.current = true;
    setContactInfo((fullClient as unknown as { contact_info?: string | null }).contact_info ?? '');
    setAdditionalContacts(
      parseAdditionalContacts(
        (fullClient as unknown as { additional_contacts?: unknown }).additional_contacts,
      ),
    );
  }, [fullClient]);

  const dealPatch = useMemo(
    () => ({
      title: title.trim() || initial.title || '',
      payment_method: paymentMethod || null,
      cash_charge_vat: paymentMethod === 'cash' ? cashChargeVat : false,
      temp_deal_amount: tempDealAmount.trim() || null,
    }),
    [title, paymentMethod, cashChargeVat, tempDealAmount, initial.title],
  );

  const clientPatch = useMemo(() => {
    const trimmed = fullName.trim();
    const parts = trimmed ? trimmed.split(/\s+/) : [];
    const first = parts[0] ?? null;
    const last = parts.length > 1 ? parts.slice(1).join(' ') || null : null;
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
        cash_charge_vat: next.cash_charge_vat,
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
    <div className="space-y-4">
      <Section title={t('form.section_deal', { defaultValue: 'Deal' })}>
        <div>
          <Label htmlFor="title">{t('form.title')}</Label>
          <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1.5" />
        </div>
      </Section>

      <Section title={tLeads('form.section_primary_contact', { defaultValue: 'Primary contact' })}>
        <EditableContact
          value={{ full_name: fullName, email, phone, info: contactInfo }}
          onChange={(c) => {
            setFullName(c.full_name);
            setEmail(c.email);
            setPhone(c.phone);
            setContactInfo(c.info);
          }}
          idPrefix="deal-primary"
        />
      </Section>

      <Section
        title={tLeads('form.section_additional_contacts', { defaultValue: 'Additional contacts' })}
      >
        <AdditionalContactsField value={additionalContacts} onChange={setAdditionalContacts} />
      </Section>

      <Section title={tLeads('form.section_company', { defaultValue: 'Company' })}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="co">{tLeads('form.company_name')}</Label>
            <Input id="co" value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label htmlFor="vat">{tLeads('form.vat_number')}</Label>
            <Input id="vat" value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label htmlFor="ws">{tLeads('form.website')}</Label>
            <Input
              id="ws"
              type="url"
              placeholder="https://"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="ind">{tLeads('form.industry')}</Label>
            <FilterSelect
              id="ind"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              className="mt-1.5 w-full"
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
            </FilterSelect>
          </div>
          <div>
            <Label htmlFor="cnt">{tLeads('form.country')}</Label>
            <FilterSelect
              id="cnt"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="mt-1.5 w-full"
            >
              <option value="">—</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.storedValue}>
                  {c.storedValue} ({Math.round(c.vatRate * 100)}% VAT)
                </option>
              ))}
            </FilterSelect>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="addr">{tLeads('form.address')}</Label>
            <Input id="addr" value={address} onChange={(e) => setAddress(e.target.value)} className="mt-1.5" />
          </div>
        </div>
      </Section>

      <Section title={tLeads('form.section_sales', { defaultValue: 'Sales' })}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="pm">{tLeads('form.payment_method')}</Label>
            <FilterSelect
              id="pm"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="mt-1.5 w-full"
            >
              <option value="">—</option>
              <option value="cash">{tLeads('form.payment_method_options.cash')}</option>
              <option value="online">{tLeads('form.payment_method_options.online')}</option>
            </FilterSelect>
            {paymentMethod === 'cash' && (
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={cashChargeVat}
                  onChange={(e) => setCashChargeVat(e.target.checked)}
                />
                {tLeads('form.cash_charge_vat', { defaultValue: 'Χρέωση ΦΠΑ (μετρητά)' })}
              </label>
            )}
          </div>
          <div>
            <Label htmlFor="temp-deal-amount">{t('form.temp_deal_amount')}</Label>
            <Input
              id="temp-deal-amount"
              value={tempDealAmount}
              onChange={(e) => setTempDealAmount(e.target.value)}
              className="mt-1.5"
            />
            <p className="mt-1.5 text-xs text-muted-foreground">{t('form.temp_deal_amount_hint')}</p>
          </div>
        </div>
      </Section>

      <div className="flex h-5 items-center px-1 text-xs text-muted-foreground">
        {autoSaveLabel(combinedStatus, lang)}
      </div>
    </div>
  );
}
