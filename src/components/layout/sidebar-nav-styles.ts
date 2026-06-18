import { cn } from '@/lib/utils';

export function sidebarLinkClass(isActive: boolean, nested = false) {
  return cn(
    'flex items-center gap-2.5 rounded-lg transition-colors',
    nested ? 'py-1.5 pl-9 pr-3 text-xs' : 'px-3 py-2 text-sm',
    isActive
      ? 'bg-[#1a9696]/12 font-medium text-[#157777] dark:bg-[#1a9696]/20 dark:text-[#7ad4d4]'
      : 'text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground',
  );
}

export function sidebarSectionClass() {
  return 'px-3 pb-1 pt-5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80';
}
