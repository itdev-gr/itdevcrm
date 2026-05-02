import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';
import { useAuthStore } from '@/lib/stores/authStore';

export function Sidebar() {
  const { t } = useTranslation();
  const isAdmin = useAuthStore((state) => state.isAdmin);
  const groupCodes = useAuthStore((s) => s.groupCodes);
  const isSales = groupCodes.includes('sales');
  const isAccounting = groupCodes.includes('accounting');

  return (
    <aside className="hidden w-56 space-y-2 border-r bg-slate-50 p-4 md:block">
      <NavLink
        to="/"
        end
        className={({ isActive }) =>
          `block rounded px-3 py-2 ${isActive ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'}`
        }
      >
        {t('nav.home')}
      </NavLink>
      {(isAdmin || isSales) && (
        <div className="space-y-1 pt-2">
          <p className="px-3 text-xs font-medium uppercase text-slate-500">Sales</p>
          <NavLink
            to="/sales/clients"
            className={({ isActive }) =>
              `block rounded px-3 py-2 ${isActive ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'}`
            }
          >
            {t('clients:my_clients')}
          </NavLink>
          <NavLink
            to="/sales/kanban"
            className={({ isActive }) =>
              `block rounded px-3 py-2 ${isActive ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'}`
            }
          >
            {t('sales:kanban.title')}
          </NavLink>
        </div>
      )}
      {(isAdmin || isAccounting) && (
        <div className="space-y-1 pt-2">
          <p className="px-3 text-xs font-medium uppercase text-slate-500">Accounting</p>
          <NavLink
            to="/accounting/onboarding"
            className={({ isActive }) =>
              `block rounded px-3 py-2 ${isActive ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'}`
            }
          >
            {t('accounting:nav.onboarding')}
          </NavLink>
          <NavLink
            to="/accounting/recurring"
            className={({ isActive }) =>
              `block rounded px-3 py-2 ${isActive ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'}`
            }
          >
            {t('accounting:recurring.title')}
          </NavLink>
        </div>
      )}
      {isAdmin && (
        <NavLink
          to="/admin/users"
          className={({ isActive }) =>
            `block rounded px-3 py-2 ${isActive ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'}`
          }
        >
          {t('users:title')}
        </NavLink>
      )}
      {isAdmin && (
        <NavLink
          to="/admin/groups"
          className={({ isActive }) =>
            `block rounded px-3 py-2 ${isActive ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'}`
          }
        >
          {t('admin:nav.groups')}
        </NavLink>
      )}
      {isAdmin && (
        <NavLink
          to="/admin/fields"
          className={({ isActive }) =>
            `block rounded px-3 py-2 ${isActive ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'}`
          }
        >
          {t('admin:nav.fields')}
        </NavLink>
      )}
      {isAdmin && (
        <NavLink
          to="/admin/stages"
          className={({ isActive }) =>
            `block rounded px-3 py-2 ${isActive ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'}`
          }
        >
          {t('admin:nav.stages')}
        </NavLink>
      )}
    </aside>
  );
}
