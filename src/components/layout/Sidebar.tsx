import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';

export function Sidebar() {
  const { t } = useTranslation();
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
    </aside>
  );
}
