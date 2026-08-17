'use client';

import { useState } from 'react';
import { Modal } from '@/components/shell/modal';
import type { Incident, IncidentPhase, Severity } from '@/lib/types';

const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];
const PHASES: IncidentPhase[] = ['detection', 'assessment', 'containment'];

export function NewIncidentDialog({
  open,
  responder,
  onClose,
  onCreated,
}: {
  open: boolean;
  responder: string;
  onClose: () => void;
  onCreated: (incident: Incident) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [severity, setSeverity] = useState<Severity>('high');
  const [phase, setPhase] = useState<IncidentPhase>('detection');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description,
          location,
          severity,
          currentPhase: phase,
          reportedBy: responder,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Failed to open incident');

      setTitle('');
      setDescription('');
      setLocation('');
      onCreated(payload.incident as Incident);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to open incident');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Open a new incident"
      description="Creates an incident record and the first durable memory event."
    >
      <form onSubmit={submit} className="space-y-3.5">
        <div>
          <label htmlFor="incident-title" className="mb-1 block text-xs font-medium text-muted">
            Title
          </label>
          <input
            id="incident-title"
            required
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Smoke detected near Machine 7"
            className="field"
          />
        </div>

        <div>
          <label htmlFor="incident-location" className="mb-1 block text-xs font-medium text-muted">
            Location
          </label>
          <input
            id="incident-location"
            required
            maxLength={160}
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="Assembly Plant · Zone 4"
            className="field"
          />
        </div>

        <div>
          <label
            htmlFor="incident-description"
            className="mb-1 block text-xs font-medium text-muted"
          >
            What is happening?
          </label>
          <textarea
            id="incident-description"
            required
            rows={3}
            maxLength={2000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Describe what has been observed. Facts only — Sentinel will not invent readings."
            className="field resize-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="incident-severity" className="mb-1 block text-xs font-medium text-muted">
              Severity
            </label>
            <select
              id="incident-severity"
              value={severity}
              onChange={(event) => setSeverity(event.target.value as Severity)}
              className="field cursor-pointer"
            >
              {SEVERITIES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="incident-phase" className="mb-1 block text-xs font-medium text-muted">
              Phase
            </label>
            <select
              id="incident-phase"
              value={phase}
              onChange={(event) => setPhase(event.target.value as IncidentPhase)}
              className="field cursor-pointer"
            >
              {PHASES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <p className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-critical">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <button type="submit" disabled={submitting} className="btn-neutral">
            {submitting ? 'Opening…' : 'Open incident'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
