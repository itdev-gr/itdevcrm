import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { useRecurringClients, type RecurringClientRow } from './hooks/useRecurringClients';
import { formatDate } from '@/lib/datetime';

function StatusBadge({ row }: { row: RecurringClientRow }) {
  if (row.is_blocked) {
    return (
      <span className="rounded bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">
        Blocked
      </span>
    );
  }
  if (row.has_overdue_payment) {
    return (
      <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
        Overdue
      </span>
    );
  }
  if (row.status === 'done') {
    return (
      <span className="rounded bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-700">
        Done
      </span>
    );
  }
  return (
    <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
      Active
    </span>
  );
}

export function AccountingRecurringPage() {
  const { data: rows = [], isLoading } = useRecurringClients();
  const [query, setQuery] = useState('');

  const filtered = rows.filter((r) => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return (
      r.client_name.toLowerCase().includes(q) ||
      (r.email ?? '').toLowerCase().includes(q) ||
      (r.industry ?? '').toLowerCase().includes(q)
    );
  });

  if (isLoading) return <div className="p-8">…</div>;

  const totals = {
    count: rows.length,
    monthly: rows.reduce((sum, r) => sum + r.monthly_total, 0),
    overdue: rows.filter((r) => r.has_overdue_payment).length,
    blocked: rows.filter((r) => r.is_blocked).length,
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-6">
      <div className="-mx-6 -mt-6 border-b bg-white/95 px-6 py-3">
        <h1 className="text-2xl font-bold">Recurring clients</h1>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Active clients" value={String(totals.count)} />
        <Stat label="Monthly recurring" value={`€${totals.monthly.toFixed(0)}`} />
        <Stat label="Overdue" value={String(totals.overdue)} tone="amber" />
        <Stat label="Blocked" value={String(totals.blocked)} tone="red" />
      </div>

      <Input
        placeholder="Filter by client, email, industry…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="max-w-sm"
      />

      {filtered.length === 0 ? (
        <p className="text-sm text-slate-500">No recurring clients match.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 font-normal">Client</th>
                <th className="px-3 py-2 font-normal">Services</th>
                <th className="px-3 py-2 font-normal text-right">Monthly</th>
                <th className="px-3 py-2 font-normal">Next due</th>
                <th className="px-3 py-2 font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const contactName = [r.contact_first_name, r.contact_last_name]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <tr key={r.client_id} className="border-t hover:bg-slate-50/60">
                    <td className="px-3 py-2">
                      <Link
                        to={`/clients/${r.client_id}`}
                        className="font-medium text-blue-700 hover:underline"
                      >
                        {r.client_name}
                      </Link>
                      {(contactName || r.email) && (
                        <div className="text-[11px] text-slate-500">
                          {[contactName, r.email].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-700">
                      {r.active_services.join(' · ')}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      €{r.monthly_total.toFixed(0)}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {r.earliest_due ? formatDate(r.earliest_due) : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge row={r} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'amber' | 'red';
}) {
  const toneClass =
    tone === 'amber'
      ? 'text-amber-700'
      : tone === 'red'
        ? 'text-red-700'
        : 'text-slate-900';
  return (
    <div className="rounded-md border bg-slate-50 p-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}
