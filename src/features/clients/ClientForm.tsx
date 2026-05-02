import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { PermissionAwareInput } from '@/components/permissions/PermissionAwareInput';
import { useUpsertClient } from './hooks/useUpsertClient';
import type { ClientRow } from './hooks/useClients';

const schema = z.object({
  name: z.string().min(1),
  contact_first_name: z.string().optional(),
  contact_last_name: z.string().optional(),
  email: z.string().email().or(z.literal('')).optional(),
  phone: z.string().optional(),
  website: z.string().url().or(z.literal('')).optional(),
  industry: z.string().optional(),
  country: z.string().optional(),
  region: z.string().optional(),
  city: z.string().optional(),
  address: z.string().optional(),
  postcode: z.string().optional(),
  vat_number: z.string().optional(),
  lead_source: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

type Props = {
  initial?: Partial<ClientRow>;
  onDone?: (id: string) => void;
  onCancel?: () => void;
};

export function ClientForm({ initial, onDone, onCancel }: Props) {
  const { t } = useTranslation('clients');
  const upsert = useUpsertClient();
  const { register, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: initial?.name ?? '',
      contact_first_name: initial?.contact_first_name ?? '',
      contact_last_name: initial?.contact_last_name ?? '',
      email: initial?.email ?? '',
      phone: initial?.phone ?? '',
      website: initial?.website ?? '',
      industry: initial?.industry ?? '',
      country: initial?.country ?? '',
      region: initial?.region ?? '',
      city: initial?.city ?? '',
      address: initial?.address ?? '',
      postcode: initial?.postcode ?? '',
      vat_number: initial?.vat_number ?? '',
      lead_source: initial?.lead_source ?? '',
    },
  });

  async function onSubmit(values: FormValues) {
    const payload = Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, v === undefined ? null : v]),
    ) as Record<string, string | null>;
    const upsertArg = initial?.id
      ? { ...payload, name: values.name, id: initial.id }
      : { ...payload, name: values.name };
    const id = await upsert.mutateAsync(upsertArg);
    onDone?.(id);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 md:grid-cols-2">
      <PermissionAwareInput
        table="clients"
        field="name"
        id="name"
        label={t('form.name')}
        {...register('name')}
      />
      <PermissionAwareInput
        table="clients"
        field="contact_first_name"
        id="cfn"
        label={t('form.contact_first_name')}
        {...register('contact_first_name')}
      />
      <PermissionAwareInput
        table="clients"
        field="contact_last_name"
        id="cln"
        label={t('form.contact_last_name')}
        {...register('contact_last_name')}
      />
      <PermissionAwareInput
        table="clients"
        field="email"
        id="email"
        label={t('form.email')}
        {...register('email')}
      />
      <PermissionAwareInput
        table="clients"
        field="phone"
        id="phone"
        label={t('form.phone')}
        {...register('phone')}
      />
      <PermissionAwareInput
        table="clients"
        field="website"
        id="website"
        label={t('form.website')}
        {...register('website')}
      />
      <PermissionAwareInput
        table="clients"
        field="industry"
        id="industry"
        label={t('form.industry')}
        {...register('industry')}
      />
      <PermissionAwareInput
        table="clients"
        field="country"
        id="country"
        label={t('form.country')}
        {...register('country')}
      />
      <PermissionAwareInput
        table="clients"
        field="region"
        id="region"
        label={t('form.region')}
        {...register('region')}
      />
      <PermissionAwareInput
        table="clients"
        field="city"
        id="city"
        label={t('form.city')}
        {...register('city')}
      />
      <PermissionAwareInput
        table="clients"
        field="address"
        id="address"
        label={t('form.address')}
        {...register('address')}
      />
      <PermissionAwareInput
        table="clients"
        field="postcode"
        id="postcode"
        label={t('form.postcode')}
        {...register('postcode')}
      />
      <PermissionAwareInput
        table="clients"
        field="vat_number"
        id="vat"
        label={t('form.vat_number')}
        {...register('vat_number')}
      />
      <PermissionAwareInput
        table="clients"
        field="lead_source"
        id="src"
        label={t('form.lead_source')}
        {...register('lead_source')}
      />

      <div className="md:col-span-2 flex gap-2">
        <Button type="submit" disabled={upsert.isPending || formState.isSubmitting}>
          {upsert.isPending ? t('form.submitting') : t('form.submit')}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('form.cancel')}
          </Button>
        )}
      </div>
    </form>
  );
}
