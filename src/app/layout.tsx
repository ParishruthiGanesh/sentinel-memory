import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import './globals.css';
import { AppShell } from '@/components/shell/app-shell';
import { loadShellData } from '@/lib/server-data';

export const metadata: Metadata = {
  title: 'Sentinel Memory — incident response that remembers consequences',
  description:
    'An AI incident-response command center backed by CockroachDB durable memory and Amazon Bedrock reasoning. Normal agents remember conversations; Sentinel remembers consequences.',
};

export const viewport: Viewport = {
  themeColor: '#07111F',
  width: 'device-width',
  initialScale: 1,
};

export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { incidents, status, responder } = await loadShellData();

  return (
    <html lang="en">
      <body>
        {/* Suspense boundary: the shell reads search params on the client. */}
        <Suspense fallback={<div className="h-dvh bg-base" />}>
          <AppShell incidents={incidents} status={status} responder={responder}>
            {children}
          </AppShell>
        </Suspense>
      </body>
    </html>
  );
}
