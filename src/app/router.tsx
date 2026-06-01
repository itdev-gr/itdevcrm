import { lazy, type ComponentType } from 'react';
import { createBrowserRouter, Outlet } from 'react-router-dom';
import { RequireGroup } from '@/components/auth/RequireGroup';
import { AdminGuard } from '@/components/auth/AdminGuard';
import { ShellLayout } from './ShellLayout';
import { SetPasswordLayout } from './SetPasswordLayout';
import { AdminLayout } from './AdminLayout';

// Lazily load every page so each lands in its own chunk and the initial
// JS payload stays small. Components are named exports, so map them to
// `default` for `React.lazy`.
function lazyPage<K extends string>(
  importer: () => Promise<Record<K, ComponentType<unknown>>>,
  name: K,
) {
  return lazy(() => importer().then((mod) => ({ default: mod[name] })));
}

const HomePage = lazyPage(() => import('./routes/HomePage'), 'HomePage');
const NotFoundPage = lazyPage(() => import('./routes/NotFoundPage'), 'NotFoundPage');
const LoginPage = lazyPage(() => import('@/features/auth/LoginPage'), 'LoginPage');
const UsersListPage = lazyPage(() => import('@/features/users/UsersListPage'), 'UsersListPage');
const UserDetailPage = lazyPage(() => import('@/features/users/UserDetailPage'), 'UserDetailPage');
const GroupsListPage = lazyPage(
  () => import('@/features/permissions/GroupsListPage'),
  'GroupsListPage',
);
const GroupPermissionsPage = lazyPage(
  () => import('@/features/permissions/GroupPermissionsPage'),
  'GroupPermissionsPage',
);
const UserPermissionsPage = lazyPage(
  () => import('@/features/permissions/UserPermissionsPage'),
  'UserPermissionsPage',
);
const FieldRulesPage = lazyPage(
  () => import('@/features/permissions/FieldRulesPage'),
  'FieldRulesPage',
);
const PermissionsTestPage = lazyPage(
  () => import('@/features/permissions/PermissionsTestPage'),
  'PermissionsTestPage',
);
const StagesListPage = lazyPage(() => import('@/features/stages/StagesListPage'), 'StagesListPage');
const ServicePackagesPage = lazyPage(
  () => import('@/features/service_packages/ServicePackagesPage'),
  'ServicePackagesPage',
);
const MyProfilePage = lazyPage(() => import('@/features/users/MyProfilePage'), 'MyProfilePage');
const ClientsListPage = lazyPage(
  () => import('@/features/clients/ClientsListPage'),
  'ClientsListPage',
);
const ClientDetailPage = lazyPage(
  () => import('@/features/clients/ClientDetailPage'),
  'ClientDetailPage',
);
const DealDetailPage = lazyPage(() => import('@/features/deals/DealDetailPage'), 'DealDetailPage');
const LeadDetailPage = lazyPage(() => import('@/features/leads/LeadDetailPage'), 'LeadDetailPage');
const SalesKanbanPage = lazyPage(
  () => import('@/features/sales/SalesKanbanPage'),
  'SalesKanbanPage',
);
const AccountingOnboardingKanbanPage = lazyPage(
  () => import('@/features/accounting/AccountingOnboardingKanbanPage'),
  'AccountingOnboardingKanbanPage',
);
const AccountingClientsPage = lazyPage(
  () => import('@/features/accounting/AccountingClientsPage'),
  'AccountingClientsPage',
);
const AccountingRecurringPage = lazyPage(
  () => import('@/features/accounting/AccountingRecurringPage'),
  'AccountingRecurringPage',
);
const AccountingReportPage = lazyPage(
  () => import('@/features/accounting_report/ReportPage'),
  'ReportPage',
);
const AccountingExpensesPage = lazyPage(
  () => import('@/features/accounting_report/ExpensesPage'),
  'ExpensesPage',
);
// JobsKanbanPage takes a `serviceType` prop, so we can't go through the
// unknown-typed lazyPage helper — invoke React.lazy directly to preserve the
// original component's prop signature. The fast-refresh-only-export-components
// rule misreads the lazy() pattern; intent is component, not utility.
 
const JobsKanbanPage = lazy(() =>
  import('@/features/jobs/JobsKanbanPage').then((m) => ({ default: m.JobsKanbanPage })),
);
const JobDetailPage = lazyPage(() => import('@/features/jobs/JobDetailPage'), 'JobDetailPage');
const TechMyClientsPage = lazyPage(
  () => import('@/features/tech/TechMyClientsPage'),
  'TechMyClientsPage',
);
const OfferBuilderPage = lazyPage(
  () => import('@/features/offers/OfferBuilderPage'),
  'OfferBuilderPage',
);
const OfferDetailPage = lazyPage(
  () => import('@/features/offers/OfferDetailPage'),
  'OfferDetailPage',
);

export const router = createBrowserRouter([
  {
    element: <ShellLayout />,
    children: [
      { path: '/', element: <HomePage /> },
      {
        path: 'admin',
        element: <AdminLayout />,
        children: [
          { index: true, element: <UsersListPage /> },
          { path: 'users', element: <UsersListPage /> },
          { path: 'users/:userId', element: <UserDetailPage /> },
          { path: 'users/:userId/permissions', element: <UserPermissionsPage /> },
          { path: 'groups', element: <GroupsListPage /> },
          { path: 'groups/:groupId/permissions', element: <GroupPermissionsPage /> },
          { path: 'fields', element: <FieldRulesPage /> },
          { path: 'permissions/test', element: <PermissionsTestPage /> },
          { path: 'stages', element: <StagesListPage /> },
          { path: 'service-packages', element: <ServicePackagesPage /> },
        ],
      },
      {
        path: 'sales',
        element: (
          <RequireGroup groups={['sales']}>
            <Outlet />
          </RequireGroup>
        ),
        children: [
          { path: 'clients', element: <ClientsListPage /> },
          { path: 'kanban', element: <SalesKanbanPage /> },
        ],
      },
      {
        path: 'accounting',
        element: (
          <RequireGroup groups={['accounting']}>
            <Outlet />
          </RequireGroup>
        ),
        children: [
          { path: 'onboarding', element: <AccountingOnboardingKanbanPage /> },
          { path: 'clients', element: <AccountingClientsPage /> },
          { path: 'recurring', element: <AccountingRecurringPage /> },
          { path: 'report', element: <AdminGuard><AccountingReportPage /></AdminGuard> },
          { path: 'expenses', element: <AdminGuard><AccountingExpensesPage /></AdminGuard> },
        ],
      },
      {
        path: 'tech',
        element: (
          <RequireGroup
            groups={['web_seo', 'local_seo', 'web_dev', 'social_media', 'ai_seo', 'hosting', 'ads']}
          >
            {/* ai_seo stays in the access list so AI-SEO members can reach
                /tech/web-seo and /tech/local-seo, where their jobs live. */}
            <Outlet />
          </RequireGroup>
        ),
        children: [
          { path: 'web-seo', element: <JobsKanbanPage serviceType="web_seo" /> },
          { path: 'local-seo', element: <JobsKanbanPage serviceType="local_seo" /> },
          { path: 'web-dev', element: <JobsKanbanPage serviceType="web_dev" /> },
          { path: 'social-media', element: <JobsKanbanPage serviceType="social_media" /> },
          { path: 'hosting', element: <JobsKanbanPage serviceType="hosting" /> },
          { path: 'ads', element: <JobsKanbanPage serviceType="ads" /> },
          { path: ':serviceType/clients', element: <TechMyClientsPage /> },
        ],
      },
      { path: 'clients/:clientId', element: <ClientDetailPage /> },
      { path: 'deals/:dealId', element: <DealDetailPage /> },
      { path: 'jobs/:jobId', element: <JobDetailPage /> },
      { path: 'leads/:leadId', element: <LeadDetailPage /> },
      { path: 'leads/:leadId/offers/new', element: <OfferBuilderPage /> },
      { path: 'offers/:offerId', element: <OfferDetailPage /> },
      { path: 'profile', element: <MyProfilePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  { path: '/login', element: <LoginPage /> },
  { path: '/set-password', element: <SetPasswordLayout /> },
]);
