import { relativeFromNow } from '@/lib/datetime';
import { emailTemplateLabel } from '@/features/activity/format';
import { emailStatusColor, summarizeEmailStatuses, type EmailColor } from '@/features/deals/emailStatusColor';
import { useLeadEmails } from './hooks/useLeadEmails';

const DOT: Record<EmailColor, string> = {
  green: 'bg-emerald-500',
  yellow: 'bg-amber-400',
  red: 'bg-red-500',
};

/** The lead-page twin of DealEmailsBox: every automated sales email sent for
 *  this lead (welcome, sequences, scheduling, won) with delivery status. */
export function LeadEmailsBox({ leadId }: { leadId: string }) {
  const { data: rows = [], isLoading } = useLeadEmails(leadId);
  const counts = summarizeEmailStatuses(rows);

  return (
    <div className="rounded-xl border border-border/60 bg-card p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Emails ({counts.total})</h3>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />{counts.green}</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" />{counts.yellow}</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" />{counts.red}</span>
        </div>
      </div>
      {isLoading ? (
        <p className="text-xs text-muted-foreground">…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No emails sent for this lead yet.</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {rows.map((r) => {
            // Owner-Gmail sends carry identity 'personal' and never get a
            // delivery signal — 'sent' is terminal there, so show it green.
            const viaGmail = (r as { identity?: string }).identity === 'personal';
            const color: EmailColor =
              viaGmail && r.status === 'sent' ? 'green' : emailStatusColor(r.status);
            const failed = color === 'red';
            return (
              <li
                key={r.id}
                className="flex items-center gap-2 py-1.5"
                title={
                  failed && r.error
                    ? r.error
                    : viaGmail
                      ? 'Εστάλη από το Gmail του πωλητή (χωρίς παρακολούθηση παράδοσης)'
                      : undefined
                }
              >
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[color]}`} />
                <span className="truncate text-sm">{emailTemplateLabel(r.template_key)}</span>
                <span className="truncate text-xs text-muted-foreground">{r.to_email}</span>
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                  {relativeFromNow(r.delivered_at ?? r.bounced_at ?? r.created_at)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
