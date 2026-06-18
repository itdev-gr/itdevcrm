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
    <div className="flex h-screen flex-col">
      <Topbar onMenuClick={() => setMobileNavOpen(true)} />
      <EmailHealthBanner />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main ref={mainRef} className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <BackButton />
          {children}
        </main>
      </div>
      <ScrollRestorer rootRef={mainRef} />
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 left-0 w-64 overflow-y-auto bg-muted p-4 shadow-xl">
            <SidebarNav onNavigate={() => setMobileNavOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
