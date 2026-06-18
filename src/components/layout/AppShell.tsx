import { useRef, useState, type ReactNode } from 'react';
import { Sidebar, SidebarNav } from './Sidebar';
import { Topbar } from './Topbar';
import { EmailHealthBanner } from '@/features/system_health/EmailHealthBanner';
import { BackButton } from '@/components/BackButton';
import { ScrollRestorer } from '@/components/ScrollRestorer';

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

  return (
    <div className="flex h-screen flex-col bg-background">
      <Topbar onMenuClick={() => setMobileNavOpen(true)} />
      <EmailHealthBanner />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main
          ref={mainRef}
          className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-muted/25 dark:bg-background"
        >
          <BackButton />
          {children}
        </main>
      </div>
      <ScrollRestorer rootRef={mainRef} />
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 left-0 w-72 overflow-y-auto border-r border-sidebar-border bg-sidebar px-3 py-4 shadow-2xl">
            <SidebarNav onNavigate={() => setMobileNavOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
