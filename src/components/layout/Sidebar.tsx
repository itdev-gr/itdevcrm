import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';
import { useAuthStore } from '@/lib/stores/authStore';

// AI SEO is folded into Web SEO + Local SEO — no separate kanban. The
// `ai_seo` permission group is still meaningful (members handle AI SEO
// jobs); they get the Web SEO + Local SEO sidebar links via the bridge
// in `visibleTechGroups` below.
const TECH_GROUPS = ['web_seo', 'local_seo', 'web_dev', 'social_media', 'hosting', 'ads'] as const;

const TECH_LABELS: Record<(typeof TECH_GROUPS)[number], string> = {
  web_seo: 'Web SEO',
  local_seo: 'Local SEO',
  web_dev: 'Web Dev',
  social_media: 'Social Media',
  hosting: 'Hosting',
  ads: 'Ads',
};

const TECH_ROUTES: Record<(typeof TECH_GROUPS)[number], string> = {
  web_seo: '/tech/web-seo',
  local_seo: '/tech/local-seo',
  web_dev: '/tech/web-dev',
  social_media: '/tech/social-media',
  hosting: '/tech/hosting',
  ads: '/tech/ads',
};

const TECH_CLIENTS_ROUTES: Record<(typeof TECH_GROUPS)[number], string> = {
  web_seo: '/tech/web-seo/clients',
  local_seo: '/tech/local-seo/clients',
  web_dev: '/tech/web-dev/clients',
  social_media: '/tech/social-media/clients',
  hosting: '/tech/hosting/clients',
  ads: '/tech/ads/clients',
};

/**
 * The nav links themselves — rendered inside the desktop <aside> and inside
 * the mobile drawer. onNavigate fires when any link is clicked (the drawer
 * uses it to close itself).
 */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const isAdmin = useAuthStore((state) => state.isAdmin);
  const groupCodes = useAuthStore((s) => s.groupCodes);
  const isSales = groupCodes.includes('sales');
  const isAccounting = groupCodes.includes('accounting');
  // AI SEO members work AI SEO jobs which now live on the Web SEO + Local SEO
  // boards, so grant them visibility into both kanbans.
  const isAiSeo = groupCodes.includes('ai_seo');
  const visibleTechGroups = isAdmin
    ? [...TECH_GROUPS]
    : TECH_GROUPS.filter(
        (g) => groupCodes.includes(g) || (isAiSeo && (g === 'web_seo' || g === 'local_seo')),
      );

  return (
    <nav
      className="flex min-h-full flex-col gap-2"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a')) onNavigate?.();
      }}
    >
      <NavLink
        to="/"
        end
        className={({ isActive }) =>
          `block rounded px-3 py-2 ${isActive ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'}`
        }
      >
        {t('nav.home')}
      </NavLink>
      {isAdmin && (
        <NavLink
          to="/dashboard"
          className={({ isActive }) =>
            `block rounded px-3 py-2 ${isActive ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'}`
          }
        >
          📊 {t('dashboard.title')}
        </NavLink>
      )}
      {(isAdmin || isSales) && (
        <div className="space-y-1 pt-2">
          <p className="px-3 text-xs font-medium uppercase text-slate-500">{t('common:nav.section.sales')}</p>
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
          <NavLink
            to="/sales/docs"
            className={({ isActive }) =>
              `block rounded px-6 py-1 text-xs ${isActive ? 'bg-slate-200 font-medium text-slate-800' : 'text-slate-600 hover:bg-slate-100'}`
            }
          >
            {t('common:nav.documentation')}
          </NavLink>
          <NavLink
            to="/contracts"
            className={({ isActive }) =>
              `block rounded px-3 py-2 ${isActive ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'}`
            }
          >
            {t('contracts:nav.title')}
          </NavLink>
        </div>
      )}
      {(isAdmin || isAccounting) && (
        <div className="space-y-1 pt-2">
          <p className="px-3 text-xs font-medium uppercase text-slate-500">{t('common:nav.section.accounting')}</p>
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
            {t('accounting:nav.recurring')}
          </NavLink>
          {isAdmin && (
            <>
              <NavLink
                to="/accounting/report"
                className={({ isActive }) =>
                  `block rounded px-3 py-2 ${isActive ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'}`
                }
              >
                {t('accounting_report:nav.report')}
              </NavLink>
              <NavLink
                to="/accounting/expenses"
                className={({ isActive }) =>
                  `block rounded px-3 py-2 ${isActive ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'}`
                }
              >
                {t('accounting_report:nav.expenses')}
              </NavLink>
            </>
          )}
        </div>
      )}
      {visibleTechGroups.length > 0 && (
        <div className="space-y-1 pt-2">
          <p className="px-3 text-xs font-medium uppercase text-slate-500">{t('common:nav.section.technical')}</p>
          {visibleTechGroups.map((g) => (
            <div key={g} className="space-y-0.5">
              <NavLink
                to={TECH_ROUTES[g]}
                end
                className={({ isActive }) =>
                  `block rounded px-3 py-2 ${isActive ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'}`
                }
              >
                {TECH_LABELS[g]}
              </NavLink>
              <NavLink
                to={TECH_CLIENTS_ROUTES[g]}
                className={({ isActive }) =>
                  `block rounded px-6 py-1 text-xs ${isActive ? 'bg-slate-200 font-medium text-slate-800' : 'text-slate-600 hover:bg-slate-100'}`
                }
              >
                {t('clients:my_clients')}
              </NavLink>
              {['local_seo', 'web_dev', 'web_seo'].includes(g) && (
                <NavLink
                  to={`${TECH_ROUTES[g]}/docs`}
                  className={({ isActive }) =>
                    `block rounded px-6 py-1 text-xs ${isActive ? 'bg-slate-200 font-medium text-slate-800' : 'text-slate-600 hover:bg-slate-100'}`
                  }
                >
                  {t('common:nav.documentation')}
                </NavLink>
              )}
            </div>
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
    </nav>
  );
}

/** Desktop sidebar — hidden below md; mobile uses the drawer in AppShell. */
export function Sidebar() {
  return (
    <aside className="hidden w-56 shrink-0 self-stretch overflow-y-auto border-r bg-slate-50 p-4 md:block">
      <SidebarNav />
    </aside>
  );
}
