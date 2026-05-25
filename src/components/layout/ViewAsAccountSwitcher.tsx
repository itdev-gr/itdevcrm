import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuthStore, type ViewAsUser } from '@/lib/stores/authStore';
import { useCanViewAsAccounts } from '@/lib/viewAs';
import { useUsers, type UserRow } from '@/features/users/hooks/useUsers';

const SELF_VALUE = '__self__';

function displayName(user: Pick<UserRow, 'email' | 'full_name'>): string {
  return user.full_name?.trim() || user.email;
}

function toViewAsUser(user: UserRow): ViewAsUser {
  return {
    userId: user.user_id,
    email: user.email,
    fullName: user.full_name,
    isAdmin: user.is_admin,
    groupCodes: (user.user_groups ?? [])
      .map((row) => row.groups?.code)
      .filter((code): code is string => typeof code === 'string'),
  };
}

export function ViewAsAccountSwitcher() {
  const { t } = useTranslation();
  const canViewAs = useCanViewAsAccounts();
  const actualUserId = useAuthStore((s) => s.user?.id ?? null);
  const viewAsUser = useAuthStore((s) => s.viewAsUser);
  const setViewAsUser = useAuthStore((s) => s.setViewAsUser);
  const clearViewAsUser = useAuthStore((s) => s.clearViewAsUser);
  const { data: users = [], isLoading } = useUsers({ enabled: canViewAs });

  useEffect(() => {
    if (!viewAsUser) return;
    if (!users.some((user) => user.user_id === viewAsUser.userId)) {
      clearViewAsUser();
    }
  }, [clearViewAsUser, users, viewAsUser]);

  if (!canViewAs) return null;

  const selectableUsers = [...users].sort((a, b) => displayName(a).localeCompare(displayName(b)));
  const value = viewAsUser?.userId ?? SELF_VALUE;

  function handleChange(nextValue: string) {
    if (nextValue === SELF_VALUE) {
      clearViewAsUser();
      return;
    }
    const selected = users.find((user) => user.user_id === nextValue);
    if (selected) setViewAsUser(toViewAsUser(selected));
  }

  return (
    <div className="flex items-center gap-2">
      {viewAsUser && (
        <span className="hidden rounded-full border border-blue-300 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 md:inline-flex">
          {t('view_as.active', { name: viewAsUser.fullName || viewAsUser.email })}
        </span>
      )}
      <Select value={value} onValueChange={handleChange} disabled={isLoading}>
        <SelectTrigger size="sm" className="max-w-56" aria-label={t('view_as.label')}>
          <SelectValue placeholder={t('view_as.label')} />
        </SelectTrigger>
        <SelectContent align="end">
          <SelectItem value={SELF_VALUE}>
            {t('view_as.self', {
              email: users.find((user) => user.user_id === actualUserId)?.email ?? '',
            })}
          </SelectItem>
          {selectableUsers.map((user) => (
            <SelectItem key={user.user_id} value={user.user_id}>
              {displayName(user)}
              {user.is_admin ? ' · admin' : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
