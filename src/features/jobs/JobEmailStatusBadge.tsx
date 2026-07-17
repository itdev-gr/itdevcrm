import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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

/** Exhaustiveness guard: fails to compile if `jobEmailStatus`'s state union
 *  ever grows a 4th member without a matching branch here. */
function assertUnreachable(state: never): never {
  throw new Error(`Unhandled job email state: ${String(state)}`);
}

/**
 * Job onboarding-email status badge.
 * - `variant="card"` — a small colored dot for kanban cards.
 * - `variant="detail"` — a text pill for the job detail header (sent shows the date).
 *
 * `not_sent` and `sent` both render a Resend action that mirrors the SEO
 * access-request confirm-then-send flow (same `seo_access.*` copy, same
 * `useRequestSeoAccess` mutation — no new send path); `sent` additionally
 * shows a last-sent line in the confirm dialog. AI SEO parents (and any
 * other service without an onboarding template) always resolve to
 * `coming_soon`.
 */
export function JobEmailStatusBadge({
  job,
  variant,
}: {
  job: JobRow;
  variant: 'card' | 'detail';
}) {
  const { t } = useTranslation('common');

  // Only web_seo / local_seo currently have an onboarding-access template, so
  // only fetch the sent-map for those — matches useSeoAccessSentMap's
  // "SEO boards only" contract; every other service type is `coming_soon`.
  // `cfg` also supplies the localized copy for the resend confirm dialog,
  // matching the per-service access-request button it replaced.
  const cfg = seoAccessConfig(job.service_type);
  const sentMap = useSeoAccessSentMap(cfg !== null);

  // jobEmailStatus (B1) takes a flat `client_email`, but JobRow only carries
  // the client's email nested under `client.email` — mapped here.
  const email = job.client?.email?.trim() ?? '';
  const { state, templateKey, lastSent } = jobEmailStatus(
    { service_type: job.service_type, client_email: email },
    sentMap,
  );

  const send = useRequestSeoAccess();
  const [open, setOpen] = useState(false);
  const canSend =
    (state === 'not_sent' || state === 'sent') && templateKey !== null && email !== '';

  function onSend() {
    if (!templateKey) return;
    send.mutate(
      { to: email, code: job.code ?? job.deal?.code ?? '', templateKey },
      {
        onSuccess: () => setOpen(false),
        onError: (e) => window.alert(e instanceof Error ? e.message : t('seo_access.error')),
      },
    );
  }

  const resendDialog = canSend && cfg && (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t(cfg.confirmTitleKey)}</DialogTitle>
          <DialogDescription>
            {t(cfg.confirmBodyKey, { email })}
            {lastSent ? (
              <>
                <br />
                {t('seo_access.last_sent_line', { date: formatDate(lastSent) })}
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t('seo_access.cancel')}
            </Button>
          </DialogClose>
          <Button type="button" onClick={onSend} disabled={send.isPending}>
            {t('seo_access.send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (variant === 'card') {
    switch (state) {
      case 'coming_soon':
        return (
          <span
            role="img"
            className="inline-block size-2 shrink-0 rounded-full bg-muted-foreground/40"
            aria-label={t('seo_access.coming_soon')}
            title={t('seo_access.coming_soon_hint')}
          />
        );
      case 'sent': {
        const sentDate = lastSent ? formatDate(lastSent) : null;
        return (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (canSend) setOpen(true);
              }}
              disabled={!canSend}
              aria-label={cfg ? t(cfg.requestKey) : t('seo_access.sent')}
              title={
                sentDate ? t('seo_access.sent_title', { date: sentDate }) : t('seo_access.sent')
              }
              className="shrink-0 rounded-full p-0.5 transition-colors hover:bg-muted disabled:cursor-not-allowed"
            >
              <span className="block size-2 rounded-full bg-emerald-500" />
            </button>
            {resendDialog}
          </>
        );
      }
      case 'not_sent':
        return (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (canSend) setOpen(true);
              }}
              disabled={!canSend}
              aria-label={canSend && cfg ? t(cfg.requestKey) : t('seo_access.no_email')}
              title={canSend ? t('seo_access.not_sent_hint') : t('seo_access.no_email')}
              className="shrink-0 rounded-full p-0.5 transition-colors hover:bg-muted disabled:cursor-not-allowed"
            >
              {/* No client email on file → muted/non-actionable dot (matches the
                  dimmed treatment the old SEO access button gave this case);
                  email on file but not yet sent → amber actionable dot. */}
              <span
                className={cn(
                  'block size-2 rounded-full',
                  canSend ? 'bg-amber-500' : 'bg-muted-foreground/40',
                )}
              />
            </button>
            {resendDialog}
          </>
        );
      default:
        return assertUnreachable(state);
    }
  }

  // variant === 'detail'
  switch (state) {
    case 'coming_soon':
      return (
        <span className={cn(detailHeaderStatusBadgeClass, 'bg-muted text-muted-foreground')}>
          <Clock className="size-2.5" />
          {t('seo_access.coming_soon')}
        </span>
      );

    case 'sent': {
      const sentDate = lastSent ? formatDate(lastSent) : null;
      return (
        <>
          <span
            className={cn(
              detailHeaderStatusBadgeClass,
              'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
            )}
          >
            <CheckCircle2 className="size-2.5" />
            {t('seo_access.sent')}
            {sentDate ? ` · ${sentDate}` : ''}
          </span>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={!canSend}
            onClick={() => setOpen(true)}
          >
            {t('seo_access.resend')}
          </Button>
          {resendDialog}
        </>
      );
    }

    case 'not_sent':
      return (
        <>
          <span
            className={cn(
              detailHeaderStatusBadgeClass,
              'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
            )}
          >
            <AlertTriangle className="size-2.5" />
            {t('seo_access.not_sent')}
          </span>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={!canSend}
            onClick={() => setOpen(true)}
            title={canSend ? undefined : t('seo_access.no_email')}
          >
            {t('seo_access.resend')}
          </Button>
          {resendDialog}
        </>
      );

    default:
      return assertUnreachable(state);
  }
}
