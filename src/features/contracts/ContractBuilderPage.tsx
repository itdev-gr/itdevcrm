import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useClient } from '@/features/clients/hooks/useClient';
import { useLead } from '@/features/leads/hooks/useLead';
import {
  buildPlaceholderData,
  leadToPlaceholderFields,
  resolvePlaceholders,
} from '@/lib/contracts/placeholders';
import { useContractTemplates } from './hooks/useContractTemplates';
import { useCreateContract } from './hooks/useCreateContract';

export function ContractBuilderPage() {
  const [params] = useSearchParams();
  const clientId = params.get('clientId') ?? '';
  const leadId = params.get('leadId') ?? '';
  const navigate = useNavigate();
  const { t } = useTranslation('contracts');
  const { data: client, isLoading: clientLoading } = useClient(clientId);
  const { data: lead, isLoading: leadLoading } = useLead(leadId);
  const { data: templates = [] } = useContractTemplates();
  const create = useCreateContract();
  const [templateId, setTemplateId] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [dirty, setDirty] = useState(false);

  if (!clientId && !leadId)
    return <div className="p-8 text-red-600 dark:text-red-400">{t('builder.missing_party')}</div>;
  if (clientId ? clientLoading : leadLoading) return <div className="p-8">…</div>;
  const party = clientId ? client : lead;
  if (!party) return <div className="p-8 text-red-600 dark:text-red-400">Not found</div>;

  const partyName = client ? client.name : (lead?.company_name ?? lead?.title ?? '');

  function onPickTemplate(id: string) {
    if (dirty && body.trim() !== '' && !window.confirm(t('builder.replace_edits'))) return;
    setTemplateId(id);
    const tpl = templates.find((x) => x.id === id);
    if (!tpl) return;
    const fields = client ?? (lead ? leadToPlaceholderFields(lead) : null);
    if (fields) {
      setTitle(tpl.name);
      setBody(resolvePlaceholders(tpl.body, buildPlaceholderData(fields)));
      setDirty(false);
    }
  }

  async function onSave() {
    try {
      const id = await create.mutateAsync({
        client_id: clientId || null,
        lead_id: leadId || null,
        template_id: templateId || null,
        title,
        body,
      });
      navigate(`/contracts/${id}`);
    } catch (err) {
      window.alert((err as Error).message ?? String(err));
    }
  }

  return (
    <div className="flex min-h-full flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-bold">{t('builder.title')}</h1>
        <p className="text-sm text-muted-foreground">{partyName}</p>
      </div>
      <div className="max-w-3xl space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="ct-template">{t('builder.template')}</Label>
          <select
            id="ct-template"
            value={templateId}
            onChange={(e) => onPickTemplate(e.target.value)}
            className="block w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
          >
            <option value="">{t('builder.pick_template')}</option>
            {templates.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ct-title">{t('builder.contract_title')}</Label>
          <Input
            id="ct-title"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setDirty(true);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ct-body">{t('builder.body')}</Label>
          <textarea
            id="ct-body"
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setDirty(true);
            }}
            rows={20}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <p className="text-xs text-muted-foreground">{t('builder.hint')}</p>
        </div>
        <Button onClick={onSave} disabled={!title.trim() || create.isPending}>
          {t('actions.create')}
        </Button>
      </div>
    </div>
  );
}
