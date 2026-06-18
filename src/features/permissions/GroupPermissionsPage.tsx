import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  PageHeader,
  SettingsTableShell,
  settingsTdClass,
  settingsThClass,
  settingsTheadClass,
  settingsTrClass,
} from '@/components/layout/page-shell';
import {
  ALL_ACTIONS,
  ALL_BOARDS,
  ALL_SCOPES,
  type Action,
  type Board,
  type Scope,
} from '@/lib/permissions';
import { useGroupPermissions } from './hooks/useGroupPermissions';
import { useUpsertGroupPermission } from './hooks/useUpsertGroupPermission';
import { TeamLeadsBadge } from './TeamLeadsBadge';
import { useGroups } from '@/features/groups/hooks/useGroups';

export function GroupPermissionsPage() {
  const { groupId = '' } = useParams<{ groupId: string }>();
  const { t, i18n } = useTranslation('admin');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const { data: groups = [] } = useGroups();
  const group = groups.find((g) => g.id === groupId);
  const { data: rows = [], isLoading } = useGroupPermissions(groupId);
  const upsert = useUpsertGroupPermission();

  if (!group || isLoading) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-border/60 bg-card text-sm text-muted-foreground shadow-sm">
        …
      </div>
    );
  }

  const map = new Map<string, { allowed: boolean; scope: Scope }>();
  for (const r of rows) map.set(`${r.board}:${r.action}`, { allowed: r.allowed, scope: r.scope });

  return (
    <div className="space-y-5">
      <PageHeader title={t('permissions.title', { group: group.display_names[lang] })}>
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/groups">
            <ArrowLeft className="size-3.5" />
            {t('groups.title')}
          </Link>
        </Button>
      </PageHeader>

      <TeamLeadsBadge groupId={groupId} />

      <SettingsTableShell>
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead className={settingsTheadClass}>
            <tr>
              <th className={`${settingsThClass} sticky left-0 z-20 bg-muted/80`}></th>
              {ALL_ACTIONS.map((a) => (
                <th key={a} className={`${settingsThClass} align-bottom`}>
                  <div className="whitespace-nowrap">{t(`permissions.actions.${a}`)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ALL_BOARDS.map((b) => (
              <tr key={b} className={settingsTrClass}>
                <th className="sticky left-0 z-10 bg-card px-4 py-3 text-left font-medium group-hover:bg-muted/35">
                  {t(`permissions.boards.${b}`)}
                </th>
                {ALL_ACTIONS.map((a) => {
                  const cell = map.get(`${b}:${a}`);
                  const allowed = cell?.allowed ?? false;
                  const scope = cell?.scope ?? 'own';
                  return (
                    <td key={a} className={`${settingsTdClass} align-middle`}>
                      <div className="flex flex-col items-center gap-1.5">
                        <Checkbox
                          checked={allowed}
                          onCheckedChange={(v) => {
                            void upsert.mutateAsync({
                              groupId,
                              board: b as Board,
                              action: a as Action,
                              allowed: v === true,
                              scope,
                            });
                          }}
                        />
                        {allowed && (
                          <Select
                            value={scope}
                            onValueChange={(s) => {
                              void upsert.mutateAsync({
                                groupId,
                                board: b as Board,
                                action: a as Action,
                                allowed: true,
                                scope: s as Scope,
                              });
                            }}
                          >
                            <SelectTrigger className="h-7 w-20 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ALL_SCOPES.map((s) => (
                                <SelectItem key={s} value={s}>
                                  {t(`permissions.scopes.${s}`)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </SettingsTableShell>
    </div>
  );
}
