import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { seoFollowupConfig } from './seoAccessButton';
import { useRequestSeoAccess } from './hooks/useRequestSeoAccess';
import type { JobRow } from './hooks/useJobs';

/**
 * "Follow-up" button for web_seo / local_seo jobs. Sends the department's
 * follow-up email (a reminder to the initial access-request email) through the
 * SAME send path as the access request (`useRequestSeoAccess`), just with the
 * follow-up template key from `seoFollowupConfig`. Renders null when the
 * service has no follow-up template or the client has no email on file.
 * Available regardless of whether the initial email was sent from the app.
 */
export function JobFollowupButton({ job }: { job: JobRow }) {
  const { t } = useTranslation('common');
  const cfg = seoFollowupConfig(job.service_type);
  const email = job.client?.email?.trim() ?? '';
  const send = useRequestSeoAccess();
  const [open, setOpen] = useState(false);

  if (!cfg || email === '') return null;

  function onSend() {
    send.mutate(
      { to: email, code: job.code ?? job.deal?.code ?? '', templateKey: cfg!.templateKey },
      {
        onSuccess: () => setOpen(false),
        onError: (e) => window.alert(e instanceof Error ? e.message : t('seo_access.error')),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        title={t(cfg.requestKey)}
      >
        {t('follow_up.button')}
      </Button>
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
  );
}
