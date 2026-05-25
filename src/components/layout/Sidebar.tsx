import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';
import { useEffectiveGroupCodes, useEffectiveIsAdmin } from '@/lib/viewAs';

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

export function Sidebar() {
  const { t } = useTranslation();
  const isAdmin = useEffectiveIsAdmin();
  const groupCodes = useEffectiveGroupCodes();
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
    </aside>
  );
}
