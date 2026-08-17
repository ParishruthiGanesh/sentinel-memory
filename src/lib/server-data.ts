/**
 * Server-side data loading for React Server Components.
 *
 * Pages read the store directly rather than fetching their own HTTP API: it is
 * one fewer network hop, and it keeps every secret on the server. The HTTP API
 * still exists for the client-side mutations and for external callers.
 */

import { getStore } from '@/lib/store';
import { runtimeMode } from '@/lib/api';
import { describeConfig } from '@/lib/env';
import type { Agent, Incident, RuntimeMode } from '@/lib/types';

export interface SystemStatus {
  mode: RuntimeMode;
  database: {
    configured: boolean;
    reachable: boolean;
    latencyMs: number | null;
    vectorIndexPresent: boolean | null;
    memoryCount: number | null;
    host: string | null;
    error: string | null;
  };
  bedrock: {
    configured: boolean;
    region: string | null;
    modelId: string | null;
    embeddingModelId: string | null;
    embeddingsConfigured: boolean;
  };
  embeddingDimensions: number;
}

export async function loadSystemStatus(): Promise<SystemStatus> {
  const config = describeConfig();
  const store = getStore();

  const health = config.database.configured
    ? await store.health()
    : { ok: false, latencyMs: 0, error: null as string | null };

  return {
    mode: runtimeMode(),
    database: {
      configured: config.database.configured,
      reachable: health.ok,
      latencyMs: health.ok ? health.latencyMs : null,
      vectorIndexPresent: 'vectorIndexPresent' in health ? (health.vectorIndexPresent ?? null) : null,
      memoryCount: 'memoryCount' in health ? (health.memoryCount ?? null) : null,
      host: config.database.host,
      error: health.error ?? null,
    },
    bedrock: {
      configured: config.bedrock.configured,
      region: config.bedrock.region,
      modelId: config.bedrock.modelId,
      embeddingModelId: config.bedrock.embeddingModelId,
      embeddingsConfigured: config.bedrock.embeddingsConfigured,
    },
    embeddingDimensions: config.app.embeddingDimensions,
  };
}

export interface ShellData {
  incidents: Incident[];
  agents: Agent[];
  status: SystemStatus;
  responder: string;
}

export async function loadShellData(): Promise<ShellData> {
  const store = getStore();
  const [incidents, agents, status] = await Promise.all([
    store.listIncidents(),
    store.listAgents(),
    loadSystemStatus(),
  ]);
  const { env } = await import('@/lib/env');
  return { incidents, agents, status, responder: env.defaultResponder };
}

/**
 * Resolve which incident a page should display: the one named in `?incident=`,
 * else the first active one, else the most recent.
 */
export function selectIncident(incidents: Incident[], requested?: string): Incident | null {
  if (requested) {
    const match = incidents.find(
      (incident) => incident.id === requested || incident.incidentCode === requested,
    );
    if (match) return match;
  }
  return incidents.find((incident) => incident.status === 'active') ?? incidents[0] ?? null;
}
