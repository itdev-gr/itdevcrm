import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { FilterSelect } from '@/components/layout/page-shell';
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
import { EditableContact } from '@/features/contacts/EditableContact';
import { cn } from '@/lib/utils';

const fieldClass =
  'mt-1.5 block w-full rounded-lg border border-input/80 bg-background px-3 py-2 text-sm shadow-sm transition-colors focus:border-[#1a9696]/40 focus:outline-none focus:ring-2 focus:ring-[#1a9696]/20';

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

export function LeadForm({ lead }: { lead: LeadRow }) {
  const { t, i18n } = useTranslation('leads');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const navigate = useNavigate();
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
  const [instagram, setInstagram] = useState(lead.instagram ?? '');
  const [facebook, setFacebook] = useState(lead.facebook ?? '');
  const [tiktok, setTiktok] = useState(lead.tiktok ?? '');
  const [linkedin, setLinkedin] = useState(lead.linkedin ?? '');
  const [paymentMethod, setPaymentMethod] = useState(lead.payment_method ?? '');
  const [scheduledFor, setScheduledFor] = useState<string>(() => {
    if (!lead.scheduled_for) return '';
    const d = new Date(lead.scheduled_for);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [notes, setNotes] = useState(lead.notes ?? '');
  const [additionalNotes, setAdditionalNotes] = useState(lead.additional_notes ?? '');
  const [services, setServices] = useState<PlannedService[]>(
    Array.isArray(lead.services_planned) ? (lead.services_planned as PlannedService[]) : [],
  );

  const oneTimeNum = services.reduce(
    (sum, s) => sum + (Number(s.one_time_amount) || 0) + (Number(s.setup_fee) || 0),
    0,
  );
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
      instagram: instagram.trim() || null,
      facebook: facebook.trim() || null,
      tiktok: tiktok.trim() || null,
      linkedin: linkedin.trim() || null,
      payment_method: paymentMethod || null,
      scheduled_for: scheduledFor ? new Date(scheduledFor).toISOString() : null,
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
      instagram,
      facebook,
      tiktok,
      linkedin,
      paymentMethod,
      scheduledFor,
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
    <div className="space-y-4">
      <fieldset disabled={readOnly} className="space-y-4">
        <Section title={t('form.section_lead_info', { defaultValue: 'Lead info' })}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="notes">{t('form.lead_info')}</Label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('form.lead_info')}
                className={cn(fieldClass, 'min-h-[88px] resize-y')}
              />
            </div>
            <div>
              <Label htmlFor="addl-notes">{t('form.sales_note')}</Label>
              <textarea
                id="addl-notes"
                value={additionalNotes}
                onChange={(e) => setAdditionalNotes(e.target.value)}
                placeholder={t('form.sales_note')}
                className={cn(fieldClass, 'min-h-[88px] resize-y')}
              />
            </div>
          </div>
        </Section>

        <Section title={t('form.section_primary_contact', { defaultValue: 'Primary contact' })}>
          <EditableContact
            value={{ full_name: fullName, email, phone, info: contactInfo }}
            onChange={(c) => {
              setFullName(c.full_name);
              setEmail(c.email);
              setPhone(c.phone);
              setContactInfo(c.info);
            }}
            disabled={!!lead.converted_at}
            startEditing={!fullName && !email && !phone && !contactInfo}
            idPrefix="lead-primary"
          />
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
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="co">{t('form.company_name')}</Label>
              <Input id="co" value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="vat">{t('form.vat_number')}</Label>
              <Input id="vat" value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="ws">{t('form.website')}</Label>
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
              <Label htmlFor="ind">{t('form.industry')}</Label>
              <FilterSelect
                id="ind"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                disabled={readOnly}
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
              <Label htmlFor="cnt">{t('form.country')}</Label>
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
              <Label htmlFor="addr">{t('form.address')}</Label>
              <Input id="addr" value={address} onChange={(e) => setAddress(e.target.value)} className="mt-1.5" />
            </div>
          </div>
        </Section>

        <Section title={t('form.section_social', { defaultValue: 'Social' })}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="ig">Instagram</Label>
              <Input id="ig" value={instagram} onChange={(e) => setInstagram(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="fb">Facebook</Label>
              <Input id="fb" value={facebook} onChange={(e) => setFacebook(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="tt">TikTok</Label>
              <Input id="tt" value={tiktok} onChange={(e) => setTiktok(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="li">LinkedIn</Label>
              <Input id="li" value={linkedin} onChange={(e) => setLinkedin(e.target.value)} className="mt-1.5" />
            </div>
          </div>
        </Section>

        <Section title={t('form.section_sales', { defaultValue: 'Sales' })}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="pm">{t('form.payment_method')}</Label>
              <FilterSelect
                id="pm"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="mt-1.5 w-full"
              >
                <option value="">—</option>
                <option value="cash">{t('form.payment_method_options.cash')}</option>
                <option value="online">{t('form.payment_method_options.online')}</option>
              </FilterSelect>
            </div>
            <div>
              <Label htmlFor="scheduled-for">
                {t('form.scheduled_for', { defaultValue: 'Scheduled for' })}
              </Label>
              <input
                id="scheduled-for"
                type="datetime-local"
                value={scheduledFor}
                onChange={(e) => setScheduledFor(e.target.value)}
                disabled={readOnly}
                className={fieldClass}
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                {t('form.scheduled_for_hint', {
                  defaultValue:
                    'Picking a date moves the lead to Scheduled and adds it to the home calendar.',
                })}
              </p>
            </div>
          </div>
          <div className="mt-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <Label>{t('form.services_planned')}</Label>
              {!readOnly && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => navigate(`/leads/${lead.id}/offers/new`)}
                >
                  Create offer
                </Button>
              )}
            </div>
            <ServicesPlannedField value={services} onChange={setServices} disabled={readOnly} />
          </div>
          <div className="mt-4 overflow-hidden rounded-lg border border-border/60 bg-muted/30">
            <div className="border-b border-border/60 bg-muted/40 px-4 py-2.5">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('totals.title')}
              </div>
            </div>
            <div className="p-4">
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
                      <tr className="text-xs text-muted-foreground">
                        <th className="pb-2 text-left font-normal"></th>
                        <th className="pb-2 text-right font-normal">{t('totals.subtotal')}</th>
                        <th className="pb-2 text-right font-normal">
                          {t('totals.vat')} ({vatPct}%)
                        </th>
                        <th className="pb-2 text-right font-normal">{t('totals.total')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t border-border/40">
                        <td className="py-2 text-muted-foreground">{t('totals.one_time_label')}</td>
                        <td className="py-2 text-right tabular-nums">{formatEur(oneTimeNum)}</td>
                        <td className="py-2 text-right tabular-nums">{formatEur(oneTimeVat)}</td>
                        <td className="py-2 text-right font-medium tabular-nums">{formatEur(oneTimeTotal)}</td>
                      </tr>
                      <tr className="border-t border-border/40">
                        <td className="py-2 text-muted-foreground">{t('totals.monthly_label')}</td>
                        <td className="py-2 text-right tabular-nums">{formatEur(monthlyNum)}</td>
                        <td className="py-2 text-right tabular-nums">{formatEur(monthlyVat)}</td>
                        <td className="py-2 text-right font-medium tabular-nums text-emerald-700 dark:text-emerald-400">
                          {formatEur(monthlyTotal)}
                        </td>
                      </tr>
                      <tr className="border-t border-border/40">
                        <td className="py-2 text-muted-foreground">{t('totals.yearly_label')}</td>
                        <td className="py-2 text-right tabular-nums">{formatEur(yearlyNum)}</td>
                        <td className="py-2 text-right tabular-nums">{formatEur(yearlyVat)}</td>
                        <td className="py-2 text-right font-medium tabular-nums text-emerald-700 dark:text-emerald-400">
                          {formatEur(yearlyTotal)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                );
              })()}
            </div>
          </div>
        </Section>

        <div className="flex h-5 items-center px-1 text-xs text-muted-foreground">
          {autoSaveLabel(saveStatus, lang)}
        </div>
      </fieldset>
    </div>
  );
}
