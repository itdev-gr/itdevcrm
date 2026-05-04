import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ServicesPlannedField, type PlannedService } from '@/features/deals/ServicesPlannedField';
import {
  AdditionalContactsField,
  parseAdditionalContacts,
  type AdditionalContact,
} from '@/features/contacts/AdditionalContactsField';
import { useUpdateLead } from './hooks/useUpdateLead';
import type { LeadRow } from './hooks/useLeads';
import { COUNTRIES, formatEur, vatRateFor } from '@/lib/countries';
import { INDUSTRIES } from '@/lib/industries';
import { autoSaveLabel, useAutoSave } from '@/lib/autosave';

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
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
        <div className="h-px flex-1 bg-slate-200" />
      </div>
      {children}
    </section>
  );
}

export function LeadForm({ lead }: { lead: LeadRow }) {
  const { t, i18n } = useTranslation('leads');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const update = useUpdateLead();
  const readOnly = !!lead.converted_at;

  const [fullName, setFullName] = useState(
    [lead.contact_first_name, lead.contact_last_name].filter(Boolean).join(' '),
  );
  const [email, setEmail] = useState(lead.email ?? '');
  const [phone, setPhone] = useState(lead.phone ?? '');
  const [contactInfo, setContactInfo] = useState(lead.contact_info ?? '');
  const [additionalContacts, setAdditionalContacts] = useState<AdditionalContact[]>(
    parseAdditionalContacts(lead.additional_contacts),
  );
  const [website, setWebsite] = useState(lead.website ?? '');
  const [companyName, setCompanyName] = useState(lead.company_name ?? '');
  const [industry, setIndustry] = useState(lead.industry ?? '');
  const [country, setCountry] = useState(lead.country ?? '');
  const [address, setAddress] = useState(lead.address ?? '');
  const [vatNumber, setVatNumber] = useState(lead.vat_number ?? '');
  const [paymentMethod, setPaymentMethod] = useState(lead.payment_method ?? '');
  const [notes, setNotes] = useState(lead.notes ?? '');
  const [additionalNotes, setAdditionalNotes] = useState(lead.additional_notes ?? '');
  const [services, setServices] = useState<PlannedService[]>(
    Array.isArray(lead.services_planned) ? (lead.services_planned as PlannedService[]) : [],
  );

  const oneTimeNum = services.reduce((sum, s) => sum + (Number(s.one_time_amount) || 0), 0);
  const monthlyNum = services.reduce(
    (sum, s) => sum + (s.billing_type === 'recurring_monthly' ? Number(s.monthly_amount) || 0 : 0),
    0,
  );
  const yearlyNum = services.reduce(
    (sum, s) => sum + (s.billing_type === 'recurring_yearly' ? Number(s.monthly_amount) || 0 : 0),
    0,
  );

  const patch = useMemo(
    () => ({
      contact_first_name: fullName.trim() || null,
      contact_last_name: null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      contact_info: contactInfo.trim() || null,
      additional_contacts: additionalContacts,
      website: website.trim() || null,
      company_name: companyName.trim() || null,
      industry: industry.trim() || null,
      country: country.trim() || null,
      address: address.trim() || null,
      vat_number: vatNumber.trim() || null,
      payment_method: paymentMethod || null,
      notes: notes.trim() || null,
      additional_notes: additionalNotes.trim() || null,
      estimated_one_time_value: oneTimeNum,
      estimated_monthly_value: monthlyNum,
      services_planned: services,
    }),
    [
      fullName,
      email,
      phone,
      contactInfo,
      additionalContacts,
      website,
      companyName,
      industry,
      country,
      address,
      vatNumber,
      paymentMethod,
      notes,
      additionalNotes,
      oneTimeNum,
      monthlyNum,
      services,
    ],
  );

  const saveStatus = useAutoSave(
    patch,
    async (next) => {
      await update.mutateAsync({
        id: lead.id,
        patch: {
          ...next,
          services_planned: next.services_planned as unknown as LeadRow['services_planned'],
          additional_contacts:
            next.additional_contacts as unknown as LeadRow['additional_contacts'],
        },
      });
    },
    { enabled: !readOnly },
  );

  return (
    <div className="space-y-6">
      <fieldset disabled={readOnly} className="space-y-6">
        <Section title={t('form.section_lead_info', { defaultValue: 'Lead info' })}>
          <div>
            <Label htmlFor="notes">{t('form.lead_info')}</Label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 block min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <Label htmlFor="addl-notes">{t('form.notes')}</Label>
            <textarea
              id="addl-notes"
              value={additionalNotes}
              onChange={(e) => setAdditionalNotes(e.target.value)}
              className="mt-1 block min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
        </Section>

        <Section title={t('form.section_primary_contact', { defaultValue: 'Primary contact' })}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="fn">{t('form.full_name')}</Label>
              <Input id="fn" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="email">{t('form.email')}</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="phone">{t('form.phone')}</Label>
              <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="contact-info">
                {t('form.contact_info', { defaultValue: 'Info' })}
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
          title={t('form.section_additional_contacts', { defaultValue: 'Additional contacts' })}
        >
          <AdditionalContactsField
            value={additionalContacts}
            onChange={setAdditionalContacts}
            disabled={readOnly}
          />
        </Section>

        <Section title={t('form.section_company', { defaultValue: 'Company' })}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="co">{t('form.company_name')}</Label>
              <Input id="co" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="vat">{t('form.vat_number')}</Label>
              <Input id="vat" value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ws">{t('form.website')}</Label>
              <Input
                id="ws"
                type="url"
                placeholder="https://"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="ind">{t('form.industry')}</Label>
              <select
                id="ind"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                disabled={readOnly}
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
              <Label htmlFor="cnt">{t('form.country')}</Label>
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
              <Label htmlFor="addr">{t('form.address')}</Label>
              <Input id="addr" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
          </div>
        </Section>

        <Section title={t('form.section_sales', { defaultValue: 'Sales' })}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pm">{t('form.payment_method')}</Label>
              <select
                id="pm"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">—</option>
                <option value="cash">{t('form.payment_method_options.cash')}</option>
                <option value="online">{t('form.payment_method_options.online')}</option>
              </select>
            </div>
          </div>
          <div>
            <Label>{t('form.services_planned')}</Label>
            <ServicesPlannedField value={services} onChange={setServices} disabled={readOnly} />
          </div>
          <div className="rounded-md border bg-slate-50 p-3 text-sm">
            <div className="mb-2 text-xs font-medium uppercase text-slate-500">
              {t('totals.title')}
            </div>
            {(() => {
              const vatRate = vatRateFor(country);
              const oneTimeVat = oneTimeNum * vatRate;
              const monthlyVat = monthlyNum * vatRate;
              const yearlyVat = yearlyNum * vatRate;
              const oneTimeTotal = oneTimeNum + oneTimeVat;
              const monthlyTotal = monthlyNum + monthlyVat;
              const yearlyTotal = yearlyNum + yearlyVat;
              const vatPct = Math.round(vatRate * 100);
              return (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500">
                      <th className="text-left font-normal"></th>
                      <th className="text-right font-normal">{t('totals.subtotal')}</th>
                      <th className="text-right font-normal">
                        {t('totals.vat')} ({vatPct}%)
                      </th>
                      <th className="text-right font-normal">{t('totals.total')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="py-1 text-slate-600">{t('totals.one_time_label')}</td>
                      <td className="py-1 text-right">{formatEur(oneTimeNum)}</td>
                      <td className="py-1 text-right">{formatEur(oneTimeVat)}</td>
                      <td className="py-1 text-right font-medium">{formatEur(oneTimeTotal)}</td>
                    </tr>
                    <tr>
                      <td className="py-1 text-slate-600">{t('totals.monthly_label')}</td>
                      <td className="py-1 text-right">{formatEur(monthlyNum)}</td>
                      <td className="py-1 text-right">{formatEur(monthlyVat)}</td>
                      <td className="py-1 text-right font-medium">{formatEur(monthlyTotal)}</td>
                    </tr>
                    <tr>
                      <td className="py-1 text-slate-600">{t('totals.yearly_label')}</td>
                      <td className="py-1 text-right">{formatEur(yearlyNum)}</td>
                      <td className="py-1 text-right">{formatEur(yearlyVat)}</td>
                      <td className="py-1 text-right font-medium">{formatEur(yearlyTotal)}</td>
                    </tr>
                  </tbody>
                </table>
              );
            })()}
          </div>
        </Section>

        <div className="flex h-5 items-center text-xs text-slate-500">
          {autoSaveLabel(saveStatus, lang)}
        </div>
      </fieldset>
    </div>
  );
}
