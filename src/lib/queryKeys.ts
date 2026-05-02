export const queryKeys = {
  groups: () => ['groups'] as const,
  users: () => ['users'] as const,
  user: (id: string) => ['user', id] as const,
  profile: (id: string) => ['profile', id] as const,
  userGroups: (userId: string) => ['user-groups', userId] as const,
  pipelineStages: () => ['pipeline-stages'] as const,
  groupPermissions: (groupId: string) => ['group-permissions', groupId] as const,
  userOverrides: (userId: string) => ['user-overrides', userId] as const,
  effectivePermissions: (userId: string) => ['effective-permissions', userId] as const,
  fieldPermissions: () => ['field-permissions'] as const,
};
