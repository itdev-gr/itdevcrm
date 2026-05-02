import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateLead } from './hooks/useCreateLead';
import { COUNTRIES } from '@/lib/countries';

type Props = { open: boolean; onOpenChange: (v: boolean) => void };

export function CreateLeadDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation('leads');
  const create = useCreateLead();
  const navigate = useNavigate();

  const [source, setSource] = useState<'manual' | 'meta' | 'import'>('manual');
  const [title, setTitle] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [company, setCompany] = useState('');
  const [country, setCountry] = useState<string>(COUNTRIES[0]?.storedValue ?? '');
  const [leadInfo, setLeadInfo] = useState('');

  const canSubmit = title.trim().length > 0 && (email.trim().length > 0 || phone.trim().length > 0);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      const id = await create.mutateAsync({
        source,
        title: title.trim(),
        contact_first_name: fullName.trim() || null,
        contact_last_name: null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        website: website.trim() || null,
        company_name: company.trim() || null,
        country: country || null,
        notes: leadInfo.trim() || null,
      });
      onOpenChange(false);
      navigate(`/leads/${id}`);
    } catch (err) {
      alert((err as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('new_lead')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <Label htmlFor="source">{t('form.source')}</Label>
            <select
              id="source"
              value={source}
              onChange={(e) => setSource(e.target.value as 'manual' | 'meta' | 'import')}
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="manual">{t('form.source_options.manual')}</option>
              <option value="meta">{t('form.source_options.meta')}</option>
              <option value="import">{t('form.source_options.import')}</option>
            </select>
          </div>
          <div>
            <Label htmlFor="title">{t('form.title')}</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="fn">{t('form.full_name')}</Label>
            <Input id="fn" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="email">{t('form.email')}</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="phone">{t('form.phone')}</Label>
            <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ws">{t('form.website')}</Label>
            <Input
              id="ws"
              type="url"
              placeholder="https://"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="co">{t('form.company_name')}</Label>
            <Input id="co" value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="cnt">{t('form.country')}</Label>
            <select
              id="cnt"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">—</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.storedValue}>
                  {c.storedValue} ({Math.round(c.vatRate * 100)}% VAT)
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="li">{t('form.lead_info')}</Label>
            <textarea
              id="li"
              value={leadInfo}
              onChange={(e) => setLeadInfo(e.target.value)}
              className="mt-1 block min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit || create.isPending}>
              {t('actions.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
