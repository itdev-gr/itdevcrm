import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { seoAccessConfig, seoAccessState } from './seoAccessButton';
import { useSeoAccessSentMap } from './hooks/useSeoAccessSentMap';
import { useRequestSeoAccess } from './hooks/useRequestSeoAccess';
import type { JobRow } from './hooks/useJobs';

export function RequestSeoAccessButton({ job }: { job: JobRow }) {
  const { t, i18n } = useTranslation('common');
  const locale = i18n.resolvedLanguage === 'el' ? 'el-GR' : 'en-US';
  const cfg = seoAccessConfig(job.service_type);
  const sentMap = useSeoAccessSentMap(cfg !== null);
  const email = job.client?.email?.trim() ?? '';
  const lastSent =
    cfg && email ? (sentMap[`${cfg.templateKey}|${email.toLowerCase()}`] ?? null) : null;
  const state = seoAccessState(job, lastSent);
  const send = useRequestSeoAccess();
  const [open, setOpen] = useState(false);

  if (state === 'hidden' || !cfg) return null;

  if (state === 'no-email') {
    return (
      <button
        type="button"
        disabled
        title={t('seo_access.no_email')}
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
    if (!cfg) return;
    send.mutate(
      { to: email, code: job.code ?? job.deal?.code ?? '', templateKey: cfg.templateKey },
      {
        onSuccess: () => setOpen(false),
        onError: (e) => window.alert(e instanceof Error ? e.message : t('seo_access.error')),
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
        aria-label={t(cfg.requestKey)}
        title={state === 'sent' ? t('seo_access.sent_title', { date: sentDate }) : t(cfg.requestKey)}
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
            <DialogTitle>{t(cfg.confirmTitleKey)}</DialogTitle>
            <DialogDescription>{t(cfg.confirmBodyKey, { email })}</DialogDescription>
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
    </>
  );
}
