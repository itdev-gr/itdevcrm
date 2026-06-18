import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
  UserAvatar,
  settingsTdClass,
  settingsThClass,
  settingsTheadClass,
  settingsTrClass,
} from '@/components/layout/page-shell';
import { useUser } from '@/features/users/hooks/useUser';
import { useUserOverrides } from './hooks/useUserOverrides';
import { useUpsertUserOverride } from './hooks/useUpsertUserOverride';
import { useDeleteUserOverride } from './hooks/useDeleteUserOverride';
import { useUserEffectivePermissions } from './hooks/useUserEffectivePermissions';
import {
  ALL_ACTIONS,
  ALL_BOARDS,
  ALL_SCOPES,
  type Action,
  type Board,
  type Scope,
} from '@/lib/permissions';

export function UserPermissionsPage() {
  const { userId = '' } = useParams<{ userId: string }>();
  const { t } = useTranslation('admin');
  const { data: user } = useUser(userId);
  const { data: overrides = [] } = useUserOverrides(userId);
  const { data: effective = [], isLoading } = useUserEffectivePermissions(userId);
  const upsert = useUpsertUserOverride();
  const del = useDeleteUserOverride();

  if (!user || isLoading) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-border/60 bg-card text-sm text-muted-foreground shadow-sm">
        …
      </div>
    );
  }

  const overrideMap = new Map(overrides.map((o) => [`${o.board}:${o.action}`, o]));
  const effectiveMap = new Map(effective.map((e) => [`${e.board}:${e.action}`, e]));

  return (
    <div className="space-y-5">
      <PageHeader title={t('permissions.user_title', { user: user.full_name || user.email })}>
        <Button asChild variant="outline" size="sm">
          <Link to={`/admin/users/${userId}`}>
            <ArrowLeft className="size-3.5" />
            {user.full_name || user.email}
          </Link>
        </Button>
      </PageHeader>

      <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
        <UserAvatar name={user.full_name} email={user.email} />
      </div>

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
                  const eff = effectiveMap.get(`${b}:${a}`);
                  const ov = overrideMap.get(`${b}:${a}`);
                  const allowed = ov ? ov.allowed : (eff?.allowed ?? false);
                  const scope = ov?.scope ?? eff?.scope ?? 'own';
                  return (
                    <td key={a} className={`${settingsTdClass} align-middle`}>
                      <div className="flex flex-col items-center gap-1.5">
                        <div className="flex items-center gap-1">
                          <Checkbox
                            checked={allowed}
                            onCheckedChange={(v) => {
                              void upsert.mutateAsync({
                                userId,
                                board: b as Board,
                                action: a as Action,
                                allowed: v === true,
                                scope,
                              });
                            }}
                          />
                          {ov && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-1"
                              onClick={() => void del.mutateAsync({ userId, id: ov.id })}
                            >
                              ×
                            </Button>
                          )}
                        </div>
                        {allowed && (
                          <Select
                            value={scope}
                            onValueChange={(s) => {
                              void upsert.mutateAsync({
                                userId,
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
                        {!ov && eff && (
                          <span className="text-[10px] text-muted-foreground">
                            {t('permissions.from_groups')}
                          </span>
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
