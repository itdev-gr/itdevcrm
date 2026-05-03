import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';
import { useAuthStore } from '@/lib/stores/authStore';

const TECH_GROUPS = ['web_seo', 'local_seo', 'web_dev', 'social_media', 'ai_seo', 'hosting'] as const;

const TECH_LABELS: Record<(typeof TECH_GROUPS)[number], string> = {
  web_seo: 'Web SEO',
  local_seo: 'Local SEO',
  web_dev: 'Web Dev',
  social_media: 'Social Media',
  ai_seo: 'AI SEO',
  hosting: 'Hosting',
};

const TECH_ROUTES: Record<(typeof TECH_GROUPS)[number], string> = {
  web_seo: '/tech/web-seo',
  local_seo: '/tech/local-seo',
  web_dev: '/tech/web-dev',
  social_media: '/tech/social-media',
  ai_seo: '/tech/ai-seo',
  hosting: '/tech/hosting',
};

export function Sidebar() {
  const { t } = useTranslation();
  const isAdmin = useAuthStore((state) => state.isAdmin);
  const groupCodes = useAuthStore((s) => s.groupCodes);
  const isSales = groupCodes.includes('sales');
  const isAccounting = groupCodes.includes('accounting');
  const visibleTechGroups = isAdmin
    ? [...TECH_GROUPS]
    : TECH_GROUPS.filter((g) => groupCodes.includes(g));

  return (
    <aside className="hidden w-56 flex-col gap-2 self-stretch border-r bg-slate-50 p-4 md:flex">
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
            to="/accounting/clients"
            className={({ isActive }) =>
              `block rounded px-3 py-2 ${isActive ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'}`
            }
          >
            {t('accounting:nav.clients')}
          </NavLink>
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
            Recurring
          </NavLink>
        </div>
      )}
      {visibleTechGroups.length > 0 && (
        <div className="space-y-1 pt-2">
          <p className="px-3 text-xs font-medium uppercase text-slate-500">Technical</p>
          {visibleTechGroups.map((g) => (
            <NavLink
              key={g}
              to={TECH_ROUTES[g]}
              className={({ isActive }) =>
                `block rounded px-3 py-2 ${isActive ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'}`
              }
            >
              {TECH_LABELS[g]}
            </NavLink>
          ))}
        </div>
      )}
      {isAdmin && (
        <div className="mt-auto border-t pt-3">
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              `block rounded px-3 py-2 ${isActive ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'}`
            }
          >
            ⚙️ {t('admin:nav.settings')}
          </NavLink>
        </div>
      )}
    </aside>
  );
}
