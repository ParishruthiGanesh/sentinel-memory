/**
 * Shared presentational primitives.
 *
 * Colour carries meaning in this interface and is used consistently:
 *   red    — critical hazard only
 *   amber  — warning / consequence memory
 *   teal   — safe, approved, completed
 *   sky    — informational / system provenance
 */

import type { ReactNode } from 'react';
import type { RiskLevel } from '@/lib/types';

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = '',
  tone = 'default',
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  tone?: 'default' | 'warn' | 'critical' | 'success';
}) {
  const toneRing =
    tone === 'warn'
      ? 'border-warn/45 bg-warn/[0.06]'
      : tone === 'critical'
        ? 'border-critical/45 bg-critical/[0.06]'
        : tone === 'success'
          ? 'border-success/45 bg-success/[0.06]'
          : '';

  return (
    <section className={`panel ${toneRing} ${className}`}>
      {(title || actions) && (
        <header className="panel-header">
          <div className="min-w-0">
            {title && <h2 className="panel-title">{title}</h2>}
            {subtitle && <p className="mt-1 text-xs text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

const RISK_STYLES: Record<RiskLevel, string> = {
  critical: 'border-critical/50 bg-critical/15 text-critical',
  high: 'border-warn/50 bg-warn/15 text-warn',
  medium: 'border-info/50 bg-info/15 text-info',
  low: 'border-success/50 bg-success/15 text-success',
};

export function RiskBadge({ level, label }: { level: RiskLevel; label?: string }) {
  return (
    <span className={`chip uppercase tracking-wider ${RISK_STYLES[level]}`}>
      {label ?? level}
    </span>
  );
}

export function StatusDot({
  state,
  className = '',
}: {
  state: 'ok' | 'warn' | 'error' | 'idle';
  className?: string;
}) {
  const color =
    state === 'ok'
      ? 'bg-success'
      : state === 'warn'
        ? 'bg-warn'
        : state === 'error'
          ? 'bg-critical'
          : 'bg-muted';
  return (
    <span className={`relative flex h-2 w-2 ${className}`}>
      <span className={`absolute inline-flex h-full w-full rounded-full ${color} opacity-60 animate-pulseRing`} />
      <span className={`relative inline-flex h-2 w-2 rounded-full ${color}`} />
    </span>
  );
}

export function Chip({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'info' | 'warn' | 'critical' | 'success';
  className?: string;
}) {
  const styles = {
    neutral: 'border-edge bg-panel2 text-muted',
    info: 'border-info/40 bg-info/10 text-info',
    warn: 'border-warn/40 bg-warn/10 text-warn',
    critical: 'border-critical/40 bg-critical/10 text-critical',
    success: 'border-success/40 bg-success/10 text-success',
  }[tone];
  return <span className={`chip ${styles} ${className}`}>{children}</span>;
}

/** Horizontal similarity meter. Amber above 85% — that is a strong precedent. */
export function SimilarityBar({ value }: { value: number }) {
  const percent = Math.round(value * 1000) / 10;
  const tone = percent >= 85 ? 'bg-warn' : percent >= 65 ? 'bg-info' : 'bg-muted';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-panel2" role="presentation">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
      <span className="font-mono text-xs text-ink">{percent.toFixed(1)}%</span>
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon && <div className="text-muted/60">{icon}</div>}
      <p className="text-sm text-muted">{title}</p>
      {hint && <p className="max-w-md text-xs text-muted/70">{hint}</p>}
    </div>
  );
}

export function KeyValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">{label}</dt>
      <dd className="mt-1 truncate text-sm text-ink">{value}</dd>
    </div>
  );
}

/** Provenance label — makes it impossible to mistake fallback output for a model. */
export function ProviderTag({
  provider,
  label,
}: {
  provider: 'bedrock' | 'local-heuristic' | 'local-deterministic';
  label?: string;
}) {
  if (provider === 'bedrock') {
    return <Chip tone="info">Amazon Bedrock{label ? ` · ${label}` : ''}</Chip>;
  }
  return (
    <Chip tone="warn">
      {provider === 'local-heuristic' ? 'Local fallback · no model' : 'Local fallback embeddings'}
    </Chip>
  );
}
