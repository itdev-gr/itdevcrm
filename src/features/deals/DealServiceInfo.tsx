import { useDealJobs } from './hooks/useDealJobs';
import { sharedDealFields } from '@/features/jobs/serviceInfoFields';

export function DealServiceInfo({ dealId }: { dealId: string }) {
  const { data: jobs = [] } = useDealJobs(dealId);
  const rows = jobs
    .map((j) => ({ serviceType: j.service_type, fields: sharedDealFields(j.service_type, j.details) }))
    .filter((r) => r.fields.length > 0);
  if (rows.length === 0) return null;
  return (
    <div className="mt-6 rounded-md border bg-muted p-4">
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">Service info</h2>
      <div className="space-y-4">
        {rows.map((r) => (
          <div key={r.serviceType}>
            <div className="text-xs font-semibold text-muted-foreground">{r.serviceType}</div>
            <dl className="mt-1 space-y-1 text-sm">
              {r.fields.map((f) => (
                <div key={f.key} className="flex gap-2">
                  <dt className="text-muted-foreground">{f.label}:</dt>
                  <dd className="min-w-0 break-words">
                    {f.type === 'url' ? (
                      <a href={f.value} target="_blank" rel="noreferrer" className="text-blue-700 underline dark:text-blue-400">{f.value}</a>
                    ) : (
                      f.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}
