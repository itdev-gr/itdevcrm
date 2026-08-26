import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AdminGuard } from '@/components/auth/AdminGuard';
import { PageHeader, SettingsCard, SettingsNav } from '@/components/layout/page-shell';

const SETTINGS_TABS = [
  { to: '/admin/users', key: 'users' },
  { to: '/admin/groups', key: 'groups' },
  { to: '/admin/fields', key: 'fields' },
  { to: '/admin/stages', key: 'stages' },
  { to: '/admin/service-packages', key: 'service_packages' },
  { to: '/admin/sales-automations', key: 'sales_automations' },
  { to: '/admin/email-automations', key: 'email_automations' },
  { to: '/admin/email-health', key: 'email_health' },
  { to: '/admin/shared-mailboxes', key: 'shared_mailboxes' },
  { to: '/admin/contract-templates', key: 'contract_templates' },
  { to: '/admin/announcements', key: 'announcements' },
  { to: '/admin/documentation', key: 'documentation' },
] as const;

export function AdminLayout() {
  const { t } = useTranslation('admin');
  const tabs = SETTINGS_TABS.map((tab) => ({
    to: tab.to,
    label: t(`nav.${tab.key}`),
  }));

  return (
    <AdminGuard>
      <div className="flex min-h-full flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <SettingsCard className="p-5">
          <PageHeader title={t('settings.title')} />
          <div className="mt-4">
            <SettingsNav tabs={tabs} />
          </div>
        </SettingsCard>
        <Outlet />
      </div>
    </AdminGuard>
  );
}
