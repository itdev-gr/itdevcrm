import { useDealJobs } from './hooks/useDealJobs';
import { ServiceTypeBadge } from '@/components/ServiceTypeBadge';
import { sharedDealFields } from '@/features/jobs/serviceInfoFields';

export function DealServiceInfo({ dealId }: { dealId: string }) {
  const { data: jobs = [] } = useDealJobs(dealId);
  const rows = jobs
    .map((j) => ({ serviceType: j.service_type, fields: sharedDealFields(j.service_type, j.details) }))
    .filter((r) => r.fields.length > 0);
  if (rows.length === 0) return null;
  return (
    <div className="mt-4 rounded-xl border border-border/60 bg-card p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold">Service info</h2>
      <div className="space-y-4">
        {rows.map((r) => (
          <div key={r.serviceType} className="rounded-lg border border-border/60 bg-muted/20 p-3">
            <ServiceTypeBadge serviceType={r.serviceType} className="mb-2" />
            <dl className="space-y-1.5 text-sm">
              {r.fields.map((f) => (
                <div key={f.key} className="flex gap-2">
                  <dt className="shrink-0 text-muted-foreground">{f.label}:</dt>
                  <dd className="min-w-0 break-words">
                    {f.type === 'url' ? (
                      <a
                        href={f.value}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-primary hover:underline"
                      >
                        {f.value}
                      </a>
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
