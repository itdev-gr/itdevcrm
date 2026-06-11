import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

  function pick(id: string | null) {
    setSelectedId(id);
    const tpl = templates.find((x) => x.id === id);
    setName(tpl?.name ?? '');
    setBody(tpl?.body ?? '');
  }

  async function onSave() {
    const id = await upsert.mutateAsync(
      selectedId ? { id: selectedId, name, body } : { name, body },
    );
    setSelectedId(id);
  }

  async function onDelete() {
    if (!selectedId) return;
    if (!window.confirm(t('templates_admin.delete') + '?')) return;
    await del.mutateAsync(selectedId);
    pick(null);
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">…</p>;

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <div className="w-full space-y-2 md:w-64">
        <Button size="sm" variant="outline" onClick={() => pick(null)}>
          + {t('templates_admin.new')}
        </Button>
        {templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('templates_admin.empty')}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {templates.map((tpl) => (
              <li key={tpl.id}>
                <button
                  type="button"
                  onClick={() => pick(tpl.id)}
                  className={`block w-full px-3 py-2 text-left text-sm ${
                    tpl.id === selectedId ? 'bg-slate-100 font-medium' : 'hover:bg-slate-50'
                  }`}
                >
                  {tpl.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex-1 space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="tpl-name">{t('templates_admin.name')}</Label>
          <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tpl-body">{t('templates_admin.body')}</Label>
          <textarea
            id="tpl-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={18}
            className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
          />
        </div>
        <div className="text-xs text-slate-500">
          {t('templates_admin.placeholders_hint')}{' '}
          {CONTRACT_PLACEHOLDERS.map((p) => (
            <code key={p} className="mr-1 rounded bg-slate-100 px-1 py-0.5">{`{{${p}}}`}</code>
          ))}
        </div>
        <div className="flex gap-2">
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
    </div>
  );
}
