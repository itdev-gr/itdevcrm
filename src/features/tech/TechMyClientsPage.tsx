import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { useTechMyClients, type TechMyClientRow } from './hooks/useTechMyClients';
import { relativeFromNow } from '@/lib/datetime';
import { industryLabel } from '@/lib/industries';

const SERVICE_LABELS: Record<string, { en: string; el: string }> = {
  'web-seo': { en: 'Web SEO', el: 'Web SEO' },
  'local-seo': { en: 'Local SEO', el: 'Local SEO' },
  'web-dev': { en: 'Web Development', el: 'Ανάπτυξη Ιστοσελίδων' },
  'social-media': { en: 'Social Media', el: 'Social Media' },
  'ai-seo': { en: 'AI SEO', el: 'AI SEO' },
  hosting: { en: 'Hosting', el: 'Hosting' },
};

const URL_TO_SERVICE: Record<string, string> = {
  'web-seo': 'web_seo',
  'local-seo': 'local_seo',
  'web-dev': 'web_dev',
  'social-media': 'social_media',
  'ai-seo': 'ai_seo',
  hosting: 'hosting',
};

export function TechMyClientsPage() {
  const { serviceType: urlServiceType = '' } = useParams<{ serviceType: string }>();
  const { i18n } = useTranslation();
  const lang: 'en' | 'el' = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const serviceType = URL_TO_SERVICE[urlServiceType] ?? '';
  const label = SERVICE_LABELS[urlServiceType]?.[lang] ?? urlServiceType;
  const [query, setQuery] = useState('');
  const { data: rows = [], isLoading } = useTechMyClients(serviceType);

  if (isLoading) return <div className="p-8">…</div>;
  if (!serviceType) return <div className="p-8 text-red-600 dark:text-red-400">Unknown service.</div>;

  const filtered = rows.filter((r: TechMyClientRow) => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return (
      r.client_name.toLowerCase().includes(q) ||
      (r.email ?? '').toLowerCase().includes(q) ||
      (r.industry ?? '').toLowerCase().includes(q) ||
      industryLabel(r.industry, lang).toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-6">
      <div className="-mx-6 -mt-6 border-b bg-background/95 px-6 py-3">
        <h1 className="text-2xl font-bold">{label} — My Clients</h1>
        <p className="text-xs text-muted-foreground">
          Clients with activity in the last 90 days.
        </p>
      </div>

      <Input
        placeholder="Filter by client, email, industry…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="max-w-sm"
      />

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No clients match.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-normal">Client</th>
                <th className="px-3 py-2 font-normal">Industry</th>
                <th className="px-3 py-2 font-normal text-right">Active jobs</th>
                <th className="px-3 py-2 font-normal">Last activity</th>
                <th className="px-3 py-2 font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const contactName = [r.contact_first_name, r.contact_last_name]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <tr key={r.client_id} className="border-t hover:bg-muted/60">
                    <td className="px-3 py-2">
                      <Link
                        to={`/clients/${r.client_id}`}
                        className="font-medium text-blue-700 hover:underline dark:text-blue-400"
                      >
                        {r.client_name}
                      </Link>
                      {(contactName || r.email) && (
                        <div className="text-[11px] text-muted-foreground">
                          {[contactName, r.email].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {r.industry ? industryLabel(r.industry, lang) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.active_jobs}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {relativeFromNow(r.last_activity)}
                    </td>
                    <td className="px-3 py-2">
                      {r.any_blocked ? (
                        <span className="rounded bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950/50 dark:text-red-300">
                          🔒 Blocked
                        </span>
                      ) : (
                        <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                          {r.client_status ?? 'active'}
                        </span>
                      )}
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
