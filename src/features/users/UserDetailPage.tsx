import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useUser } from './hooks/useUser';
import { useUpdateUser } from './hooks/useUpdateUser';
import { useUpdateUserGroups } from './hooks/useUpdateUserGroups';
import { useDeactivateUser } from './hooks/useDeactivateUser';
import { useGroups } from '@/features/groups/hooks/useGroups';
import { ManageGroupsField } from './ManageGroupsField';

type UserRow = NonNullable<ReturnType<typeof useUser>['data']>;

function UserDetailForm({ user, userId }: { user: UserRow; userId: string }) {
  const { t } = useTranslation('users');
  const { data: groups = [] } = useGroups();
  const updateUser = useUpdateUser();
  const updateGroups = useUpdateUserGroups();
  const deactivate = useDeactivateUser();

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
    <div className="space-y-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{user.full_name || user.email}</h1>
        <Link to="/admin/users" className="text-sm text-blue-600 underline">
          ←
        </Link>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="full_name">{t('table.name')}</Label>
          <Input id="full_name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div>
          <Label>Email</Label>
          <Input value={user.email} disabled />
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="is_admin"
            checked={isAdmin}
            onCheckedChange={(v) => setIsAdmin(v === true)}
          />
          <Label htmlFor="is_admin">{t('table.admin')}</Label>
        </div>
        <div>
          <Label>{t('table.groups')}</Label>
          <ManageGroupsField selected={groupCodes} onChange={setGroupCodes} />
        </div>

        <div className="flex gap-2">
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
            <span className="text-sm text-muted-foreground">{t('actions.deactivated')}</span>
          )}
          <Link
            to={`/admin/users/${userId}/permissions`}
            className="text-sm text-blue-600 underline"
          >
            Permissions
          </Link>
        </div>
      </div>
    </div>
  );
}

export function UserDetailPage() {
  const { userId = '' } = useParams<{ userId: string }>();
  const { data: user, isLoading, error } = useUser(userId);

  if (isLoading) return <div className="p-8">…</div>;
  if (error || !user) return <div className="p-8 text-red-600">{error?.message}</div>;

  return <UserDetailForm key={userId} user={user} userId={userId} />;
}
