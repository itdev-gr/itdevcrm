export const queryKeys = {
  groups: () => ['groups'] as const,
  users: () => ['users'] as const,
  user: (id: string) => ['user', id] as const,
  profile: (id: string) => ['profile', id] as const,
  userGroups: (userId: string) => ['user-groups', userId] as const,
};
