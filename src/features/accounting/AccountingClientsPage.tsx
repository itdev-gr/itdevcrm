import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAccountingClients, type AccountingClientRow } from './hooks/useAccountingClients';
import { CopyableCode } from '@/components/CopyableCode';
import { formatDate } from '@/lib/datetime';
import { industryLabel } from '@/lib/industries';
import { CallLink } from '@/components/CallLink';

function isBlocked(c: AccountingClientRow): boolean {
  return (c.client_blocks ?? []).some((b) => b.unblocked_at == null);
}

function activeJobs(c: AccountingClientRow) {
  return (c.jobs ?? []).filter((j) => !j.archived && j.status === 'active');
}

function monthlyRevenue(c: AccountingClientRow): number {
  return activeJobs(c)
    .filter((j) => j.billing_type === 'recurring_monthly')
    .reduce((sum, j) => sum + (Number(j.monthly_amount) || 0), 0);
}

function yearlyRevenue(c: AccountingClientRow): number {
  return activeJobs(c)
    .filter((j) => j.billing_type === 'recurring_yearly')
    .reduce((sum, j) => sum + (Number(j.monthly_amount) || 0), 0);
}

export function AccountingClientsPage() {
  const { t, i18n } = useTranslation('accounting');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const { data: clients = [], isLoading } = useAccountingClients();
  const [search, setSearch] = useState('');
  const [blockedOnly, setBlockedOnly] = useState(false);

  const q = search.trim().toLowerCase();
  const visible = clients.filter((c) => {
    if (blockedOnly && !isBlocked(c)) return false;
    if (!q) return true;
    const haystack = [
      c.code,
      c.name,
      c.contact_first_name,
      c.contact_last_name,
      c.email,
      c.phone,
      c.industry,
      industryLabel(c.industry, lang),
      c.country,
      c.vat_number,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-6">
      <div className="-mx-6 -mt-6 flex flex-wrap items-center justify-between gap-3 border-b bg-white/95 px-6 py-3">
        <h1 className="text-2xl font-bold">{t('clients_page.title')}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('clients_page.search')}
            className="w-56 rounded-md border border-input bg-background px-2 py-1 text-sm"
          />
          <label className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={blockedOnly}
              onChange={(e) => setBlockedOnly(e.target.checked)}
            />
            {t('clients_page.show_blocked_only')}
          </label>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border">
        {isLoading ? (
          <div className="p-8 text-sm text-slate-500">…</div>
        ) : visible.length === 0 ? (
          <div className="p-8 text-sm text-slate-500">{t('clients_page.empty')}</div>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr className="border-b text-left">
                <th className="px-3 py-2 font-medium">{t('clients_page.table.code')}</th>
                <th className="px-3 py-2 font-medium">{t('clients_page.table.start_date')}</th>
                <th className="px-3 py-2 font-medium">{t('clients_page.table.company')}</th>
                <th className="px-3 py-2 font-medium">{t('clients_page.table.contact')}</th>
                <th className="px-3 py-2 font-medium">{t('clients_page.table.email')}</th>
                <th className="px-3 py-2 font-medium">{t('clients_page.table.phone')}</th>
                <th className="px-3 py-2 font-medium">{t('clients_page.table.vat')}</th>
                <th className="px-3 py-2 text-right font-medium">
                  {t('clients_page.table.active_jobs')}
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  {t('clients_page.table.monthly_revenue')}
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  {t('clients_page.table.yearly_revenue')}
                </th>
                <th className="px-3 py-2 font-medium">{t('clients_page.table.status')}</th>
                <th className="px-3 py-2 font-medium">{t('clients_page.table.industry')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => {
                const blocked = isBlocked(c);
                const jobs = activeJobs(c);
                const status = blocked
                  ? t('clients_page.status.blocked')
                  : jobs.length === 0
                    ? t('clients_page.status.no_jobs')
                    : t('clients_page.status.active');
                const contactName = [c.contact_first_name, c.contact_last_name]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <tr key={c.id} className="border-b hover:bg-slate-50">
                    <td className="px-3 py-2">
                      {c.code && <CopyableCode code={c.code} className="text-[10px]" />}
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {c.start_date ? formatDate(c.start_date) : formatDate(c.created_at)}
                    </td>
                    <td className="px-3 py-2 font-medium">
                      <Link to={`/clients/${c.id}`} className="hover:underline">
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{contactName || '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{c.email ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-600"><CallLink phone={c.phone} /></td>
                    <td className="px-3 py-2 text-slate-600">{c.vat_number ?? '—'}</td>
                    <td className="px-3 py-2 text-right">{jobs.length}</td>
                    <td className="px-3 py-2 text-right">€{monthlyRevenue(c).toFixed(0)}</td>
                    <td className="px-3 py-2 text-right">€{yearlyRevenue(c).toFixed(0)}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded px-2 py-0.5 text-xs ${
                          blocked
                            ? 'bg-red-100 text-red-700'
                            : jobs.length === 0
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-emerald-100 text-emerald-700'
                        }`}
                      >
                        {status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {c.industry ? industryLabel(c.industry, lang) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
