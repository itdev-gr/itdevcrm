import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ServicesPlannedField, type PlannedService } from '@/features/deals/ServicesPlannedField';
import { useUpdateLead } from './hooks/useUpdateLead';
import type { LeadRow } from './hooks/useLeads';
import { COUNTRIES, formatEur, vatRateFor } from '@/lib/countries';

export function LeadForm({ lead }: { lead: LeadRow }) {
  const { t } = useTranslation('leads');
  const update = useUpdateLead();
  const readOnly = !!lead.converted_at;

  const [fullName, setFullName] = useState(
    [lead.contact_first_name, lead.contact_last_name].filter(Boolean).join(' '),
  );
  const [email, setEmail] = useState(lead.email ?? '');
  const [phone, setPhone] = useState(lead.phone ?? '');
  const [website, setWebsite] = useState(lead.website ?? '');
  const [companyName, setCompanyName] = useState(lead.company_name ?? '');
  const [industry, setIndustry] = useState(lead.industry ?? '');
  const [country, setCountry] = useState(lead.country ?? '');
  const [address, setAddress] = useState(lead.address ?? '');
  const [vatNumber, setVatNumber] = useState(lead.vat_number ?? '');
  const [notes, setNotes] = useState(lead.notes ?? '');
  const [services, setServices] = useState<PlannedService[]>(
    Array.isArray(lead.services_planned) ? (lead.services_planned as PlannedService[]) : [],
  );

  // Totals are derived from services_planned now — no manual inputs.
  const oneTimeNum = services.reduce((sum, s) => sum + (Number(s.one_time_amount) || 0), 0);
  const monthlyNum = services.reduce((sum, s) => sum + (Number(s.monthly_amount) || 0), 0);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await update.mutateAsync({
        id: lead.id,
        patch: {
          contact_first_name: fullName.trim() || null,
          contact_last_name: null,
          email: email.trim() || null,
          phone: phone.trim() || null,
          website: website.trim() || null,
          company_name: companyName.trim() || null,
          industry: industry.trim() || null,
          country: country.trim() || null,
          address: address.trim() || null,
          vat_number: vatNumber.trim() || null,
          notes: notes.trim() || null,
          estimated_one_time_value: oneTimeNum,
          estimated_monthly_value: monthlyNum,
          services_planned: services as unknown as LeadRow['services_planned'],
        },
      });
    } catch (err) {
      alert((err as Error).message);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <fieldset disabled={readOnly} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label htmlFor="notes">{t('form.lead_info')}</Label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 block min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="col-span-2">
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
          <div className="col-span-2">
            <Label htmlFor="ws">{t('form.website')}</Label>
            <Input
              id="ws"
              type="url"
              placeholder="https://"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </div>
          <div className="col-span-2">
            <Label htmlFor="co">{t('form.company_name')}</Label>
            <Input id="co" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ind">{t('form.industry')}</Label>
            <Input id="ind" value={industry} onChange={(e) => setIndustry(e.target.value)} />
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
          <div className="col-span-2">
            <Label htmlFor="addr">{t('form.address')}</Label>
            <Input id="addr" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label htmlFor="vat">{t('form.vat_number')}</Label>
            <Input id="vat" value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label>{t('form.services_planned')}</Label>
            <ServicesPlannedField value={services} onChange={setServices} disabled={readOnly} />
          </div>
          <div className="col-span-2 rounded-md border bg-slate-50 p-3 text-sm">
            <div className="mb-2 text-xs font-medium uppercase text-slate-500">
              {t('totals.title')}
            </div>
            {(() => {
              const vatRate = vatRateFor(country);
              const oneTimeVat = oneTimeNum * vatRate;
              const monthlyVat = monthlyNum * vatRate;
              const oneTimeTotal = oneTimeNum + oneTimeVat;
              const monthlyTotal = monthlyNum + monthlyVat;
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
                  </tbody>
                </table>
              );
            })()}
          </div>
        </div>
        <Button type="submit" disabled={update.isPending}>
          {t('actions.save')}
        </Button>
      </fieldset>
    </form>
  );
}
