/**
 * Canonical seed corpus.
 *
 * This single module is the source of truth for both seeding paths:
 *   - `scripts/seed.ts` writes it into CockroachDB (with real embeddings)
 *   - `src/lib/store/demo-store.ts` loads it into memory when no DATABASE_URL
 *     is configured, so the UI is previewable without external services.
 *
 * IDs are fixed (not random) so the two paths agree, so the demo script can
 * deep-link, and so re-seeding is idempotent.
 */

import type {
  ActorType,
  IncidentPhase,
  IncidentStatus,
  MemoryEventType,
  MemoryType,
  Severity,
} from '@/lib/types';

export interface SeedAgent {
  id: string;
  name: string;
  role: string;
  status: 'active' | 'ready' | 'standby' | 'disconnected';
}

export interface SeedMemory {
  id: string;
  memoryType: MemoryType;
  sourceText: string;
  actionTaken: string | null;
  outcome: string | null;
  lessonLearned: string | null;
  severity: Severity | null;
}

export interface SeedObservation {
  id: string;
  eventType: MemoryEventType;
  actorType: ActorType;
  actorName: string;
  content: string;
  /** Minutes after the incident's `occurredAt`. */
  offsetMinutes: number;
}

export interface SeedIncident {
  id: string;
  incidentCode: string;
  title: string;
  description: string;
  location: string;
  severity: Severity;
  status: IncidentStatus;
  currentPhase: IncidentPhase;
  /** ISO timestamp the incident opened. */
  occurredAt: string;
  assignedAgentId: string | null;
  observations: SeedObservation[];
  memories: SeedMemory[];
}

export interface SeedSafetyRule {
  id: string;
  name: string;
  description: string;
  actionPattern: string;
  enforcementLevel: 'block' | 'warn' | 'advise';
  requiresHumanApproval: boolean;
}

export const SENTINEL_PRIMARY_ID = 'a0000000-0000-4000-8000-000000000001';
export const SENTINEL_BACKUP_ID = 'a0000000-0000-4000-8000-000000000002';

export const ACTIVE_INCIDENT_ID = '10000000-0000-4000-8000-000000000009';
export const KEY_HISTORICAL_INCIDENT_ID = '10000000-0000-4000-8000-000000000001';
/** The memory that drives the "What happened last time?" counterfactual card. */
export const KEY_MEMORY_ID = '20000000-0000-4000-8000-000000000004';

export const SEED_AGENTS: SeedAgent[] = [
  {
    id: SENTINEL_PRIMARY_ID,
    name: 'Sentinel Primary',
    role: 'Primary incident-response agent',
    status: 'active',
  },
  {
    id: SENTINEL_BACKUP_ID,
    name: 'Sentinel Backup',
    role: 'Backup incident-response agent',
    status: 'ready',
  },
];

export const SEED_SAFETY_RULES: SeedSafetyRule[] = [
  {
    id: '30000000-0000-4000-8000-000000000001',
    name: 'Human approval required for physical actions',
    description:
      'Any recommendation involving shutdown, restart, re-energizing, venting, isolation or hazard-zone entry must be approved by an authorized human responder before it is carried out. Sentinel never actuates equipment.',
    actionPattern: 'shutdown|restart|energize|vent|purge|isolate|enter|bypass|override',
    enforcementLevel: 'block',
    requiresHumanApproval: true,
  },
  {
    id: '30000000-0000-4000-8000-000000000002',
    name: 'Emergency shutdown cannot be automated',
    description:
      'Emergency shutdown is a human-initiated action. Sentinel may recommend and sequence it, but the system has no machinery control path and will never execute it.',
    actionPattern: 'emergency shutdown|e-stop|emergency stop',
    enforcementLevel: 'block',
    requiresHumanApproval: true,
  },
  {
    id: '30000000-0000-4000-8000-000000000003',
    name: 'Conflicting instructions must be escalated',
    description:
      'When two recorded statements about equipment state, personnel location or an ordered action contradict each other, Sentinel raises a contradiction and escalates instead of choosing between them.',
    actionPattern: 'contradiction|conflict',
    enforcementLevel: 'warn',
    requiresHumanApproval: false,
  },
  {
    id: '30000000-0000-4000-8000-000000000004',
    name: 'Shared pressure lines isolated before equipment state changes',
    description:
      'On coupled equipment, verify and isolate the shared pressure line before shutting down or restarting either unit, so residual pressure cannot transfer to the coupled machine.',
    actionPattern: 'machine 7|machine 8|pressure line|shared header',
    enforcementLevel: 'warn',
    requiresHumanApproval: true,
  },
  {
    id: '30000000-0000-4000-8000-000000000005',
    name: 'All actions are audit logged',
    description:
      'Every recommendation, approval, rejection and state change is written to the immutable audit trail in CockroachDB in the same transaction that applies the change.',
    actionPattern: '.*',
    enforcementLevel: 'advise',
    requiresHumanApproval: false,
  },
];

export const SEED_HISTORICAL_INCIDENTS: SeedIncident[] = [
  {
    id: KEY_HISTORICAL_INCIDENT_ID,
    incidentCode: 'INC-2025-0412',
    title: 'Pressure transfer after premature Machine 7 restart',
    description:
      'Smoke was detected near Machine 7 after a thermal sensor alarm. The responder restarted Machine 7 before isolating the connected pressure line. Residual pressure transferred toward Machine 8, damaging a secondary valve and extending the shutdown by 11 hours.',
    location: 'Assembly Plant, Zone 4',
    severity: 'critical',
    status: 'closed',
    currentPhase: 'review',
    occurredAt: '2025-04-12T09:14:00.000Z',
    assignedAgentId: null,
    observations: [
      {
        id: '40000000-0000-4000-8000-000000000001',
        eventType: 'observation',
        actorType: 'system',
        actorName: 'Thermal sensor TS-7A',
        content: 'Thermal sensor alarm raised on Machine 7 housing; smoke observed near the drive assembly.',
        offsetMinutes: 0,
      },
      {
        id: '40000000-0000-4000-8000-000000000002',
        eventType: 'observation',
        actorType: 'human',
        actorName: 'M. Osei (Shift Lead)',
        content: 'Machine 7 taken offline and restarted to clear the fault condition.',
        offsetMinutes: 7,
      },
      {
        id: '40000000-0000-4000-8000-000000000003',
        eventType: 'observation',
        actorType: 'system',
        actorName: 'Pressure sensor PT-8B',
        content: 'Pressure on the Machine 8 header rose sharply within 90 seconds of the Machine 7 restart.',
        offsetMinutes: 9,
      },
      {
        id: '40000000-0000-4000-8000-000000000004',
        eventType: 'state_change',
        actorType: 'human',
        actorName: 'M. Osei (Shift Lead)',
        content: 'Secondary relief valve on Machine 8 failed; line depressurized manually and both units locked out.',
        offsetMinutes: 24,
      },
    ],
    memories: [
      {
        id: '20000000-0000-4000-8000-000000000001',
        memoryType: 'incident_summary',
        sourceText:
          'Smoke detected near Machine 7 in Assembly Plant Zone 4 following a thermal sensor alarm. Machine 7 shares a pressure header with Machine 8. The responder restarted Machine 7 to clear the fault before the shared pressure line was isolated.',
        actionTaken: 'Machine 7 was restarted before pressure isolation.',
        outcome:
          'Secondary equipment damage near Machine 8. No personnel injury. Eleven-hour operational shutdown.',
        lessonLearned:
          'Isolate and verify the shared pressure line before shutting down or restarting Machine 7.',
        severity: 'critical',
      },
      {
        id: '20000000-0000-4000-8000-000000000002',
        memoryType: 'action_taken',
        sourceText:
          'Responder restarted Machine 7 to clear a thermal fault while the shared pressure line to Machine 8 remained live and unisolated.',
        actionTaken: 'Machine 7 was restarted before pressure isolation.',
        outcome:
          'Residual pressure transferred through the shared header toward Machine 8 within 90 seconds.',
        lessonLearned:
          'Never change the running state of Machine 7 while the Machine 8 header is pressurized and unisolated.',
        severity: 'critical',
      },
      {
        id: '20000000-0000-4000-8000-000000000003',
        memoryType: 'outcome',
        sourceText:
          'Pressure transferred to Machine 8 after the premature Machine 7 restart, causing the secondary relief valve to fail and forcing a manual depressurization of the shared line.',
        actionTaken: 'Machine 7 was restarted before pressure isolation.',
        outcome:
          'Secondary valve damage on Machine 8, manual depressurization required, eleven-hour shutdown, no injuries.',
        lessonLearned:
          'A restart on coupled equipment is a pressure event, not just an electrical one.',
        severity: 'critical',
      },
      {
        id: KEY_MEMORY_ID,
        memoryType: 'lesson_learned',
        sourceText:
          'Lesson from the April 2025 Machine 7 smoke incident: isolate and verify the shared pressure line to Machine 8 before shutting down or restarting Machine 7. Restarting first transfers residual pressure to the coupled machine and damages the secondary valve.',
        actionTaken: 'Machine 7 was restarted before pressure isolation.',
        outcome:
          'Secondary equipment damage near Machine 8. No personnel injury. Eleven-hour operational shutdown.',
        lessonLearned:
          'Isolate and verify the shared pressure line before shutting down or restarting Machine 7.',
        severity: 'critical',
      },
    ],
  },

  {
    id: '10000000-0000-4000-8000-000000000002',
    incidentCode: 'INC-2025-0118',
    title: 'Overheated conveyor motor on Line 2',
    description:
      'Conveyor motor CM-2 overheated during an extended production run. The motor was left energized while the guard panel was opened for inspection, exposing the responder to a live rotating assembly.',
    location: 'Assembly Plant, Zone 2',
    severity: 'high',
    status: 'closed',
    currentPhase: 'review',
    occurredAt: '2025-01-18T14:02:00.000Z',
    assignedAgentId: null,
    observations: [
      {
        id: '40000000-0000-4000-8000-000000000005',
        eventType: 'observation',
        actorType: 'system',
        actorName: 'Motor monitor CM-2',
        content: 'Conveyor motor CM-2 winding temperature exceeded threshold for 12 minutes.',
        offsetMinutes: 0,
      },
      {
        id: '40000000-0000-4000-8000-000000000006',
        eventType: 'observation',
        actorType: 'human',
        actorName: 'J. Whitfield (Maintenance)',
        content: 'Guard panel opened for visual inspection while the motor remained energized.',
        offsetMinutes: 11,
      },
    ],
    memories: [
      {
        id: '20000000-0000-4000-8000-000000000005',
        memoryType: 'incident_summary',
        sourceText:
          'Conveyor motor CM-2 on Line 2 overheated during an extended run. The guard panel was opened for inspection before the motor was de-energized and locked out.',
        actionTaken: 'Guard panel opened while the conveyor motor was still energized.',
        outcome:
          'Near-miss exposure to a live rotating assembly. Motor bearing replaced. Four-hour line stoppage.',
        lessonLearned:
          'De-energize and lock out the drive before opening any guard panel, even for a visual-only inspection.',
        severity: 'high',
      },
      {
        id: '20000000-0000-4000-8000-000000000006',
        memoryType: 'lesson_learned',
        sourceText:
          'Lesson from the January 2025 conveyor overheat: thermal alarms are not a reason to skip lockout. De-energize and lock out the drive before opening a guard panel.',
        actionTaken: 'Guard panel opened while the conveyor motor was still energized.',
        outcome: 'Near-miss exposure to a live rotating assembly.',
        lessonLearned:
          'Thermal urgency never justifies skipping lockout/tagout on a rotating assembly.',
        severity: 'high',
      },
    ],
  },

  {
    id: '10000000-0000-4000-8000-000000000003',
    incidentCode: 'INC-2025-0227',
    title: 'Restricted-zone worker entry during active lockout',
    description:
      'A contractor entered restricted Zone 4 while a lockout was active because the entry log and the verbal headcount disagreed. The zone was cleared only after a full sweep.',
    location: 'Assembly Plant, Zone 4',
    severity: 'high',
    status: 'closed',
    currentPhase: 'review',
    occurredAt: '2025-02-27T07:48:00.000Z',
    assignedAgentId: null,
    observations: [
      {
        id: '40000000-0000-4000-8000-000000000007',
        eventType: 'observation',
        actorType: 'system',
        actorName: 'Badge reader Z4-N',
        content: 'Badge scan recorded at the Zone 4 north gate while lockout LO-2251 was active.',
        offsetMinutes: 0,
      },
      {
        id: '40000000-0000-4000-8000-000000000008',
        eventType: 'contradiction',
        actorType: 'system',
        actorName: 'Sentinel',
        content:
          'Entry log shows one person inside Zone 4; the verbal headcount reported the zone clear. Both cannot be true.',
        offsetMinutes: 4,
      },
    ],
    memories: [
      {
        id: '20000000-0000-4000-8000-000000000007',
        memoryType: 'incident_summary',
        sourceText:
          'A contractor entered restricted Zone 4 during an active lockout. The badge entry log and the verbal headcount contradicted each other, delaying confirmation that the zone was clear.',
        actionTaken: 'Work resumed on a verbal headcount before the entry log was reconciled.',
        outcome:
          'Personnel present in a restricted zone during lockout. Full sweep required. No injury. Ninety-minute delay.',
        lessonLearned:
          'Reconcile badge entry logs with the verbal headcount before declaring a restricted zone clear.',
        severity: 'high',
      },
      {
        id: '20000000-0000-4000-8000-000000000008',
        memoryType: 'lesson_learned',
        sourceText:
          'Lesson from the February 2025 restricted-zone entry: when a personnel count contradicts an access log, treat the zone as occupied until a physical sweep resolves it.',
        actionTaken: 'Work resumed on a verbal headcount before the entry log was reconciled.',
        outcome: 'Personnel confirmed inside a restricted zone during an active lockout.',
        lessonLearned:
          'Contradictory personnel counts mean the zone is occupied until proven otherwise.',
        severity: 'high',
      },
    ],
  },

  {
    id: '10000000-0000-4000-8000-000000000004',
    incidentCode: 'INC-2025-0603',
    title: 'Solvent leak at the decanting station',
    description:
      'A drum coupling failed at the solvent decanting station. Ventilation was increased before the supply line was closed, drawing vapour across the adjacent work cell.',
    location: 'Chemical Store, Bay 1',
    severity: 'critical',
    status: 'closed',
    currentPhase: 'review',
    occurredAt: '2025-06-03T11:30:00.000Z',
    assignedAgentId: null,
    observations: [
      {
        id: '40000000-0000-4000-8000-000000000009',
        eventType: 'observation',
        actorType: 'system',
        actorName: 'VOC detector CS-1',
        content: 'Volatile organic compound reading exceeded the action level at the decanting station.',
        offsetMinutes: 0,
      },
      {
        id: '40000000-0000-4000-8000-00000000000a',
        eventType: 'observation',
        actorType: 'human',
        actorName: 'R. Nakamura (EHS)',
        content: 'Extraction fans set to maximum before the solvent supply line was closed.',
        offsetMinutes: 6,
      },
    ],
    memories: [
      {
        id: '20000000-0000-4000-8000-000000000009',
        memoryType: 'incident_summary',
        sourceText:
          'A solvent drum coupling failed at the decanting station in the Chemical Store. Extraction was increased before the supply line was closed, pulling vapour across the adjacent work cell.',
        actionTaken: 'Ventilation increased before the source was isolated.',
        outcome:
          'Vapour spread to an adjacent work cell, two workers relocated for observation, six-hour bay closure.',
        lessonLearned:
          'Stop the source before changing airflow; ventilation moves a hazard, it does not remove it.',
        severity: 'critical',
      },
      {
        id: '20000000-0000-4000-8000-00000000000a',
        memoryType: 'lesson_learned',
        sourceText:
          'Lesson from the June 2025 solvent leak: isolate the source first, then adjust ventilation. Increasing extraction before isolation redistributes the hazard.',
        actionTaken: 'Ventilation increased before the source was isolated.',
        outcome: 'Vapour drawn across an adjacent work cell.',
        lessonLearned: 'Source isolation precedes any airflow change.',
        severity: 'critical',
      },
    ],
  },

  {
    id: '10000000-0000-4000-8000-000000000005',
    incidentCode: 'INC-2025-0709',
    title: 'Thermal sensor false positive on Machine 3',
    description:
      'Thermal sensor TS-3C reported an over-temperature condition on Machine 3. A full line stop was called before the reading was cross-checked against the secondary sensor, which showed normal temperature.',
    location: 'Assembly Plant, Zone 3',
    severity: 'low',
    status: 'closed',
    currentPhase: 'review',
    occurredAt: '2025-07-09T16:20:00.000Z',
    assignedAgentId: null,
    observations: [
      {
        id: '40000000-0000-4000-8000-00000000000b',
        eventType: 'observation',
        actorType: 'system',
        actorName: 'Thermal sensor TS-3C',
        content: 'Over-temperature alarm raised on Machine 3.',
        offsetMinutes: 0,
      },
      {
        id: '40000000-0000-4000-8000-00000000000c',
        eventType: 'observation',
        actorType: 'human',
        actorName: 'D. Farrell (Operator)',
        content: 'Secondary sensor TS-3D showed normal temperature; sensor TS-3C found to have a failed lead.',
        offsetMinutes: 35,
      },
    ],
    memories: [
      {
        id: '20000000-0000-4000-8000-00000000000b',
        memoryType: 'incident_summary',
        sourceText:
          'Thermal sensor TS-3C on Machine 3 raised an over-temperature alarm caused by a failed sensor lead. A full line stop was called before the reading was cross-checked with the secondary sensor.',
        actionTaken: 'Full line stop called on a single unverified sensor reading.',
        outcome:
          'No hazard present. Forty minutes of unnecessary downtime. Sensor lead replaced.',
        lessonLearned:
          'Cross-check a single alarming sensor against its redundant pair before calling a full stop — but never delay evacuation on a life-safety alarm.',
        severity: 'low',
      },
      {
        id: '20000000-0000-4000-8000-00000000000c',
        memoryType: 'lesson_learned',
        sourceText:
          'Lesson from the July 2025 false positive: verify a single-sensor alarm against its redundant pair before a costly stop, unless the alarm is life-safety, in which case act first.',
        actionTaken: 'Full line stop called on a single unverified sensor reading.',
        outcome: 'Unnecessary downtime, no hazard present.',
        lessonLearned:
          'Single-sensor alarms deserve a cross-check; life-safety alarms never wait for one.',
        severity: 'low',
      },
    ],
  },

  {
    id: '10000000-0000-4000-8000-000000000006',
    incidentCode: 'INC-2025-0815',
    title: 'Blocked emergency exit in the east corridor',
    description:
      'Palletized stock blocked the east corridor emergency exit during a night shift. The obstruction was found during a routine sweep, not by the exit monitoring system.',
    location: 'Warehouse, East Corridor',
    severity: 'medium',
    status: 'closed',
    currentPhase: 'review',
    occurredAt: '2025-08-15T22:05:00.000Z',
    assignedAgentId: null,
    observations: [
      {
        id: '40000000-0000-4000-8000-00000000000d',
        eventType: 'observation',
        actorType: 'human',
        actorName: 'P. Adeyemi (Night Sweep)',
        content: 'Two stock pallets staged against the east corridor emergency exit door.',
        offsetMinutes: 0,
      },
    ],
    memories: [
      {
        id: '20000000-0000-4000-8000-00000000000d',
        memoryType: 'incident_summary',
        sourceText:
          'Palletized stock blocked the east corridor emergency exit for an estimated four hours during a night shift. The exit monitoring system did not detect the obstruction.',
        actionTaken: 'Staging area overflow placed against an emergency egress route.',
        outcome:
          'Egress route unavailable for approximately four hours. No emergency occurred. Staging layout revised.',
        lessonLearned:
          'Egress routes are verified by physical sweep; absence of an alarm is not evidence that an exit is clear.',
        severity: 'medium',
      },
    ],
  },

  {
    id: '10000000-0000-4000-8000-000000000007',
    incidentCode: 'INC-2025-0921',
    title: 'Forklift proximity event near the Zone 2 walkway',
    description:
      'A forklift passed within one metre of a pedestrian at the Zone 2 walkway crossing after the proximity alarm had been muted to reduce nuisance alerts.',
    location: 'Assembly Plant, Zone 2',
    severity: 'medium',
    status: 'closed',
    currentPhase: 'review',
    occurredAt: '2025-09-21T10:12:00.000Z',
    assignedAgentId: null,
    observations: [
      {
        id: '40000000-0000-4000-8000-00000000000e',
        eventType: 'observation',
        actorType: 'system',
        actorName: 'Proximity system FL-4',
        content: 'Pedestrian detected within one metre of forklift FL-4 at the Zone 2 crossing.',
        offsetMinutes: 0,
      },
      {
        id: '40000000-0000-4000-8000-00000000000f',
        eventType: 'observation',
        actorType: 'human',
        actorName: 'L. Brandt (Supervisor)',
        content: 'Proximity alarm had been muted on FL-4 earlier in the shift to reduce nuisance alerts.',
        offsetMinutes: 20,
      },
    ],
    memories: [
      {
        id: '20000000-0000-4000-8000-00000000000e',
        memoryType: 'incident_summary',
        sourceText:
          'A forklift passed within one metre of a pedestrian at the Zone 2 walkway crossing. The vehicle proximity alarm had been muted earlier in the shift to reduce nuisance alerts.',
        actionTaken: 'Proximity alarm muted to suppress nuisance alerts.',
        outcome:
          'Near-miss pedestrian contact. No injury. Alarm muting privileges withdrawn from operators.',
        lessonLearned:
          'Suppressing a nuisance alarm removes the protection, not the hazard; re-tune thresholds instead of muting.',
        severity: 'medium',
      },
    ],
  },

  {
    id: '10000000-0000-4000-8000-000000000008',
    incidentCode: 'INC-2025-1104',
    title: 'Power restored to Substation B before inspection completed',
    description:
      'Power was restored to Substation B after a trip while the downstream inspection was still in progress, re-energizing a panel a technician had open.',
    location: 'Substation B',
    severity: 'critical',
    status: 'closed',
    currentPhase: 'review',
    occurredAt: '2025-11-04T05:41:00.000Z',
    assignedAgentId: null,
    observations: [
      {
        id: '40000000-0000-4000-8000-000000000010',
        eventType: 'observation',
        actorType: 'system',
        actorName: 'Substation B relay',
        content: 'Feeder breaker tripped on Substation B; downstream panels de-energized.',
        offsetMinutes: 0,
      },
      {
        id: '40000000-0000-4000-8000-000000000011',
        eventType: 'observation',
        actorType: 'human',
        actorName: 'Control Room',
        content: 'Breaker reclosed to restore production while the downstream inspection was still open.',
        offsetMinutes: 18,
      },
    ],
    memories: [
      {
        id: '20000000-0000-4000-8000-00000000000f',
        memoryType: 'incident_summary',
        sourceText:
          'After a feeder trip at Substation B, the breaker was reclosed to restore production before the downstream inspection was signed off, re-energizing a panel a technician had open.',
        actionTaken: 'Power restored before the downstream inspection was completed and signed off.',
        outcome:
          'Live panel re-energized with a technician present. No injury. Inspection sign-off made a hard prerequisite for re-energization.',
        lessonLearned:
          'Never restore power until every downstream inspection is closed out and signed off by name.',
        severity: 'critical',
      },
      {
        id: '20000000-0000-4000-8000-000000000010',
        memoryType: 'lesson_learned',
        sourceText:
          'Lesson from the November 2025 substation event: restoring power is a state change that must be gated on positive confirmation that all downstream work is complete, not on the absence of objections.',
        actionTaken: 'Power restored before the downstream inspection was completed.',
        outcome: 'A panel was re-energized while a technician was working on it.',
        lessonLearned: 'Re-energization requires positive, named sign-off — silence is not consent.',
        severity: 'critical',
      },
    ],
  },
];

/** Standing procedures — semantic memory that is not tied to one incident. */
export const SEED_PROCEDURE_MEMORIES: SeedMemory[] = [
  {
    id: '20000000-0000-4000-8000-000000000011',
    memoryType: 'safety_procedure',
    sourceText:
      'Coupled-equipment procedure for Assembly Plant Zone 4: Machine 7 and Machine 8 share a pressure header. Before any shutdown or restart of either unit, close the header isolation valve, verify the downstream gauge reads zero, and record the verifying responder by name.',
    actionTaken: null,
    outcome: null,
    lessonLearned:
      'Isolate the shared header and verify zero pressure before any state change on Machine 7 or Machine 8.',
    severity: 'critical',
  },
  {
    id: '20000000-0000-4000-8000-000000000012',
    memoryType: 'safety_procedure',
    sourceText:
      'Smoke-response procedure: confirm personnel are accounted for, identify whether the source is electrical or mechanical, isolate stored energy (pressure, thermal, electrical) before changing equipment state, and escalate to the safety lead if the source cannot be identified within ten minutes.',
    actionTaken: null,
    outcome: null,
    lessonLearned:
      'Account for people first, isolate stored energy second, change equipment state last.',
    severity: 'high',
  },
];

/** The live incident the demo opens on. */
export const SEED_ACTIVE_INCIDENT: SeedIncident = {
  id: ACTIVE_INCIDENT_ID,
  incidentCode: 'INC-2026-0817',
  title: 'Smoke detected near Machine 7',
  description:
    'Smoke was detected near Machine 7 in Assembly Plant Zone 4 following a thermal sensor alarm. Machine 7 shares a pressure header with Machine 8. Main power to the cell remains active and the shared pressure line has not yet been confirmed isolated.',
  location: 'Assembly Plant · Zone 4',
  severity: 'critical',
  status: 'active',
  currentPhase: 'containment',
  occurredAt: '2026-08-17T08:42:00.000Z',
  assignedAgentId: SENTINEL_PRIMARY_ID,
  observations: [
    {
      id: '40000000-0000-4000-8000-000000000020',
      eventType: 'incident_created',
      actorType: 'system',
      actorName: 'Sentinel',
      content:
        'Incident INC-2026-0817 opened: smoke detected near Machine 7, Assembly Plant Zone 4. Severity critical.',
      offsetMinutes: 0,
    },
    {
      id: '40000000-0000-4000-8000-000000000021',
      eventType: 'observation',
      actorType: 'system',
      actorName: 'Thermal sensor TS-7A',
      content: 'Smoke detected near Machine 7 following a thermal sensor alarm on the drive housing.',
      offsetMinutes: 1,
    },
    {
      id: '40000000-0000-4000-8000-000000000022',
      eventType: 'observation',
      actorType: 'human',
      actorName: 'A. Reyes (Shift Lead)',
      content: 'Worker exited restricted Zone 4 and is accounted for at the muster point.',
      offsetMinutes: 4,
    },
    {
      id: '40000000-0000-4000-8000-000000000023',
      eventType: 'observation',
      actorType: 'system',
      actorName: 'Pressure sensor PT-8B',
      content: 'Pressure reading increasing on the Machine 8 header; currently 12% above nominal and rising slowly.',
      offsetMinutes: 6,
    },
    {
      id: '40000000-0000-4000-8000-000000000024',
      eventType: 'observation',
      actorType: 'system',
      actorName: 'Cell power monitor',
      content: 'Main power to the Zone 4 cell remains active; Machine 7 is still energized.',
      offsetMinutes: 7,
    },
  ],
  memories: [],
};

/** Quick-action buttons shown on the Command Center in demo mode. */
export const DEMO_QUICK_OBSERVATIONS = [
  'Smoke intensity increasing near the Machine 7 drive housing.',
  'Pressure rising in Machine 8 header, now 18% above nominal.',
  'Worker accounted for at the Zone 4 muster point.',
];

/** The proposed action that triggers the counterfactual warning in the demo. */
export const DEMO_PROPOSED_ACTION =
  'Shut down and restart Machine 7 immediately to stop the smoke.';

export const DEMO_MEMORY_QUERY =
  'What happened when Machine 7 was restarted before pressure isolation?';

export function allSeedIncidents(): SeedIncident[] {
  return [...SEED_HISTORICAL_INCIDENTS, SEED_ACTIVE_INCIDENT];
}

/** Every memory row that should exist after seeding, with its source incident. */
export function allSeedMemories(): {
  memory: SeedMemory;
  incident: SeedIncident | null;
}[] {
  const rows: { memory: SeedMemory; incident: SeedIncident | null }[] = [];
  for (const incident of SEED_HISTORICAL_INCIDENTS) {
    for (const memory of incident.memories) rows.push({ memory, incident });
  }
  for (const memory of SEED_PROCEDURE_MEMORIES) rows.push({ memory, incident: null });
  return rows;
}
