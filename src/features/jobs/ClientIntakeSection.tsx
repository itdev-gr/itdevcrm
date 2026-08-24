import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { AttachmentGallery } from '@/features/attachments/AttachmentGallery';
import { missingItems } from '@/lib/clientIntake';
import { formatDate } from '@/lib/datetime';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/lib/stores/authStore';
import {
  intakeExpiryIso,
  useCreateIntakeForm,
  useJobIntake,
  useSendIntakeForm,
  useUpdateIntakeForm,
  type JobIntakeForm,
} from './hooks/useJobIntake';
import type { JobRow } from './hooks/useJobs';

const PUBLIC_FORM_BASE = 'https://www.itdevcrm.com/f/';

function digitsOnly(v: string): string {
  return v.replace(/\D/g, '');
}

/** Status pill for the form row: locked → Complete (blue); submitted → green;
 *  sent → neutral w/ date; draft+unsent → muted "Not sent". */
function StatusBadge({ form }: { form: JobIntakeForm }) {
  const { t } = useTranslation('jobs');
  let label: string;
  let cls: string;
  if (form.status === 'locked') {
    label = t('client_intake.status.complete');
    cls = 'bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300';
  } else if (form.submitted_at) {
    label = t('client_intake.status.submitted', { date: formatDate(form.submitted_at) });
    cls = 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300';
  } else if (form.sent_at) {
    // created_by is null when the row was created by the auto-onboarding cron.
    label = form.created_by
      ? t('client_intake.status.sent', { date: formatDate(form.sent_at) })
      : t('client_intake.status.sent_auto', { date: formatDate(form.sent_at) });
    cls = 'bg-muted text-muted-foreground';
  } else {
    label = t('client_intake.status.not_sent');
    cls = 'bg-muted text-muted-foreground';
  }
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium', cls)}>
      {label}
    </span>
  );
}

function Answer({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

/**
 * Staff card on the web_dev job Info tab: create / send / copy / regenerate /
 * lock the public intake link, and display every answer + logo/file galleries
 * the client submitted. Reads the form row via {@link useJobIntake}; all writes
 * go through the authenticated client (RLS from migration 20260714150000).
 */
export function ClientIntakeSection({ job }: { job: JobRow }) {
  const { t } = useTranslation('jobs');
  const meId = useAuthStore((s) => s.user?.id ?? '');
  const { data } = useJobIntake(job.id);
  const form = data?.form ?? null;
  const files = data?.files ?? [];

  const create = useCreateIntakeForm();
  const update = useUpdateIntakeForm();
  const send = useSendIntakeForm();

  const [copied, setCopied] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [confirmFollowup, setConfirmFollowup] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);

  const clientEmail = job.client?.email?.trim() ?? '';
  const clientName = job.client?.name ?? '';
  const link = form ? `${PUBLIC_FORM_BASE}${form.token}` : '';
  const isLocked = form?.status === 'locked';

  async function onCopy() {
    if (!link) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(link);
      } else {
        const ta = document.createElement('textarea');
        ta.value = link;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard may be unavailable; fail silently */
    }
  }

  function onSend() {
    if (!form || !clientEmail) return;
    send.mutate(
      { jobId: job.id, to: clientEmail, code: job.code ?? '', clientName, link },
      {
        onSuccess: () => setConfirmSend(false),
        onError: (e) => window.alert(e instanceof Error ? e.message : 'send failed'),
      },
    );
  }

  function onSendFollowup() {
    if (!form || !clientEmail) return;
    send.mutate(
      { jobId: job.id, to: clientEmail, code: job.code ?? '', clientName, link, templateKey: 'webdev_form_followup' },
      {
        onSuccess: () => setConfirmFollowup(false),
        onError: (e) => window.alert(e instanceof Error ? e.message : 'send failed'),
      },
    );
  }

  function onRegenerate() {
    if (!form) return;
    update.mutate(
      { jobId: job.id, patch: { token: crypto.randomUUID(), expires_at: intakeExpiryIso() } },
      {
        onSuccess: () => setConfirmRegen(false),
        onError: (e) => window.alert(e instanceof Error ? e.message : 'update failed'),
      },
    );
  }

  function onComplete() {
    if (!form) return;
    update.mutate(
      {
        jobId: job.id,
        patch: { status: 'locked', locked_at: new Date().toISOString(), locked_by: meId },
      },
      {
        onSuccess: () => setConfirmComplete(false),
        onError: (e) => window.alert(e instanceof Error ? e.message : 'update failed'),
      },
    );
  }

  function onReopen() {
    if (!form) return;
    update.mutate({
      jobId: job.id,
      patch: {
        status: form.submitted_at ? 'submitted' : 'draft',
        locked_at: null,
        locked_by: null,
        expires_at: intakeExpiryIso(),
      },
    });
  }

  // ── No row yet: offer to create the form ───────────────────────────────────
  if (!form) {
    return (
      <div className="border-t border-border/60 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('client_intake.title')}
          </h3>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={create.isPending}
            onClick={() => create.mutate({ jobId: job.id, createdBy: meId })}
          >
            {t('client_intake.create')}
          </Button>
        </div>
      </div>
    );
  }

  // ── Answers ────────────────────────────────────────────────────────────────
  const d = form.data ?? {};
  const str = (k: string): string => (typeof d[k] === 'string' ? (d[k] as string).trim() : '');
  const contactEmail = str('contact_email');
  const contactPhone = str('contact_phone');
  const contactWhatsapp = str('contact_whatsapp');
  const description = str('description');
  const recommendedSite = str('recommended_site');
  const hasWhatsappField = 'wants_whatsapp_button' in d;
  const wantsWhatsappButton = d.wants_whatsapp_button === true;
  const whatsappButtonNumber = str('whatsapp_button_number');
  const hasDomainField = 'has_existing_domain' in d;
  const hasExistingDomain = d.has_existing_domain === true;
  const existingDomain = str('existing_domain');
  const domainSuggestions = Array.isArray(d.domain_suggestions)
    ? (d.domain_suggestions as unknown[]).filter((s): s is string => typeof s === 'string' && s.trim() !== '')
    : [];

  const missing = form.submitted_at
    ? missingItems({ logo_path: form.logo_path, fileCount: files.length, data: d })
    : [];

  const hasContact = contactEmail !== '' || contactPhone !== '' || contactWhatsapp !== '';
  const hasWebsite = recommendedSite !== '' || hasWhatsappField || hasDomainField;
  const hasAnyAnswer =
    hasContact || description !== '' || hasWebsite || !!form.logo_path || files.length > 0;

  const logoRow = form.logo_path
    ? [
        {
          id: 'logo',
          storage_path: form.logo_path,
          file_name: form.logo_path.split('/').pop() ?? 'logo',
          mime_type: 'image/*',
        },
      ]
    : [];

  return (
    <div className="border-t border-border/60 pt-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('client_intake.title')}
          </h3>
          <StatusBadge form={form} />
          {!isLocked && (
            <span className="text-[11px] text-muted-foreground">
              {t('client_intake.expires', { date: formatDate(form.expires_at) })}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={isLocked || clientEmail === '' || send.isPending}
            title={clientEmail === '' ? t('client_intake.no_email') : undefined}
            onClick={() => setConfirmSend(true)}
          >
            {form.sent_at ? t('client_intake.resend') : t('client_intake.send')}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={isLocked || clientEmail === '' || send.isPending}
            title={clientEmail === '' ? t('client_intake.no_email') : undefined}
            onClick={() => setConfirmFollowup(true)}
          >
            {t('follow_up.button', { ns: 'common' })}
          </Button>
          <Button type="button" size="xs" variant="outline" onClick={onCopy}>
            {copied ? `✓ ${t('client_intake.copied')}` : t('client_intake.copy')}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={update.isPending}
            onClick={() => setConfirmRegen(true)}
          >
            {t('client_intake.regenerate')}
          </Button>
          {isLocked ? (
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={update.isPending}
              onClick={onReopen}
            >
              {t('client_intake.reopen')}
            </Button>
          ) : (
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={update.isPending}
              onClick={() => setConfirmComplete(true)}
            >
              {t('client_intake.mark_complete')}
            </Button>
          )}
        </div>
      </div>

      {missing.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">{t('client_intake.missing.label')}:</span>
          {missing.map((key) => (
            <span
              key={key}
              className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
            >
              {t(`client_intake.missing.${key}`)}
            </span>
          ))}
        </div>
      )}

      {!hasAnyAnswer && (
        <p className="mt-2 text-xs text-muted-foreground">{t('client_intake.no_answers')}</p>
      )}

      {hasContact && (
        <div className="mt-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('client_intake.sections.contact')}
          </h4>
          <dl className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {contactEmail && (
              <Answer label={t('client_intake.fields.email')}>
                <a href={`mailto:${contactEmail}`} className="text-primary hover:underline">
                  {contactEmail}
                </a>
              </Answer>
            )}
            {contactPhone && (
              <Answer label={t('client_intake.fields.phone')}>
                <a href={`tel:${contactPhone}`} className="text-primary hover:underline">
                  {contactPhone}
                </a>
              </Answer>
            )}
            {contactWhatsapp && (
              <Answer label={t('client_intake.fields.whatsapp')}>
                <a
                  href={`https://wa.me/${digitsOnly(contactWhatsapp)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline"
                >
                  {contactWhatsapp}
                </a>
              </Answer>
            )}
          </dl>
        </div>
      )}

      {description && (
        <div className="mt-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('client_intake.sections.description')}
          </h4>
          <p className="mt-1 whitespace-pre-wrap text-sm">{description}</p>
        </div>
      )}

      {hasWebsite && (
        <div className="mt-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('client_intake.sections.website')}
          </h4>
          <dl className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {recommendedSite && (
              <Answer label={t('client_intake.fields.recommended_site')}>
                <a
                  href={recommendedSite}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-primary hover:underline"
                >
                  {recommendedSite}
                </a>
              </Answer>
            )}
            {hasWhatsappField && (
              <Answer label={t('client_intake.fields.whatsapp_button')}>
                {wantsWhatsappButton ? (
                  <>
                    {t('client_intake.yes')}
                    {whatsappButtonNumber && (
                      <>
                        {' — '}
                        <a
                          href={`https://wa.me/${digitsOnly(whatsappButtonNumber)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline"
                        >
                          {whatsappButtonNumber}
                        </a>
                      </>
                    )}
                  </>
                ) : (
                  t('client_intake.no')
                )}
              </Answer>
            )}
            {hasDomainField &&
              (hasExistingDomain ? (
                existingDomain && (
                  <Answer label={t('client_intake.fields.domain')}>{existingDomain}</Answer>
                )
              ) : domainSuggestions.length > 0 ? (
                <Answer label={t('client_intake.fields.suggestions')}>
                  <ul className="list-disc pl-4">
                    {domainSuggestions.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </Answer>
              ) : null)}
          </dl>
        </div>
      )}

      {form.logo_path && (
        <div className="mt-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('client_intake.sections.logo')}
          </h4>
          <div className="mt-1">
            <AttachmentGallery files={logoRow} bucket="client-intake" />
          </div>
        </div>
      )}

      {files.length > 0 && (
        <div className="mt-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('client_intake.sections.files')}
          </h4>
          <div className="mt-1">
            <AttachmentGallery files={files} bucket="client-intake" />
          </div>
        </div>
      )}

      {/* Send confirm — primary (non-destructive) action, mirrors the SEO
          access-request confirm flow. */}
      <Dialog open={confirmSend} onOpenChange={setConfirmSend}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('client_intake.confirm.send_title')}</DialogTitle>
            <DialogDescription>
              {t('client_intake.confirm.send_body', { email: clientEmail })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('cancel', { ns: 'common', defaultValue: 'Cancel' })}
              </Button>
            </DialogClose>
            <Button type="button" onClick={onSend} disabled={send.isPending}>
              {form.sent_at ? t('client_intake.resend') : t('client_intake.send')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Follow-up confirm — sends the reminder template (does not re-stamp sent_at). */}
      <Dialog open={confirmFollowup} onOpenChange={setConfirmFollowup}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('follow_up.form_confirm_title', { ns: 'common' })}</DialogTitle>
            <DialogDescription>
              {t('follow_up.form_confirm_body', { ns: 'common', email: clientEmail })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('cancel', { ns: 'common', defaultValue: 'Cancel' })}
              </Button>
            </DialogClose>
            <Button type="button" onClick={onSendFollowup} disabled={send.isPending}>
              {t('follow_up.button', { ns: 'common' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmRegen}
        onOpenChange={setConfirmRegen}
        title={t('client_intake.confirm.regenerate_title')}
        description={t('client_intake.confirm.regenerate_body')}
        confirmLabel={t('client_intake.regenerate')}
        pending={update.isPending}
        onConfirm={onRegenerate}
      />

      <ConfirmDialog
        open={confirmComplete}
        onOpenChange={setConfirmComplete}
        title={t('client_intake.confirm.complete_title')}
        description={t('client_intake.confirm.complete_body')}
        confirmLabel={t('client_intake.mark_complete')}
        pending={update.isPending}
        onConfirm={onComplete}
      />
    </div>
  );
}
