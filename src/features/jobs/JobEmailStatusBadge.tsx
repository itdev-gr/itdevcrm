import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { detailHeaderStatusBadgeClass } from '@/components/layout/page-shell';
import { formatDate } from '@/lib/datetime';
import { cn } from '@/lib/utils';
import { jobEmailStatus } from './jobEmailStatus';
import { seoAccessConfig } from './seoAccessButton';
import { useSeoAccessSentMap } from './hooks/useSeoAccessSentMap';
import { useRequestSeoAccess } from './hooks/useRequestSeoAccess';
import type { JobRow } from './hooks/useJobs';

/**
 * Job onboarding-email status badge.
 * - `variant="card"` — a small colored dot for kanban cards.
 * - `variant="detail"` — a text pill for the job detail header (sent shows the date).
 *
 * `not_sent` renders a Resend action that mirrors `RequestSeoAccessButton`'s
 * confirm-then-send flow, reusing the same `useRequestSeoAccess` mutation
 * (no new send path). AI SEO parents (and any other service without an
 * onboarding template) always resolve to `coming_soon`.
 */
export function JobEmailStatusBadge({
  job,
  variant,
}: {
  job: JobRow;
  variant: 'card' | 'detail';
}) {
  // Only web_seo / local_seo currently have an onboarding-access template, so
  // only fetch the sent-map for those — matches useSeoAccessSentMap's
  // "SEO boards only" contract; every other service type is `coming_soon`.
  const sentMap = useSeoAccessSentMap(seoAccessConfig(job.service_type) !== null);

  // jobEmailStatus (B1) takes a flat `client_email`, but JobRow only carries
  // the client's email nested under `client.email` — mapped here.
  const email = job.client?.email?.trim() ?? '';
  const { state, templateKey, lastSent } = jobEmailStatus(
    { service_type: job.service_type, client_email: email },
    sentMap,
  );

  const send = useRequestSeoAccess();
  const [open, setOpen] = useState(false);
  const canSend = state === 'not_sent' && templateKey !== null && email !== '';

  function onSend() {
    if (!templateKey) return;
    send.mutate(
      { to: email, code: job.code ?? job.deal?.code ?? '', templateKey },
      {
        onSuccess: () => setOpen(false),
        onError: (e) => window.alert(e instanceof Error ? e.message : 'Failed to send email.'),
      },
    );
  }

  const resendDialog = canSend && (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Resend access email?</DialogTitle>
          <DialogDescription>
            Send the onboarding access-request email to {email} again.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" onClick={onSend} disabled={send.isPending}>
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (variant === 'card') {
    if (state === 'coming_soon') {
      return (
        <span
          className="inline-block size-2 shrink-0 rounded-full bg-muted-foreground/40"
          aria-label="Coming soon"
          title="Onboarding email coming soon"
        />
      );
    }
    if (state === 'sent') {
      const sentDate = lastSent ? formatDate(lastSent) : null;
      return (
        <span
          className="inline-block size-2 shrink-0 rounded-full bg-emerald-500"
          aria-label="Access email sent"
          title={sentDate ? `Access email sent · ${sentDate}` : 'Access email sent'}
        />
      );
    }
    return (
      <>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (canSend) setOpen(true);
          }}
          disabled={!canSend}
          aria-label="Resend onboarding access email"
          title={
            canSend
              ? 'Access email not sent — click to resend'
              : 'Access email not sent (no client email on file)'
          }
          className="shrink-0 rounded-full p-0.5 transition-colors hover:bg-muted disabled:cursor-not-allowed"
        >
          <span className="block size-2 rounded-full bg-amber-500" />
        </button>
        {resendDialog}
      </>
    );
  }

  // variant === 'detail'
  if (state === 'coming_soon') {
    return (
      <span className={cn(detailHeaderStatusBadgeClass, 'bg-muted text-muted-foreground')}>
        <Clock className="size-2.5" />
        Coming soon
      </span>
    );
  }

  if (state === 'sent') {
    const sentDate = lastSent ? formatDate(lastSent) : null;
    return (
      <span
        className={cn(
          detailHeaderStatusBadgeClass,
          'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
        )}
      >
        <CheckCircle2 className="size-2.5" />
        Access email sent{sentDate ? ` · ${sentDate}` : ''}
      </span>
    );
  }

  return (
    <>
      <span
        className={cn(
          detailHeaderStatusBadgeClass,
          'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
        )}
      >
        <AlertTriangle className="size-2.5" />
        Not sent
      </span>
      <Button
        type="button"
        size="xs"
        variant="outline"
        disabled={!canSend}
        onClick={() => setOpen(true)}
        title={canSend ? undefined : 'No client email on file'}
      >
        Resend
      </Button>
      {resendDialog}
    </>
  );
}
