import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { COUNTRIES, formatEur, vatRateFor } from '@/lib/countries';
import { autoSaveLabel, useAutoSave } from '@/lib/autosave';
import { ServicesPlannedField, type PlannedService } from './ServicesPlannedField';
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

export function DealForm({ initial }: Props) {
  const { t, i18n } = useTranslation('deals');
  const { t: tLeads } = useTranslation('leads');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const qc = useQueryClient();

  const client = initial.client;
  const clientId = initial.client_id ?? client?.id ?? null;

  const [title, setTitle] = useState(initial.title ?? '');
  const [fullName, setFullName] = useState(
    splitName(client?.contact_first_name, client?.contact_last_name),
  );
  const [email, setEmail] = useState(client?.email ?? '');
  const [phone, setPhone] = useState(client?.phone ?? '');
  const [website, setWebsite] = useState(client?.website ?? '');
  const [companyName, setCompanyName] = useState(client?.name ?? '');
  const [vatNumber, setVatNumber] = useState(client?.vat_number ?? '');
  const [country, setCountry] = useState(client?.country ?? '');
  const [industry, setIndustry] = useState(client?.industry ?? '');
  const [address, setAddress] = useState(client?.address ?? '');
  const [paymentMethod, setPaymentMethod] = useState(initial.payment_method ?? '');
  const [services, setServices] = useState<PlannedService[]>(
    Array.isArray(initial.services_planned)
      ? (initial.services_planned as unknown as PlannedService[])
      : [],
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

  const dealPatch = useMemo(
    () => ({
      title: title.trim() || initial.title || '',
      services_planned: services,
      one_time_value: oneTimeNum,
      recurring_monthly_value: monthlyNum,
      payment_method: paymentMethod || null,
    }),
    [title, services, oneTimeNum, monthlyNum, paymentMethod, initial.title],
  );

  const clientPatch = useMemo(() => {
    const { first, last } = joinName(fullName);
    return {
      contact_first_name: first,
      contact_last_name: last,
      email: email.trim() || null,
      phone: phone.trim() || null,
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
        services_planned: next.services_planned as unknown as DealRow['services_planned'],
        one_time_value: next.one_time_value,
        recurring_monthly_value: next.recurring_monthly_value,
        payment_method: next.payment_method,
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
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label htmlFor="title">{t('form.title')}</Label>
          <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
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
          <Label htmlFor="co">{tLeads('form.company_name')}</Label>
          <Input id="co" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="vat">{tLeads('form.vat_number')}</Label>
          <Input id="vat" value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} />
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
          <Label htmlFor="ind">{tLeads('form.industry')}</Label>
          <Input id="ind" value={industry} onChange={(e) => setIndustry(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="addr">{tLeads('form.address')}</Label>
          <Input id="addr" value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
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
        <div className="col-span-2">
          <Label>{tLeads('form.services_planned')}</Label>
          <ServicesPlannedField value={services} onChange={setServices} />
        </div>
        <div className="col-span-2 rounded-md border bg-slate-50 p-3 text-sm">
          <div className="mb-2 text-xs font-medium uppercase text-slate-500">
            {tLeads('totals.title')}
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
                    <th className="text-right font-normal">{tLeads('totals.subtotal')}</th>
                    <th className="text-right font-normal">
                      {tLeads('totals.vat')} ({vatPct}%)
                    </th>
                    <th className="text-right font-normal">{tLeads('totals.total')}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="py-1 text-slate-600">{tLeads('totals.one_time_label')}</td>
                    <td className="py-1 text-right">{formatEur(oneTimeNum)}</td>
                    <td className="py-1 text-right">{formatEur(oneTimeVat)}</td>
                    <td className="py-1 text-right font-medium">{formatEur(oneTimeTotal)}</td>
                  </tr>
                  <tr>
                    <td className="py-1 text-slate-600">{tLeads('totals.monthly_label')}</td>
                    <td className="py-1 text-right">{formatEur(monthlyNum)}</td>
                    <td className="py-1 text-right">{formatEur(monthlyVat)}</td>
                    <td className="py-1 text-right font-medium">{formatEur(monthlyTotal)}</td>
                  </tr>
                  <tr>
                    <td className="py-1 text-slate-600">{tLeads('totals.yearly_label')}</td>
                    <td className="py-1 text-right">{formatEur(yearlyNum)}</td>
                    <td className="py-1 text-right">{formatEur(yearlyVat)}</td>
                    <td className="py-1 text-right font-medium">{formatEur(yearlyTotal)}</td>
                  </tr>
                </tbody>
              </table>
            );
          })()}
        </div>
      </div>
      <div className="flex h-5 items-center text-xs text-slate-500">
        {autoSaveLabel(combinedStatus, lang)}
      </div>
    </div>
  );
}
