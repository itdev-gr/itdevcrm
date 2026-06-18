import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { PageHeader, SettingsCard, UserAvatar } from '@/components/layout/page-shell';
import { useUser } from './hooks/useUser';
import { useUpdateUser } from './hooks/useUpdateUser';
import { useUpdateUserGroups } from './hooks/useUpdateUserGroups';
import { useDeactivateUser } from './hooks/useDeactivateUser';
import { useSetTeamLead } from './hooks/useSetTeamLead';
import { useGroups } from '@/features/groups/hooks/useGroups';
import { ManageGroupsField } from './ManageGroupsField';

type UserRow = NonNullable<ReturnType<typeof useUser>['data']>;

function UserDetailForm({ user, userId }: { user: UserRow; userId: string }) {
  const { t } = useTranslation('users');
  const { data: groups = [] } = useGroups();
  const updateUser = useUpdateUser();
  const updateGroups = useUpdateUserGroups();
  const deactivate = useDeactivateUser();
  const setTeamLead = useSetTeamLead();

  const [fullName, setFullName] = useState(() => user.full_name ?? '');
  const [isAdmin, setIsAdmin] = useState(() => user.is_admin);
  const [groupCodes, setGroupCodes] = useState<string[]>(() =>
    (user.user_groups ?? [])
      .map((row) => row.groups?.code)
      .filter((c): c is string => typeof c === 'string'),
  );

  async function onSave() {
    await updateUser.mutateAsync({ userId, full_name: fullName, is_admin: isAdmin });
    const codeToId = new Map(groups.map((g) => [g.code, g.id]));
    const groupIds = groupCodes.map((c) => codeToId.get(c)).filter((id): id is string => !!id);
    await updateGroups.mutateAsync({ userId, groupIds });
  }

  return (
    <div className="space-y-5">
      <PageHeader title={user.full_name || user.email}>
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/users">
            <ArrowLeft className="size-3.5" />
            {t('title')}
          </Link>
        </Button>
      </PageHeader>

      <SettingsCard className="p-5">
        <div className="mb-6 border-b border-border/60 pb-5">
          <UserAvatar name={user.full_name} email={user.email} />
        </div>

        <div className="space-y-5">
          <div>
            <Label htmlFor="full_name">{t('table.name')}</Label>
            <Input
              id="full_name"
              className="mt-1.5"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
          <div>
            <Label>Email</Label>
            <Input className="mt-1.5" value={user.email} disabled />
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/25 px-3 py-2.5">
            <Checkbox
              id="is_admin"
              checked={isAdmin}
              onCheckedChange={(v) => setIsAdmin(v === true)}
            />
            <Label htmlFor="is_admin">{t('table.admin')}</Label>
          </div>
          <div>
            <Label>{t('table.groups')}</Label>
            <div className="mt-1.5">
              <ManageGroupsField selected={groupCodes} onChange={setGroupCodes} />
            </div>
          </div>

          {(user.user_groups ?? []).filter((ug) => ug.groups).length > 0 && (
            <div>
              <Label>Team leadership</Label>
              <p className="mb-2 text-xs text-muted-foreground">
                Auto-assign new jobs of these services to this user when the deal moves to Partial /
                Paid In Full.
              </p>
              <ul className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3">
                {(user.user_groups ?? [])
                  .filter((ug) => ug.groups)
                  .map((ug) => {
                    const groupId = ug.groups!.id;
                    const groupCode = ug.groups!.code;
                    const checked = !!ug.is_team_lead;
                    return (
                      <li key={groupId} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          id={`team-lead-${groupId}`}
                          checked={checked}
                          disabled={setTeamLead.isPending}
                          onCheckedChange={(v) => {
                            setTeamLead.mutate({
                              userId,
                              groupId,
                              isLead: v === true,
                            });
                          }}
                        />
                        <Label htmlFor={`team-lead-${groupId}`} className="font-normal">
                          {groupCode}
                        </Label>
                      </li>
                    );
                  })}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-2 border-t border-border/60 pt-5">
            <Button onClick={onSave} disabled={updateUser.isPending || updateGroups.isPending}>
              Save
            </Button>
            {user.is_active ? (
              <Button
                variant="destructive"
                onClick={() => deactivate.mutate(userId)}
                disabled={deactivate.isPending}
              >
                {t('actions.deactivate')}
              </Button>
            ) : (
              <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-sm text-muted-foreground">
                {t('actions.deactivated')}
              </span>
            )}
            <Button asChild variant="outline">
              <Link to={`/admin/users/${userId}/permissions`}>
                <Shield className="size-3.5" />
                Permissions
              </Link>
            </Button>
          </div>
        </div>
      </SettingsCard>
    </div>
  );
}

export function UserDetailPage() {
  const { userId = '' } = useParams<{ userId: string }>();
  const { data: user, isLoading, error } = useUser(userId);

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-border/60 bg-card text-sm text-muted-foreground shadow-sm">
        …
      </div>
    );
  }
  if (error || !user) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
        {error?.message}
      </div>
    );
  }

  return <UserDetailForm key={userId} user={user} userId={userId} />;
}
