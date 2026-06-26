import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { gbpButtonState } from './gbpAccessButton';
import { useGbpAccessSentMap } from './hooks/useGbpAccessSentMap';
import { useRequestGbpAccess } from './hooks/useRequestGbpAccess';
import type { JobRow } from './hooks/useJobs';

export function RequestGbpAccessButton({ job }: { job: JobRow }) {
  const { t, i18n } = useTranslation('common');
  const locale = i18n.resolvedLanguage === 'el' ? 'el-GR' : 'en-US';
  const isLocal = job.service_type === 'local_seo';
  const sentMap = useGbpAccessSentMap(isLocal);
  const email = job.client?.email?.trim() ?? '';
  const lastSent = email ? (sentMap[email.toLowerCase()] ?? null) : null;
  const state = gbpButtonState(job, lastSent);
  const send = useRequestGbpAccess();
  const [open, setOpen] = useState(false);

  if (state === 'hidden') return null;

  if (state === 'no-email') {
    return (
      <button
        type="button"
        disabled
        title={t('gbp_access.no_email')}
        className="shrink-0 rounded p-1 text-muted-foreground/40"
      >
        <Mail className="size-3.5" />
      </button>
    );
  }

  const sentDate = lastSent
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'short' }).format(new Date(lastSent))
    : null;

  function onSend() {
    send.mutate(
      { to: email, code: job.code ?? job.deal?.code ?? '' },
      {
        onSuccess: () => setOpen(false),
        onError: (e) => window.alert(e instanceof Error ? e.message : t('gbp_access.error')),
      },
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label={t('gbp_access.request_title')}
        title={state === 'sent' ? t('gbp_access.sent_title', { date: sentDate }) : t('gbp_access.request_title')}
        className={cn(
          'shrink-0 rounded p-1 transition-colors hover:bg-muted',
          state === 'sent'
            ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        {state === 'sent' ? <Check className="size-3.5" /> : <Mail className="size-3.5" />}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('gbp_access.confirm_title')}</DialogTitle>
            <DialogDescription>{t('gbp_access.confirm_body', { email })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('gbp_access.cancel')}
              </Button>
            </DialogClose>
            <Button type="button" onClick={onSend} disabled={send.isPending}>
              {t('gbp_access.send')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
