'use client';

import { ShieldAlert, TriangleAlert } from 'lucide-react';
import type { SystemStatus } from '@/lib/server-data';

/**
 * Two always-visible truths:
 *   1. Sentinel is decision support — a human authorizes every physical action.
 *   2. Exactly which backends are real right now.
 *
 * The second line is not decorative. When Bedrock or CockroachDB is absent, the
 * fallback is named explicitly so nothing on screen can be mistaken for a live
 * integration.
 */
export function SafetyBanner({ status }: { status: SystemStatus }) {
  const fallbacks: string[] = [];
  if (!status.database.configured) fallbacks.push('in-memory demo store (no database)');
  else if (!status.database.reachable) fallbacks.push('CockroachDB unreachable');
  if (!status.bedrock.configured) fallbacks.push('local rule-based reasoning (no model)');
  if (!status.bedrock.embeddingsConfigured) fallbacks.push('local deterministic embeddings');

  return (
    <div className="shrink-0 border-b border-edge bg-panel2/60">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
        <p className="flex items-center gap-2 text-[11px] text-muted">
          <ShieldAlert size={13} className="shrink-0 text-warn" aria-hidden />
          <span>
            Sentinel provides <span className="text-ink">decision support</span>. Critical physical
            actions require authorized human approval.
          </span>
        </p>

        {status.mode.demoMode && (
          <span className="chip border-info/40 bg-info/10 text-info">Demo Mode</span>
        )}

        {fallbacks.length > 0 && (
          <p className="flex items-center gap-2 text-[11px] text-warn">
            <TriangleAlert size={13} className="shrink-0" aria-hidden />
            <span>Running on {fallbacks.join(' · ')}</span>
          </p>
        )}
      </div>
    </div>
  );
}
