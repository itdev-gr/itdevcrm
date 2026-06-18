import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader, SettingsCard } from '@/components/layout/page-shell';
import { cn } from '@/lib/utils';
import { CONTRACT_PLACEHOLDERS } from '@/lib/contracts/placeholders';
import {
  useContractTemplates,
  useUpsertContractTemplate,
  useDeleteContractTemplate,
} from './hooks/useContractTemplates';

export function ContractTemplatesPage() {
  const { t } = useTranslation('contracts');
  const { data: templates = [], isLoading } = useContractTemplates();
  const upsert = useUpsertContractTemplate();
  const del = useDeleteContractTemplate();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [dirty, setDirty] = useState(false);

  function pick(id: string | null) {
    if (dirty && !window.confirm(t('templates_admin.discard_changes'))) return;
    setSelectedId(id);
    const tpl = templates.find((x) => x.id === id);
    setName(tpl?.name ?? '');
    setBody(tpl?.body ?? '');
    setDirty(false);
  }

  async function onSave() {
    try {
      const id = await upsert.mutateAsync(
        selectedId ? { id: selectedId, name, body } : { name, body },
      );
      setSelectedId(id);
      setDirty(false);
    } catch (err) {
      alert((err as Error).message);
    }
  }

  async function onDelete() {
    if (!selectedId) return;
    if (!window.confirm(t('templates_admin.confirm_delete'))) return;
    try {
      await del.mutateAsync(selectedId);
      setSelectedId(null);
      setName('');
      setBody('');
      setDirty(false);
    } catch (err) {
      alert((err as Error).message);
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-border/60 bg-card text-sm text-muted-foreground shadow-sm">
        …
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title={t('templates_admin.title')} />

      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <SettingsCard className="p-4">
          <Button size="sm" variant="outline" className="mb-3 w-full" onClick={() => pick(null)}>
            <Plus className="size-3.5" />
            {t('templates_admin.new')}
          </Button>
          {templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('templates_admin.empty')}</p>
          ) : (
            <ul className="space-y-1">
              {templates.map((tpl) => (
                <li key={tpl.id}>
                  <button
                    type="button"
                    onClick={() => pick(tpl.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                      tpl.id === selectedId
                        ? 'bg-primary/10 font-medium text-primary dark:text-[#7ad4d4]'
                        : 'hover:bg-muted/50',
                    )}
                  >
                    <FileText className="size-4 shrink-0 opacity-70" />
                    <span className="truncate">{tpl.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SettingsCard>

        <SettingsCard className="p-5">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-name">{t('templates_admin.name')}</Label>
              <Input
                id="tpl-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setDirty(true);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-body">{t('templates_admin.body')}</Label>
              <textarea
                id="tpl-body"
                value={body}
                onChange={(e) => {
                  setBody(e.target.value);
                  setDirty(true);
                }}
                rows={18}
                className="w-full rounded-lg border border-input/80 bg-background px-3 py-2 font-mono text-sm shadow-sm focus:border-[#1a9696]/40 focus:outline-none focus:ring-2 focus:ring-[#1a9696]/20"
              />
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
              {t('templates_admin.placeholders_hint')}{' '}
              {CONTRACT_PLACEHOLDERS.map((p) => (
                <code key={p} className="mr-1 rounded bg-muted px-1 py-0.5">{`{{${p}}}`}</code>
              ))}
            </div>
            <div className="flex gap-2 border-t border-border/60 pt-4">
              <Button onClick={onSave} disabled={!name.trim() || upsert.isPending}>
                {t('templates_admin.save')}
              </Button>
              {selectedId && (
                <Button variant="destructive" onClick={onDelete} disabled={del.isPending}>
                  {t('templates_admin.delete')}
                </Button>
              )}
            </div>
          </div>
        </SettingsCard>
      </div>
    </div>
  );
}
