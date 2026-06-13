import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { PermissionAwareInput } from '@/components/permissions/PermissionAwareInput';
import { autoSaveLabel, useAutoSave } from '@/lib/autosave';
import { useUpsertClient } from './hooks/useUpsertClient';
import type { ClientRow } from './hooks/useClients';
import { CallLink } from '@/components/CallLink';

type Props = {
  initial?: Partial<ClientRow>;
  onDone?: (id: string) => void;
  onCancel?: () => void;
};

function joinName(full: string): { first: string | null; last: string | null } {
  const trimmed = full.trim();
  if (!trimmed) return { first: null, last: null };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { first: parts[0] ?? null, last: null };
  return { first: parts[0] ?? null, last: parts.slice(1).join(' ') || null };
}

export function ClientForm({ initial, onDone, onCancel }: Props) {
  const { t, i18n } = useTranslation('clients');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const upsert = useUpsertClient();
  const isEdit = !!initial?.id;

  const [name, setName] = useState(initial?.name ?? '');
  const [contactName, setContactName] = useState(
    [initial?.contact_first_name, initial?.contact_last_name].filter(Boolean).join(' '),
  );
  const [email, setEmail] = useState(initial?.email ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [website, setWebsite] = useState(initial?.website ?? '');
  const [industry, setIndustry] = useState(initial?.industry ?? '');
  const [country, setCountry] = useState(initial?.country ?? '');
  const [region, setRegion] = useState(initial?.region ?? '');
  const [city, setCity] = useState(initial?.city ?? '');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [postcode, setPostcode] = useState(initial?.postcode ?? '');
  const [vatNumber, setVatNumber] = useState(initial?.vat_number ?? '');
  const [leadSource, setLeadSource] = useState(initial?.lead_source ?? '');

  const patch = useMemo(() => {
    const { first, last } = joinName(contactName);
    return {
      name: name.trim() || initial?.name || '',
      contact_first_name: first,
      contact_last_name: last,
      email: email.trim() || null,
      phone: phone.trim() || null,
      website: website.trim() || null,
      industry: industry.trim() || null,
      country: country.trim() || null,
      region: region.trim() || null,
      city: city.trim() || null,
      address: address.trim() || null,
      postcode: postcode.trim() || null,
      vat_number: vatNumber.trim() || null,
      lead_source: leadSource.trim() || null,
    };
  }, [
    name,
    contactName,
    email,
    phone,
    website,
    industry,
    country,
    region,
    city,
    address,
    postcode,
    vatNumber,
    leadSource,
    initial?.name,
  ]);

  const saveStatus = useAutoSave(
    patch,
    async (next) => {
      if (!initial?.id) return;
      await upsert.mutateAsync({ ...next, id: initial.id });
    },
    { enabled: isEdit },
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!patch.name) return;
    const id = await upsert.mutateAsync(patch);
    onDone?.(id);
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-2">
      <PermissionAwareInput
        table="clients"
        field="name"
        id="name"
        label={t('form.name')}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <PermissionAwareInput
        table="clients"
        field="contact_first_name"
        id="cn"
        label={t('form.contact_name')}
        value={contactName}
        onChange={(e) => setContactName(e.target.value)}
      />
      <PermissionAwareInput
        table="clients"
        field="email"
        id="email"
        label={t('form.email')}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <PermissionAwareInput
        table="clients"
        field="phone"
        id="phone"
        label={t('form.phone')}
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />
      {phone ? (
        <div className="mt-1 text-xs">
          <CallLink phone={phone} />
        </div>
      ) : null}
      <PermissionAwareInput
        table="clients"
        field="website"
        id="website"
        label={t('form.website')}
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
      />
      <PermissionAwareInput
        table="clients"
        field="industry"
        id="industry"
        label={t('form.industry')}
        value={industry}
        onChange={(e) => setIndustry(e.target.value)}
      />
      <PermissionAwareInput
        table="clients"
        field="country"
        id="country"
        label={t('form.country')}
        value={country}
        onChange={(e) => setCountry(e.target.value)}
      />
      <PermissionAwareInput
        table="clients"
        field="region"
        id="region"
        label={t('form.region')}
        value={region}
        onChange={(e) => setRegion(e.target.value)}
      />
      <PermissionAwareInput
        table="clients"
        field="city"
        id="city"
        label={t('form.city')}
        value={city}
        onChange={(e) => setCity(e.target.value)}
      />
      <PermissionAwareInput
        table="clients"
        field="address"
        id="address"
        label={t('form.address')}
        value={address}
        onChange={(e) => setAddress(e.target.value)}
      />
      <PermissionAwareInput
        table="clients"
        field="postcode"
        id="postcode"
        label={t('form.postcode')}
        value={postcode}
        onChange={(e) => setPostcode(e.target.value)}
      />
      <PermissionAwareInput
        table="clients"
        field="vat_number"
        id="vat"
        label={t('form.vat_number')}
        value={vatNumber}
        onChange={(e) => setVatNumber(e.target.value)}
      />
      <PermissionAwareInput
        table="clients"
        field="lead_source"
        id="src"
        label={t('form.lead_source')}
        value={leadSource}
        onChange={(e) => setLeadSource(e.target.value)}
      />

      {isEdit ? (
        <div className="md:col-span-2 flex h-5 items-center text-xs text-slate-500">
          {autoSaveLabel(saveStatus, lang)}
        </div>
      ) : (
        <div className="md:col-span-2 flex gap-2">
          <Button type="submit" disabled={upsert.isPending || !patch.name}>
            {upsert.isPending ? t('form.submitting') : t('form.submit')}
          </Button>
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel}>
              {t('form.cancel')}
            </Button>
          )}
        </div>
      )}
    </form>
  );
}
