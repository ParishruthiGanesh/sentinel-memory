'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  Activity,
  Database,
  GitBranchPlus,
  LayoutGrid,
  Layers3,
  Radar,
  ShieldCheck,
} from 'lucide-react';
import { SentinelWordmark } from '@/components/logo';
import { StatusDot } from '@/components/ui';
import type { SystemStatus } from '@/lib/server-data';

const NAV = [
  { href: '/', label: 'Command Center', icon: LayoutGrid },
  { href: '/memory', label: 'Memory Explorer', icon: Layers3 },
  { href: '/timeline', label: 'Incident Timeline', icon: Activity },
  { href: '/handoff', label: 'Agent Handoff', icon: GitBranchPlus },
  { href: '/architecture', label: 'Architecture', icon: Radar },
] as const;

export function Sidebar({ status, onNavigate }: { status: SystemStatus; onNavigate?: () => void }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const incident = searchParams.get('incident');
  const suffix = incident ? `?incident=${encodeURIComponent(incident)}` : '';

  const dbState = !status.database.configured
    ? 'idle'
    : status.database.reachable
      ? 'ok'
      : 'error';
  const bedrockState = status.bedrock.configured ? 'ok' : 'idle';

  return (
    <div className="flex h-full flex-col border-r border-edge bg-panel">
      <div className="flex h-16 items-center border-b border-edge px-4">
        <Link href={`/${suffix}`} onClick={onNavigate} className="rounded-md">
          <SentinelWordmark />
        </Link>
      </div>

      <nav className="flex-1 space-y-1 p-3" aria-label="Primary">
        {NAV.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={`${item.href}${suffix}`}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                active
                  ? 'bg-panel2 text-ink shadow-knob ring-1 ring-inset ring-info/25'
                  : 'text-muted hover:bg-panel2/60 hover:text-ink'
              }`}
            >
              <Icon size={16} className={active ? 'text-info' : 'text-muted'} aria-hidden />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="space-y-2.5 border-t border-edge p-3.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
          System status
        </p>

        <StatusLine
          icon={<Database size={13} aria-hidden />}
          label="CockroachDB"
          state={dbState}
          detail={
            !status.database.configured
              ? 'not configured'
              : status.database.reachable
                ? `${status.database.host ?? 'connected'} · ${status.database.latencyMs ?? 0}ms`
                : 'unreachable'
          }
        />

        <StatusLine
          icon={<Layers3 size={13} aria-hidden />}
          label="Vector index"
          state={
            status.database.vectorIndexPresent === true
              ? 'ok'
              : status.database.configured
                ? 'warn'
                : 'idle'
          }
          detail={
            status.database.vectorIndexPresent === true
              ? `${status.database.memoryCount ?? 0} memories · ${status.embeddingDimensions}d`
              : status.database.configured
                ? 'exact scan fallback'
                : 'in-memory demo'
          }
        />

        <StatusLine
          icon={<ShieldCheck size={13} aria-hidden />}
          label="Bedrock"
          state={bedrockState}
          detail={
            status.bedrock.configured
              ? `${status.bedrock.region} · ${truncateModel(status.bedrock.modelId)}`
              : 'local fallback'
          }
        />

        <p className="pt-1 text-[10px] leading-relaxed text-muted/70">
          Decision support only. Sentinel has no machinery control path.
        </p>
      </div>
    </div>
  );
}

function StatusLine({
  icon,
  label,
  state,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  state: 'ok' | 'warn' | 'error' | 'idle';
  detail: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 text-muted">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-ink">{label}</span>
          <StatusDot state={state} />
        </div>
        <p className="truncate text-[10px] text-muted" title={detail}>
          {detail}
        </p>
      </div>
    </div>
  );
}

function truncateModel(modelId: string | null): string {
  if (!modelId) return 'model unset';
  const parts = modelId.split('.');
  const tail = parts[parts.length - 1] ?? modelId;
  return tail.length > 22 ? `${tail.slice(0, 22)}…` : tail;
}
