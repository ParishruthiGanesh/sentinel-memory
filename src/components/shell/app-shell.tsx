'use client';

import { useState, type ReactNode } from 'react';
import { Sidebar } from '@/components/shell/sidebar';
import { TopBar } from '@/components/shell/top-bar';
import { SafetyBanner } from '@/components/shell/safety-banner';
import type { Incident } from '@/lib/types';
import type { SystemStatus } from '@/lib/server-data';

export function AppShell({
  incidents,
  status,
  responder,
  children,
}: {
  incidents: Incident[];
  status: SystemStatus;
  responder: string;
  children: ReactNode;
}) {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="flex h-dvh overflow-hidden bg-base">
      {/* Desktop navigation */}
      <aside className="hidden w-60 shrink-0 lg:block">
        <Sidebar status={status} />
      </aside>

      {/* Mobile drawer */}
      {navOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-base/80 backdrop-blur-sm"
            onClick={() => setNavOpen(false)}
          />
          <div className="relative h-full w-64 animate-riseIn">
            <Sidebar status={status} onNavigate={() => setNavOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          incidents={incidents}
          status={status}
          responder={responder}
          onOpenNav={() => setNavOpen(true)}
        />
        <SafetyBanner status={status} />
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
