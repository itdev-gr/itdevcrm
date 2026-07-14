import type { TFunction } from 'i18next';
import { AlertTriangle, Pencil } from 'lucide-react';
import { cleanSuggestions } from '../intakeDraft';
import type { IntakeFileRow, IntakeFormState, IntakeLogo } from '../types';

interface StepReviewProps {
  form: IntakeFormState;
  logo: IntakeLogo | null;
  files: IntakeFileRow[];
  missing: string[];
  onEdit: (step: number) => void;
  t: TFunction;
}

/** Step 4 — read-only summary grouped by step + a loud (but non-blocking) gaps panel. */
export function StepReview({ form, logo, files, missing, onEdit, t }: StepReviewProps) {
  const dash = t('review.empty');

  const domainValue = form.has_existing_domain
    ? form.existing_domain || dash
    : cleanSuggestions(form.domain_suggestions).join(', ') || dash;

  return (
    <div className="space-y-5">
      {missing.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-500" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-amber-900">{t('review.missing_title')}</p>
              <p className="text-xs text-amber-800">{t('review.missing_intro')}</p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {missing.map((key) => (
                  <li
                    key={key}
                    className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900"
                  >
                    {t(`missing.${key}`)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      <Section title={t('steps.about.title')} onEdit={() => onEdit(1)} editLabel={t('common.edit')}>
        <Row label={t('fields.description.label')} value={form.description || dash} />
        <Row label={t('fields.contact_email.label')} value={form.contact_email || dash} />
        <Row label={t('fields.contact_phone.label')} value={form.contact_phone || dash} />
        <Row label={t('fields.contact_whatsapp.label')} value={form.contact_whatsapp || dash} />
      </Section>

      <Section
        title={t('steps.materials.title')}
        onEdit={() => onEdit(2)}
        editLabel={t('common.edit')}
      >
        <Row
          label={t('materials.logo_title')}
          value={logo ? logo.file_name : t('review.no_logo')}
        />
        <Row
          label={t('materials.files_title')}
          value={files.length > 0 ? t('review.files_count', { count: files.length }) : dash}
        />
      </Section>

      <Section
        title={t('steps.website.title')}
        onEdit={() => onEdit(3)}
        editLabel={t('common.edit')}
      >
        <Row label={t('fields.recommended_site.label')} value={form.recommended_site || dash} />
        <Row
          label={t('fields.wants_whatsapp_button.label')}
          value={
            form.wants_whatsapp_button
              ? form.whatsapp_button_number || t('common.yes')
              : t('common.no')
          }
        />
        <Row
          label={
            form.has_existing_domain
              ? t('fields.existing_domain.label')
              : t('fields.domain_suggestions.label')
          }
          value={domainValue}
        />
      </Section>
    </div>
  );
}

function Section({
  title,
  editLabel,
  onEdit,
  children,
}: {
  title: string;
  editLabel: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[#e8ebf0] bg-white">
      <div className="flex items-center justify-between border-b border-[#f0f2f5] px-4 py-2.5">
        <h3 className="text-sm font-semibold text-[#15243b]">{title}</h3>
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex items-center gap-1 text-xs font-semibold text-[#1a9696] hover:text-[#178787]"
        >
          <Pencil className="size-3" />
          {editLabel}
        </button>
      </div>
      <dl className="divide-y divide-[#f5f6f8]">{children}</dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 px-4 py-2.5 sm:grid-cols-[9rem_1fr]">
      <dt className="text-xs font-medium text-[#98a2b3]">{label}</dt>
      <dd className="text-sm break-words whitespace-pre-wrap text-[#15243b]">{value}</dd>
    </div>
  );
}
