import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  FilterBar,
  PageHeader,
  SettingsTableShell,
  settingsTdClass,
  settingsThClass,
  settingsTheadClass,
  settingsTrClass,
} from '@/components/layout/page-shell';
import { useGroups } from '@/features/groups/hooks/useGroups';
import { useUsers } from '@/features/users/hooks/useUsers';
import { useFieldRules } from './hooks/useFieldRules';
import { useUpsertFieldRule } from './hooks/useUpsertFieldRule';
import { useDeleteFieldRule } from './hooks/useDeleteFieldRule';

const KNOWN_TABLES = ['leads', 'clients', 'deals', 'jobs', 'profiles'] as const;

type DraftState = {
  scope_type: 'group' | 'user';
  scope_id: string;
  table_name: string;
  field_name: string;
  mode: 'hidden' | 'readonly';
};

export function FieldRulesPage() {
  const { t, i18n } = useTranslation('admin');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const { data: groups = [] } = useGroups();
  const { data: users = [] } = useUsers();
  const { data: rules = [], isLoading } = useFieldRules();
  const upsert = useUpsertFieldRule();
  const del = useDeleteFieldRule();

  const [draft, setDraft] = useState<DraftState>({
    scope_type: 'group',
    scope_id: '',
    table_name: 'clients',
    field_name: '',
    mode: 'readonly',
  });

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-border/60 bg-card text-sm text-muted-foreground shadow-sm">
        …
      </div>
    );
  }

  function labelForScope(scopeType: 'group' | 'user', scopeId: string): string {
    if (scopeType === 'group') {
      const g = groups.find((x) => x.id === scopeId);
      return g ? g.display_names[lang] : scopeId;
    }
    const u = users.find((x) => x.user_id === scopeId);
    return u ? u.email : scopeId;
  }

  return (
    <div className="space-y-5">
      <PageHeader title={t('fields.title')} />

      <FilterBar className="grid gap-4 lg:grid-cols-6">
        <div>
          <Label className="text-xs text-muted-foreground">{t('fields.scope_type')}</Label>
          <Select
            value={draft.scope_type}
            onValueChange={(v) =>
              setDraft({ ...draft, scope_type: v as 'group' | 'user', scope_id: '' })
            }
          >
            <SelectTrigger className="mt-1.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="group">Group</SelectItem>
              <SelectItem value="user">User</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">{t('fields.scope_value')}</Label>
          <Select value={draft.scope_id} onValueChange={(v) => setDraft({ ...draft, scope_id: v })}>
            <SelectTrigger className="mt-1.5">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              {draft.scope_type === 'group'
                ? groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.display_names[lang]}
                    </SelectItem>
                  ))
                : users.map((u) => (
                    <SelectItem key={u.user_id} value={u.user_id}>
                      {u.email}
                    </SelectItem>
                  ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">{t('fields.table')}</Label>
          <Select
            value={draft.table_name}
            onValueChange={(v) => setDraft({ ...draft, table_name: v })}
          >
            <SelectTrigger className="mt-1.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KNOWN_TABLES.map((tn) => (
                <SelectItem key={tn} value={tn}>
                  {tn}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">{t('fields.field')}</Label>
          <Input
            className="mt-1.5"
            value={draft.field_name}
            onChange={(e) => setDraft({ ...draft, field_name: e.target.value })}
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">{t('fields.mode')}</Label>
          <Select
            value={draft.mode}
            onValueChange={(v) => setDraft({ ...draft, mode: v as 'hidden' | 'readonly' })}
          >
            <SelectTrigger className="mt-1.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hidden">{t('fields.modes.hidden')}</SelectItem>
              <SelectItem value="readonly">{t('fields.modes.readonly')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end">
          <Button
            className="w-full"
            onClick={() => {
              if (!draft.scope_id || !draft.field_name) return;
              void upsert
                .mutateAsync(draft)
                .then(() => setDraft({ ...draft, scope_id: '', field_name: '' }));
            }}
            disabled={upsert.isPending}
          >
            {t('fields.add')}
          </Button>
        </div>
      </FilterBar>

      <SettingsTableShell>
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead className={settingsTheadClass}>
            <tr>
              <th className={settingsThClass}>{t('fields.scope_type')}</th>
              <th className={settingsThClass}>{t('fields.scope_value')}</th>
              <th className={settingsThClass}>{t('fields.table')}</th>
              <th className={settingsThClass}>{t('fields.field')}</th>
              <th className={settingsThClass}>{t('fields.mode')}</th>
              <th className={settingsThClass}></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} className={settingsTrClass}>
                <td className={`${settingsTdClass} capitalize`}>{r.scope_type}</td>
                <td className={settingsTdClass}>{labelForScope(r.scope_type, r.scope_id)}</td>
                <td className={`${settingsTdClass} font-mono text-xs`}>{r.table_name}</td>
                <td className={`${settingsTdClass} font-mono text-xs`}>{r.field_name}</td>
                <td className={settingsTdClass}>
                  <span className="inline-flex rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
                    {t(`fields.modes.${r.mode}`)}
                  </span>
                </td>
                <td className={settingsTdClass}>
                  <Button variant="destructive" size="sm" onClick={() => void del.mutateAsync(r.id)}>
                    {t('fields.delete')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SettingsTableShell>
    </div>
  );
}
