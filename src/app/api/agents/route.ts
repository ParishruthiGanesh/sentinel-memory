/**
 * GET   /api/agents  — list agents and their status
 * PATCH /api/agents  — set an agent's status
 *
 * PATCH is what the demo's "Simulate Primary Agent Disconnect" button calls. It
 * changes an agent's status field and nothing else: no incident data, memory
 * event, recommendation or audit record is deleted or altered. That is the
 * whole point — the incident survives the agent.
 */

import { getStore } from '@/lib/store';
import {
  badRequest,
  checkRateLimit,
  clientKey,
  errorResponse,
  json,
  rateLimited,
  readJson,
} from '@/lib/api';
import { agentStatusSchema, parseInput } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    return json({ agents: await getStore().listAgents() });
  } catch (error) {
    return errorResponse(error, 'agents:list');
  }
}

export async function PATCH(request: Request) {
  const limit = checkRateLimit(clientKey(request, 'agents'), 30);
  if (!limit.allowed) return rateLimited(limit.resetInMs);

  try {
    const body = await readJson(request);
    if (body === null) return badRequest('Request body must be valid JSON');

    const parsed = parseInput(agentStatusSchema, body);
    if (!parsed.ok) return badRequest(parsed.error, parsed.details);

    const agent = await getStore().setAgentStatus(parsed.data.agentId, parsed.data.status);
    if (!agent) return json({ error: 'Agent not found' }, { status: 404 });

    return json({ agent, dataPreserved: true });
  } catch (error) {
    return errorResponse(error, 'agents:update');
  }
}
