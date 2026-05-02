import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AdminGuard } from '@/components/auth/AdminGuard';

const SETTINGS_TABS = [
  { to: '/admin/users', key: 'users' },
  { to: '/admin/groups', key: 'groups' },
  { to: '/admin/fields', key: 'fields' },
  { to: '/admin/stages', key: 'stages' },
  { to: '/admin/service-packages', key: 'service_packages' },
] as const;

export function AdminLayout() {
  const { t } = useTranslation('admin');
  return (
    <AdminGuard>
      <div className="space-y-4 p-6">
        <div className="sticky top-0 z-20 -mx-6 -mt-6 border-b bg-white/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-white/80">
          <h1 className="mb-2 text-2xl font-bold">{t('settings.title')}</h1>
          <nav className="flex flex-wrap gap-1">
            {SETTINGS_TABS.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                className={({ isActive }) =>
                  `rounded-md px-3 py-1.5 text-sm transition-colors ${
                    isActive ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
                  }`
                }
              >
                {t(`nav.${tab.key}`)}
              </NavLink>
            ))}
          </nav>
        </div>
        <Outlet />
      </div>
    </AdminGuard>
  );
}
