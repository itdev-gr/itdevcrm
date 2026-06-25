import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { TabsList } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

export const settingsCardClass = 'rounded-xl border border-border/60 bg-card shadow-sm';

export function SettingsCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn(settingsCardClass, className)}>{children}</div>;
}

export function SettingsTableShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('overflow-hidden', settingsCardClass, className)}>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

export const settingsTheadClass =
  'sticky top-0 z-10 bg-muted/80 backdrop-blur-sm border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground';

export const settingsThClass = 'px-4 py-3 font-medium';

export const settingsTrClass =
  'group border-b border-border/40 transition-colors last:border-b-0 hover:bg-muted/35';

export const settingsTdClass = 'px-4 py-3';

export function StatusPill({
  active,
  activeLabel,
  inactiveLabel,
}: {
  active: boolean;
  activeLabel: string;
  inactiveLabel: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium',
        active
          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
          : 'bg-muted text-muted-foreground',
      )}
    >
      {active ? activeLabel : inactiveLabel}
    </span>
  );
}

export function GroupPills({ codes }: { codes: string[] }) {
  if (codes.length === 0) {
    return <span className="text-muted-foreground/50">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {codes.map((code) => (
        <span
          key={code}
          className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary dark:text-[#7ad4d4]"
        >
          {code}
        </span>
      ))}
    </div>
  );
}

export function UserAvatar({
  name,
  email,
}: {
  name?: string | null;
  email: string;
}) {
  const label = name?.trim() || email;
  const initials = label
    .split(/[\s@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <div className="flex items-center gap-3">
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary dark:text-[#7ad4d4]">
        {initials || '?'}
      </span>
      <div className="min-w-0">
        {name?.trim() ? (
          <>
            <div className="truncate font-medium">{name}</div>
            <div className="truncate text-xs text-muted-foreground">{email}</div>
          </>
        ) : (
          <div className="truncate font-medium">{email}</div>
        )}
      </div>
    </div>
  );
}

export function SettingsNav({
  tabs,
}: {
  tabs: readonly { to: string; label: string }[];
}) {
  const location = useLocation();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0, ready: false });

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    function sync() {
      const active = wrap!.querySelector('[aria-current="page"]') as HTMLElement | null;
      if (!active) return;
      setIndicator({
        left: active.offsetLeft,
        width: active.offsetWidth,
        ready: true,
      });
    }

    sync();
    const mo = new MutationObserver(sync);
    mo.observe(wrap, { attributes: true, subtree: true, attributeFilter: ['aria-current'] });
    window.addEventListener('resize', sync);
    return () => {
      mo.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, [location.pathname]);

  return (
    <div ref={wrapRef} className="relative border-b border-border/40">
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-y-1 rounded-lg bg-primary/10 dark:bg-primary/20 transition-[left,width,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
          indicator.ready ? 'opacity-100' : 'opacity-0',
        )}
        style={{ left: indicator.left, width: indicator.width }}
      />
      <nav className="relative z-[1] flex flex-wrap gap-0.5">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              cn(
                'rounded-lg px-4 py-2 text-sm font-medium transition-[color,font-weight] duration-200',
                isActive
                  ? 'font-semibold text-primary dark:text-[#7ad4d4]'
                  : 'text-muted-foreground hover:text-foreground',
              )
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export const detailTabTriggerClass =
  'relative z-[1] shrink-0 rounded-lg border-0 bg-transparent px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-none transition-[color,font-weight] duration-200 ease-out after:hidden hover:text-foreground data-active:bg-transparent data-active:font-semibold data-active:text-primary data-active:shadow-none dark:data-active:bg-transparent dark:data-active:text-[#7ad4d4] sm:px-3.5 sm:text-sm';

/** Side-by-side overview + comments column on detail pages. */
export const detailOverviewWithCommentsGridClass =
  'grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(24rem,30rem)] xl:grid-cols-[minmax(0,1fr)_minmax(26rem,32rem)]';

export const detailHeaderCardClass =
  'rounded-xl border border-border/60 bg-card p-3 shadow-sm sm:p-3.5';

export const detailHeaderControlsClass =
  'flex flex-wrap items-center gap-x-3 gap-y-2';

export const detailHeaderControlGroupClass = 'flex items-center gap-1.5';

export const detailHeaderLabelClass = 'text-[11px] font-medium text-muted-foreground';

export const detailHeaderSelectClass = 'h-8 min-w-[140px] px-2 text-xs';

export const commentsPanelShellClass =
  'flex max-h-[calc(100vh-9rem)] min-h-[22rem] flex-col overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm lg:max-h-none';

export const commentsPanelHeaderClass =
  'shrink-0 border-b border-border/60 px-4 py-2';

export const commentsPanelBodyClass =
  'flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-3 pt-3';

export function DetailTabsList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0, ready: false });

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const list = wrap.querySelector('[data-slot="tabs-list"]');
    if (!list) return;

    function sync() {
      const active = list!.querySelector('[data-state="active"]') as HTMLElement | null;
      if (!active) return;
      setIndicator({
        left: active.offsetLeft,
        width: active.offsetWidth,
        ready: true,
      });
    }

    sync();
    const mo = new MutationObserver(sync);
    mo.observe(list, { attributes: true, subtree: true, attributeFilter: ['data-state'] });
    window.addEventListener('resize', sync);
    return () => {
      mo.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, []);

  return (
    <div ref={wrapRef} className={cn('relative border-b border-border/40 overflow-x-auto', className)}>
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-y-1 rounded-lg bg-primary/10 dark:bg-primary/20 transition-[left,width,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
          indicator.ready ? 'opacity-100' : 'opacity-0',
        )}
        style={{ left: indicator.left, width: indicator.width }}
      />
      <TabsList
        variant="line"
        className="relative z-[1] h-auto w-max min-w-full flex-nowrap justify-start gap-0.5 rounded-none border-0 bg-transparent p-0"
      >
        {children}
      </TabsList>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/60 pb-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-card p-3 shadow-sm',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function FilterSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-9 rounded-lg border border-input/80 bg-background px-3 text-sm text-foreground shadow-sm transition-colors focus:border-[#1a9696]/40 focus:outline-none focus:ring-2 focus:ring-[#1a9696]/20 dark:[color-scheme:dark]',
        className,
      )}
      {...props}
    />
  );
}

export function SegmentedControl({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-lg border border-input/80 bg-muted/50 p-0.5 shadow-sm">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            value === opt.value
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
