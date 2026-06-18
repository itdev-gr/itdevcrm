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

  if (isLoading) return <p className="text-sm text-muted-foreground">…</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">{t('templates_admin.title')}</h1>
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
                      tpl.id === selectedId ? 'bg-muted font-medium' : 'hover:bg-muted'
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
              className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
            />
          </div>
          <div className="text-xs text-muted-foreground">
            {t('templates_admin.placeholders_hint')}{' '}
            {CONTRACT_PLACEHOLDERS.map((p) => (
              <code key={p} className="mr-1 rounded bg-muted px-1 py-0.5">{`{{${p}}}`}</code>
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
    </div>
  );
}
