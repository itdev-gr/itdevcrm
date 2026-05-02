import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { useGroups } from '@/features/groups/hooks/useGroups';

export function GroupPermissionsPage() {
  const { groupId = '' } = useParams<{ groupId: string }>();
  const { t, i18n } = useTranslation('admin');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const { data: groups = [] } = useGroups();
  const group = groups.find((g) => g.id === groupId);
  const { data: rows = [], isLoading } = useGroupPermissions(groupId);
  const upsert = useUpsertGroupPermission();

  if (!group) return <div className="p-8">…</div>;
  if (isLoading) return <div className="p-8">…</div>;

  const map = new Map<string, { allowed: boolean; scope: Scope }>();
  for (const r of rows) map.set(`${r.board}:${r.action}`, { allowed: r.allowed, scope: r.scope });

  return (
    <div className="space-y-4 p-8">
      <h1 className="text-2xl font-bold">
        {t('permissions.title', { group: group.display_names[lang] })}
      </h1>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b bg-slate-50 text-left">
              <th className="sticky left-0 z-10 bg-slate-50 py-2 px-3"></th>
              {ALL_ACTIONS.map((a) => (
                <th key={a} className="py-2 px-2 align-bottom">
                  <div className="text-xs whitespace-nowrap">{t(`permissions.actions.${a}`)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ALL_BOARDS.map((b) => (
              <tr key={b} className="border-b">
                <th className="sticky left-0 z-10 bg-white py-2 px-3 text-left font-medium">
                  {t(`permissions.boards.${b}`)}
                </th>
                {ALL_ACTIONS.map((a) => {
                  const cell = map.get(`${b}:${a}`);
                  const allowed = cell?.allowed ?? false;
                  const scope = cell?.scope ?? 'own';
                  return (
                    <td key={a} className="py-2 px-2 align-middle">
                      <div className="flex flex-col items-center gap-1">
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
      </div>
    </div>
  );
}
