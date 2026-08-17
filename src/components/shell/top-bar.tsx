'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { CirclePlus, Database, Cpu, UserRound } from 'lucide-react';
import { Chip, StatusDot } from '@/components/ui';
import { NewIncidentDialog } from '@/components/shell/new-incident-dialog';
import type { Incident } from '@/lib/types';
import type { SystemStatus } from '@/lib/server-data';

export function TopBar({
  incidents,
  status,
  responder,
  onOpenNav,
}: {
  incidents: Incident[];
  status: SystemStatus;
  responder: string;
  onOpenNav?: () => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);

  const requested = searchParams.get('incident');
  const selected =
    incidents.find((incident) => incident.id === requested) ??
    incidents.find((incident) => incident.status === 'active') ??
    incidents[0];

  const onSelect = (id: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('incident', id);
    startTransition(() => router.push(`?${params.toString()}`));
  };

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-edge bg-panel px-3 sm:px-4">
      {onOpenNav && (
        <button
          type="button"
          onClick={onOpenNav}
          className="btn-ghost px-2 py-1.5 lg:hidden"
          aria-label="Open navigation"
        >
          <span className="block h-[2px] w-4 bg-current shadow-[0_5px_0_currentColor,0_-5px_0_currentColor]" />
        </button>
      )}

      <label className="sr-only" htmlFor="incident-select">
        Active incident
      </label>
      <select
        id="incident-select"
        value={selected?.id ?? ''}
        onChange={(event) => onSelect(event.target.value)}
        disabled={pending || incidents.length === 0}
        className="field max-w-[15rem] cursor-pointer py-1.5 text-xs sm:max-w-sm sm:text-sm"
      >
        {incidents.length === 0 && <option value="">No incidents</option>}
        {incidents.map((incident) => (
          <option key={incident.id} value={incident.id}>
            {incident.incidentCode} · {incident.title}
          </option>
        ))}
      </select>

      <div className="ml-auto flex items-center gap-2">
        <span className="hidden items-center gap-1.5 rounded-md border border-success/40 bg-success/10 px-2 py-1 text-[11px] font-medium text-success sm:inline-flex">
          <StatusDot state="ok" />
          LIVE
        </span>

        <Chip tone={status.database.configured && status.database.reachable ? 'success' : 'warn'}>
          <Database size={12} aria-hidden />
          <span className="hidden md:inline">
            {status.database.configured
              ? status.database.reachable
                ? 'CockroachDB'
                : 'CockroachDB down'
              : 'Demo store'}
          </span>
        </Chip>

        <Chip tone={status.bedrock.configured ? 'success' : 'warn'}>
          <Cpu size={12} aria-hidden />
          <span className="hidden md:inline">
            {status.bedrock.configured ? 'Bedrock' : 'Local fallback'}
          </span>
        </Chip>

        <span className="hidden items-center gap-1.5 text-xs text-muted lg:inline-flex">
          <UserRound size={13} aria-hidden />
          {responder}
        </span>

        <button type="button" onClick={() => setDialogOpen(true)} className="btn-neutral py-1.5">
          <CirclePlus size={14} aria-hidden />
          <span className="hidden sm:inline">New Incident</span>
        </button>
      </div>

      <NewIncidentDialog
        open={dialogOpen}
        responder={responder}
        onClose={() => setDialogOpen(false)}
        onCreated={(incident) => {
          setDialogOpen(false);
          startTransition(() => {
            router.push(`/?incident=${incident.id}`);
            router.refresh();
          });
        }}
      />
    </header>
  );
}
