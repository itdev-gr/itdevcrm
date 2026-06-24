import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';
import {
  BarChart3,
  Building2,
  ClipboardList,
  Columns3,
  FileText,
  Globe,
  Home,
  ListChecks,
  Megaphone,
  Receipt,
  RefreshCw,
  Server,
  Settings,
  Share2,
  ShieldAlert,
  Target,
  Users,
  Code2,
} from 'lucide-react';
import { useAuthStore } from '@/lib/stores/authStore';
import { useLeadIntakeCount } from '@/features/leads/hooks/useLeadIntake';
import { useTaskBadgeCounts } from '@/features/tasks/hooks/useTaskBadgeCounts';
import { sidebarLinkClass, sidebarSectionClass } from './sidebar-nav-styles';

function LeadIntakeBadge() {
  const { data } = useLeadIntakeCount();
  if (!data) return null;
  return (
    <span className="ml-auto rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white">
      {data}
    </span>
  );
}

// Two pills next to "Tasks": yellow = arrived since you last opened the page,
// green = your total open tasks.
function TasksBadges() {
  const { total, newCount } = useTaskBadgeCounts();
  if (total === 0 && newCount === 0) return null;
  return (
    <span className="ml-auto flex items-center gap-1">
      {newCount > 0 && (
        <span className="rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white">
          {newCount}
        </span>
      )}
      {total > 0 && (
        <span className="rounded-full bg-emerald-600 px-1.5 text-xs font-semibold text-white">
          {total}
        </span>
      )}
    </span>
  );
}

const TECH_GROUPS = ['web_seo', 'local_seo', 'web_dev', 'social_media', 'hosting', 'ads'] as const;

const TECH_LABELS: Record<(typeof TECH_GROUPS)[number], string> = {
  web_seo: 'Web SEO',
  local_seo: 'Local SEO',
  web_dev: 'Web Dev',
  social_media: 'Social Media',
  hosting: 'Hosting',
  ads: 'Ads',
};

const TECH_ICONS: Record<(typeof TECH_GROUPS)[number], typeof Globe> = {
  web_seo: Globe,
  local_seo: Target,
  web_dev: Code2,
  social_media: Share2,
  hosting: Server,
  ads: Megaphone,
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

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const isAdmin = useAuthStore((state) => state.isAdmin);
  const groupCodes = useAuthStore((s) => s.groupCodes);
  const isSales = groupCodes.includes('sales');
  const isAccounting = groupCodes.includes('accounting');
  const isAiSeo = groupCodes.includes('ai_seo');
  const visibleTechGroups = isAdmin
    ? [...TECH_GROUPS]
    : TECH_GROUPS.filter(
        (g) => groupCodes.includes(g) || (isAiSeo && (g === 'web_seo' || g === 'local_seo')),
      );

  return (
    <nav
      className="flex min-h-full flex-col gap-0.5"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a')) onNavigate?.();
      }}
    >
      <NavLink to="/" end className={({ isActive }) => sidebarLinkClass(isActive)}>
        <Home className="size-4 shrink-0 opacity-80" />
        {t('nav.home')}
      </NavLink>

      <NavLink to="/tasks" className={({ isActive }) => sidebarLinkClass(isActive)}>
        <ListChecks className="size-4 shrink-0 opacity-80" />
        {t('nav.tasks')}
        <TasksBadges />
      </NavLink>

      {isAdmin && (
        <NavLink to="/dashboard" className={({ isActive }) => sidebarLinkClass(isActive)}>
          <BarChart3 className="size-4 shrink-0 opacity-80" />
          {t('dashboard.title')}
        </NavLink>
      )}

      {(isAdmin || isSales) && (
        <div>
          <p className={sidebarSectionClass()}>{t('common:nav.section.sales')}</p>
          <div className="space-y-0.5">
            <NavLink to="/sales/clients" className={({ isActive }) => sidebarLinkClass(isActive)}>
              <Users className="size-4 shrink-0 opacity-80" />
              {t('clients:my_clients')}
            </NavLink>
            <NavLink to="/sales/leads" className={({ isActive }) => sidebarLinkClass(isActive)}>
              <Target className="size-4 shrink-0 opacity-80" />
              {t('leads:title')}
            </NavLink>
            {isAdmin && (
              <NavLink
                to="/sales/lead-intake"
                className={({ isActive }) => sidebarLinkClass(isActive)}
              >
                <ShieldAlert className="size-4 shrink-0 opacity-80" />
                {t('leads:intake.nav')}
                <LeadIntakeBadge />
              </NavLink>
            )}
            <NavLink to="/sales/kanban" className={({ isActive }) => sidebarLinkClass(isActive)}>
              <Columns3 className="size-4 shrink-0 opacity-80" />
              {t('sales:kanban.title')}
            </NavLink>
            <NavLink
              to="/sales/docs"
              className={({ isActive }) => sidebarLinkClass(isActive, true)}
            >
              {t('common:nav.documentation')}
            </NavLink>
            <NavLink to="/contracts" className={({ isActive }) => sidebarLinkClass(isActive)}>
              <FileText className="size-4 shrink-0 opacity-80" />
              {t('contracts:nav.title')}
            </NavLink>
          </div>
        </div>
      )}

      {(isAdmin || isAccounting) && (
        <div>
          <p className={sidebarSectionClass()}>{t('common:nav.section.accounting')}</p>
          <div className="space-y-0.5">
            <NavLink
              to="/accounting/clients"
              className={({ isActive }) => sidebarLinkClass(isActive)}
            >
              <Building2 className="size-4 shrink-0 opacity-80" />
              {t('accounting:nav.clients')}
            </NavLink>
            <NavLink
              to="/accounting/onboarding"
              className={({ isActive }) => sidebarLinkClass(isActive)}
            >
              <ClipboardList className="size-4 shrink-0 opacity-80" />
              {t('accounting:nav.onboarding')}
            </NavLink>
            <NavLink
              to="/accounting/recurring"
              className={({ isActive }) => sidebarLinkClass(isActive)}
            >
              <RefreshCw className="size-4 shrink-0 opacity-80" />
              {t('accounting:nav.recurring')}
            </NavLink>
            <NavLink
              to="/accounting/docs"
              className={({ isActive }) => sidebarLinkClass(isActive, true)}
            >
              {t('common:nav.documentation')}
            </NavLink>
            {isAdmin && (
              <>
                <NavLink
                  to="/accounting/report"
                  className={({ isActive }) => sidebarLinkClass(isActive)}
                >
                  <BarChart3 className="size-4 shrink-0 opacity-80" />
                  {t('accounting_report:nav.report')}
                </NavLink>
                <NavLink
                  to="/accounting/expenses"
                  className={({ isActive }) => sidebarLinkClass(isActive)}
                >
                  <Receipt className="size-4 shrink-0 opacity-80" />
                  {t('accounting_report:nav.expenses')}
                </NavLink>
              </>
            )}
          </div>
        </div>
      )}

      {visibleTechGroups.length > 0 && (
        <div>
          <p className={sidebarSectionClass()}>{t('common:nav.section.technical')}</p>
          <div className="space-y-0.5">
            {visibleTechGroups.map((g) => {
              const TechIcon = TECH_ICONS[g];
              return (
                <div key={g} className="space-y-0.5">
                  <NavLink
                    to={TECH_ROUTES[g]}
                    end
                    className={({ isActive }) => sidebarLinkClass(isActive)}
                  >
                    <TechIcon className="size-4 shrink-0 opacity-80" />
                    {TECH_LABELS[g]}
                  </NavLink>
                  <NavLink
                    to={TECH_CLIENTS_ROUTES[g]}
                    className={({ isActive }) => sidebarLinkClass(isActive, true)}
                  >
                    {t('clients:my_clients')}
                  </NavLink>
                  {['local_seo', 'web_dev', 'web_seo'].includes(g) && (
                    <NavLink
                      to={`${TECH_ROUTES[g]}/docs`}
                      className={({ isActive }) => sidebarLinkClass(isActive, true)}
                    >
                      {t('common:nav.documentation')}
                    </NavLink>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isAdmin && (
        <div className="mt-auto border-t border-sidebar-border pt-3">
          <NavLink to="/admin" className={({ isActive }) => sidebarLinkClass(isActive)}>
            <Settings className="size-4 shrink-0 opacity-80" />
            {t('admin:nav.settings')}
          </NavLink>
        </div>
      )}
    </nav>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 self-stretch overflow-y-auto border-r border-sidebar-border bg-sidebar px-3 py-4 md:block">
      <SidebarNav />
    </aside>
  );
}
