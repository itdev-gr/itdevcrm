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
  // Phase 3:
  clients: () => ['clients'] as const,
  client: (id: string) => ['client', id] as const,
  myClients: () => ['my-clients'] as const,
  deals: (filters?: Record<string, string | undefined>) =>
    filters ? (['deals', filters] as const) : (['deals'] as const),
  deal: (id: string) => ['deal', id] as const,
  jobsForClient: (clientId: string) => ['jobs', 'client', clientId] as const,
  comments: (parentType: string, parentId: string) => ['comments', parentType, parentId] as const,
  attachments: (parentType: string, parentId: string) =>
    ['attachments', parentType, parentId] as const,
  activity: (entityType: string, entityId: string) => ['activity', entityType, entityId] as const,
  notifications: () => ['notifications'] as const,
  assignedTasksOpen: (assigneeId: string | null) =>
    ['assigned-tasks', 'open', assigneeId ?? 'all'] as const,
  assignedTaskDetail: (taskId: string) => ['assigned-task', taskId] as const,
  assignedTasksForDeal: (dealId: string) =>
    ['assigned-tasks', 'deal', dealId] as const,
  assignedTasksForJob: (jobId: string) =>
    ['assigned-tasks', 'job', jobId] as const,
  savedFilters: (board: string) => ['saved-filters', board] as const,
  accountingDeals: () => ['accounting-deals'] as const,
  clientBlock: (clientId: string) => ['client-block', clientId] as const,
  leads: (filters?: Record<string, string | undefined>) =>
    filters ? (['leads', filters] as const) : (['leads'] as const),
  lead: (id: string) => ['lead', id] as const,
  scheduledLeads: (start: string, end: string, ownerId: string | null) =>
    ['scheduled-leads', start, end, ownerId ?? 'all'] as const,
  userTasks: (start: string, end: string, ownerId: string | null) =>
    ['user-tasks', start, end, ownerId ?? 'all'] as const,
  servicePackages: () => ['service-packages'] as const,
  serviceSubpackages: (parentId: string) => ['service-subpackages', parentId] as const,
  jobsByService: (serviceType: string) => ['jobs', 'service', serviceType] as const,
  jobsForDeal: (dealId: string) => ['jobs', 'deal', dealId] as const,
  job: (id: string) => ['job', id] as const,
  jobMonthlyTasks: (id: string) => ['job-monthly-tasks', id] as const,
  monthlyTaskTemplate: (serviceType: string) =>
    ['monthly-task-template', serviceType] as const,
  techMyClients: (serviceType: string) => ['tech-my-clients', serviceType] as const,
  recurringClients: () => ['recurring-clients'] as const,
  offerCatalog: () => ['offer-catalog'] as const,
  offer: (id: string) => ['offer', id] as const,
  offersForLead: (leadId: string) => ['offers', 'lead', leadId] as const,
  offersForDeal: (dealId: string) => ['offers', 'deal', dealId] as const,
  expenseCategories: () => ['expense-categories'] as const,
  expenses: (filters?: Record<string, string | undefined>) =>
    filters ? (['expenses', filters] as const) : (['expenses'] as const),
  expense: (id: string) => ['expense', id] as const,
  accountingLedger: (from: string, to: string) =>
    ['accounting-ledger', from, to] as const,
  accountingPLSummary: (from: string, to: string) =>
    ['accounting-pl-summary', from, to] as const,
};
