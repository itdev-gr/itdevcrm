import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUpsertCompanyAccount, type CompanyAccountRow } from './hooks/useCompanyAccounts';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: CompanyAccountRow | null;
};

function AccountForm({ initial, onOpenChange }: { initial?: CompanyAccountRow | null; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation('admin');
  const upsert = useUpsertCompanyAccount();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  // Always starts blank on an edit: the stored password is never sent to the
  // browser just to populate a form. Blank on save = leave it as it was.
  const [password, setPassword] = useState('');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError(t('accounts.errors.title_required'));
      return;
    }
    try {
      await upsert.mutateAsync({
        id: initial?.id ?? null,
        title,
        email,
        notes,
        // null (not '') so the server keeps the stored password untouched;
        // '' would clear it.
        password: password === '' ? null : password,
      });
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <Label htmlFor="acc-title">{t('accounts.fields.title')}</Label>
        <Input
          id="acc-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('accounts.fields.title_placeholder')}
          className="mt-1"
        />
      </div>
      <div>
        <Label htmlFor="acc-email">{t('accounts.fields.email')}</Label>
        <Input
          id="acc-email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="off"
          className="mt-1"
        />
      </div>
      <div>
        <Label htmlFor="acc-password">{t('accounts.fields.password')}</Label>
        <Input
          id="acc-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          placeholder={initial?.has_password ? '••••••••' : ''}
          className="mt-1"
        />
        {initial ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {initial.has_password
              ? t('accounts.fields.password_unchanged_hint')
              : t('accounts.fields.password_none_hint')}
          </p>
        ) : null}
      </div>
      <div>
        <Label htmlFor="acc-notes">{t('accounts.fields.notes')}</Label>
        <textarea
          id="acc-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="mt-1 block min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          {t('accounts.cancel')}
        </Button>
        <Button type="submit" disabled={upsert.isPending}>
          {t('accounts.save')}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function AccountDialog({ open, onOpenChange, initial }: Props) {
  const { t } = useTranslation('admin');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? t('accounts.edit_title') : t('accounts.add_title')}</DialogTitle>
          <DialogDescription className="sr-only">{t('accounts.dialog_description')}</DialogDescription>
        </DialogHeader>
        {/* Remount per target so the useState seeds re-read — same pattern as
            ServicePackageDialog. */}
        <AccountForm key={open ? (initial?.id ?? 'new') : 'closed'} initial={initial} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}
