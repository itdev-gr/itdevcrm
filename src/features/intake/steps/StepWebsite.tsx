import { Plus, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Field } from '../components/Field';
import { INPUT_CLASS } from '../styles';
import type { StepProps } from '../types';

const MAX_SUGGESTIONS = 3;

/** Step 3 — "Website": recommended site, WhatsApp button, and domain answers. */
export function StepWebsite({ form, updateForm, errors, t }: StepProps) {
  function setSuggestion(index: number, value: string) {
    const next = form.domain_suggestions.slice();
    next[index] = value;
    updateForm({ domain_suggestions: next });
  }

  function addSuggestion() {
    if (form.domain_suggestions.length >= MAX_SUGGESTIONS) return;
    updateForm({ domain_suggestions: [...form.domain_suggestions, ''] });
  }

  function removeSuggestion(index: number) {
    updateForm({ domain_suggestions: form.domain_suggestions.filter((_, i) => i !== index) });
  }

  // Always show at least one suggestion row when the client has no domain.
  const suggestions =
    form.domain_suggestions.length > 0 ? form.domain_suggestions : [''];

  return (
    <div className="space-y-6">
      <Field
        label={t('fields.recommended_site.label')}
        htmlFor="intake-recommended-site"
        optional
        optionalLabel={t('common.optional')}
        help={t('fields.recommended_site.help')}
        error={errors.recommended_site}
      >
        <Input
          id="intake-recommended-site"
          type="url"
          inputMode="url"
          value={form.recommended_site}
          onChange={(e) => updateForm({ recommended_site: e.target.value })}
          placeholder={t('fields.recommended_site.placeholder')}
          aria-invalid={errors.recommended_site ? true : undefined}
          className={INPUT_CLASS}
        />
      </Field>

      <div className="rounded-xl border border-[#e8ebf0] bg-[#fafbfc] p-4">
        <label className="flex cursor-pointer items-start gap-3">
          <Checkbox
            checked={form.wants_whatsapp_button}
            onCheckedChange={(v) =>
              updateForm(
                v === true
                  ? { wants_whatsapp_button: true }
                  : { wants_whatsapp_button: false, whatsapp_button_number: '' },
              )
            }
            className="mt-0.5"
          />
          <span className="text-sm">
            <span className="block font-semibold text-[#15243b]">
              {t('fields.wants_whatsapp_button.label')}
            </span>
            <span className="mt-0.5 block text-xs text-[#667085]">
              {t('fields.wants_whatsapp_button.help')}
            </span>
          </span>
        </label>

        {form.wants_whatsapp_button && (
          <div className="mt-4">
            <Field
              label={t('fields.whatsapp_button_number.label')}
              htmlFor="intake-whatsapp-button"
              required
              error={errors.whatsapp_button_number}
            >
              <Input
                id="intake-whatsapp-button"
                type="tel"
                inputMode="tel"
                value={form.whatsapp_button_number}
                onChange={(e) => updateForm({ whatsapp_button_number: e.target.value })}
                placeholder={t('fields.whatsapp_button_number.placeholder')}
                aria-invalid={errors.whatsapp_button_number ? true : undefined}
                className={INPUT_CLASS}
              />
            </Field>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <span className="block text-sm font-semibold text-[#15243b]">
          {t('fields.has_existing_domain.label')}
        </span>
        <div className="grid grid-cols-2 gap-3">
          <DomainChoice
            selected={form.has_existing_domain}
            label={t('fields.has_existing_domain.yes')}
            onClick={() => updateForm({ has_existing_domain: true })}
          />
          <DomainChoice
            selected={!form.has_existing_domain}
            label={t('fields.has_existing_domain.no')}
            onClick={() => updateForm({ has_existing_domain: false })}
          />
        </div>

        {form.has_existing_domain ? (
          <Field
            label={t('fields.existing_domain.label')}
            htmlFor="intake-existing-domain"
            required
            error={errors.existing_domain}
          >
            <Input
              id="intake-existing-domain"
              value={form.existing_domain}
              onChange={(e) => updateForm({ existing_domain: e.target.value })}
              placeholder={t('fields.existing_domain.placeholder')}
              aria-invalid={errors.existing_domain ? true : undefined}
              className={INPUT_CLASS}
            />
          </Field>
        ) : (
          <Field
            label={t('fields.domain_suggestions.label')}
            required
            help={t('fields.domain_suggestions.help')}
            error={errors.domain_suggestions}
          >
            <div className="space-y-2">
              {suggestions.map((value, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={value}
                    onChange={(e) => setSuggestion(index, e.target.value)}
                    placeholder={t('fields.domain_suggestions.placeholder')}
                    className={INPUT_CLASS}
                  />
                  {suggestions.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeSuggestion(index)}
                      aria-label={t('common.remove')}
                      className="size-9 shrink-0 rounded-lg text-[#667085] hover:text-red-600"
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                </div>
              ))}
              {form.domain_suggestions.length < MAX_SUGGESTIONS && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={addSuggestion}
                  className="h-9 rounded-lg px-3 text-sm font-semibold text-[#1a9696] hover:bg-[#1a9696]/10 hover:text-[#178787]"
                >
                  <Plus className="size-4" />
                  {t('fields.domain_suggestions.add')}
                </Button>
              )}
            </div>
          </Field>
        )}
      </div>
    </div>
  );
}

function DomainChoice({
  selected,
  label,
  onClick,
}: {
  selected: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={
        selected
          ? 'rounded-xl border-2 border-[#1a9696] bg-[#1a9696]/5 px-4 py-3 text-sm font-semibold text-[#15243b] transition-colors'
          : 'rounded-xl border-2 border-[#e8ebf0] bg-white px-4 py-3 text-sm font-medium text-[#667085] transition-colors hover:border-[#d9dee7]'
      }
    >
      {label}
    </button>
  );
}
