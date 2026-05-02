import { createBrowserRouter } from 'react-router-dom';
import { ShellLayout } from './ShellLayout';
import { SetPasswordLayout } from './SetPasswordLayout';
import { AdminLayout } from './AdminLayout';
import { HomePage } from './routes/HomePage';
import { LoginPage } from '@/features/auth/LoginPage';
import { NotFoundPage } from './routes/NotFoundPage';
import { UsersListPage } from '@/features/users/UsersListPage';
import { UserDetailPage } from '@/features/users/UserDetailPage';
import { GroupsListPage } from '@/features/permissions/GroupsListPage';
import { GroupPermissionsPage } from '@/features/permissions/GroupPermissionsPage';
import { UserPermissionsPage } from '@/features/permissions/UserPermissionsPage';
import { FieldRulesPage } from '@/features/permissions/FieldRulesPage';
import { PermissionsTestPage } from '@/features/permissions/PermissionsTestPage';
import { StagesListPage } from '@/features/stages/StagesListPage';
import { ClientsListPage } from '@/features/clients/ClientsListPage';
import { ClientDetailPage } from '@/features/clients/ClientDetailPage';
import { DealDetailPage } from '@/features/deals/DealDetailPage';
import { SalesKanbanPage } from '@/features/sales/SalesKanbanPage';
import { AccountingOnboardingKanbanPage } from '@/features/accounting/AccountingOnboardingKanbanPage';
import { AccountingRecurringPage } from '@/features/billing/AccountingRecurringPage';

export const router = createBrowserRouter([
  {
    element: <ShellLayout />,
    children: [
      { path: '/', element: <HomePage /> },
      {
        path: 'admin',
        element: <AdminLayout />,
        children: [
          { path: 'users', element: <UsersListPage /> },
          { path: 'users/:userId', element: <UserDetailPage /> },
          { path: 'users/:userId/permissions', element: <UserPermissionsPage /> },
          { path: 'groups', element: <GroupsListPage /> },
          { path: 'groups/:groupId/permissions', element: <GroupPermissionsPage /> },
          { path: 'fields', element: <FieldRulesPage /> },
          { path: 'permissions/test', element: <PermissionsTestPage /> },
          { path: 'stages', element: <StagesListPage /> },
        ],
      },
      {
        path: 'sales',
        children: [
          { path: 'clients', element: <ClientsListPage /> },
          { path: 'kanban', element: <SalesKanbanPage /> },
        ],
      },
      {
        path: 'accounting',
        children: [
          { path: 'onboarding', element: <AccountingOnboardingKanbanPage /> },
          { path: 'recurring', element: <AccountingRecurringPage /> },
        ],
      },
      { path: 'clients/:clientId', element: <ClientDetailPage /> },
      { path: 'deals/:dealId', element: <DealDetailPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  { path: '/login', element: <LoginPage /> },
  { path: '/set-password', element: <SetPasswordLayout /> },
]);
