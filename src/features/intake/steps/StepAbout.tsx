import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '../components/Field';
import { INPUT_CLASS, TEXTAREA_CLASS } from '../styles';
import type { StepProps } from '../types';

/** Step 1 — "A little about you": description + contact details. */
export function StepAbout({ form, updateForm, errors, t }: StepProps) {
  return (
    <div className="space-y-5">
      <Field
        label={t('fields.description.label')}
        htmlFor="intake-description"
        required
        help={t('fields.description.help')}
        error={errors.description}
      >
        <Textarea
          id="intake-description"
          value={form.description}
          onChange={(e) => updateForm({ description: e.target.value })}
          placeholder={t('fields.description.placeholder')}
          aria-invalid={errors.description ? true : undefined}
          className={TEXTAREA_CLASS}
          maxLength={5000}
        />
      </Field>

      <Field
        label={t('fields.contact_email.label')}
        htmlFor="intake-email"
        required
        error={errors.contact_email}
      >
        <Input
          id="intake-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={form.contact_email}
          onChange={(e) => updateForm({ contact_email: e.target.value })}
          placeholder={t('fields.contact_email.placeholder')}
          aria-invalid={errors.contact_email ? true : undefined}
          className={INPUT_CLASS}
        />
      </Field>

      <Field
        label={t('fields.contact_phone.label')}
        htmlFor="intake-phone"
        required
        error={errors.contact_phone}
      >
        <Input
          id="intake-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={form.contact_phone}
          onChange={(e) => updateForm({ contact_phone: e.target.value })}
          placeholder={t('fields.contact_phone.placeholder')}
          aria-invalid={errors.contact_phone ? true : undefined}
          className={INPUT_CLASS}
        />
      </Field>

      <Field
        label={t('fields.contact_whatsapp.label')}
        htmlFor="intake-whatsapp"
        optional
        optionalLabel={t('common.optional')}
        error={errors.contact_whatsapp}
      >
        <Input
          id="intake-whatsapp"
          type="tel"
          inputMode="tel"
          value={form.contact_whatsapp}
          onChange={(e) => updateForm({ contact_whatsapp: e.target.value })}
          placeholder={t('fields.contact_whatsapp.placeholder')}
          aria-invalid={errors.contact_whatsapp ? true : undefined}
          className={INPUT_CLASS}
        />
      </Field>
    </div>
  );
}
