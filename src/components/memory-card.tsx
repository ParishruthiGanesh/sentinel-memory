import { ArrowRight, BookOpen, TriangleAlert } from 'lucide-react';
import { Chip, SimilarityBar } from '@/components/ui';
import type { RetrievedMemory } from '@/lib/types';

const TYPE_LABEL: Record<string, string> = {
  incident_summary: 'Incident summary',
  observation: 'Observation',
  action_taken: 'Action taken',
  outcome: 'Outcome',
  lesson_learned: 'Lesson learned',
  safety_procedure: 'Safety procedure',
};

export function MemoryCard({ memory, compact = false }: { memory: RetrievedMemory; compact?: boolean }) {
  const date = memory.incidentDate ?? memory.createdAt;

  return (
    <article className="rounded-lg border border-edge bg-panel2/60 p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] text-info">{memory.incidentCode}</span>
            {memory.severity && (
              <Chip tone={memory.severity === 'critical' ? 'critical' : memory.severity === 'high' ? 'warn' : 'neutral'}>
                {memory.severity}
              </Chip>
            )}
            <Chip>{TYPE_LABEL[memory.memoryType] ?? memory.memoryType}</Chip>
          </div>
          <h4 className="mt-1.5 text-sm font-medium leading-snug text-ink">
            {memory.incidentTitle}
          </h4>
        </div>
        <SimilarityBar value={memory.similarity} />
      </div>

      {!compact && <p className="mt-2.5 text-xs leading-relaxed text-muted">{memory.sourceText}</p>}

      <dl className="mt-3 space-y-2 text-xs">
        {memory.actionTaken && (
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-muted/80">Action taken</dt>
            <dd className="flex-1 text-ink/90">{memory.actionTaken}</dd>
          </div>
        )}
        {memory.outcome && (
          <div className="flex gap-2">
            <dt className="flex w-24 shrink-0 items-center gap-1 text-warn/90">
              <TriangleAlert size={11} aria-hidden />
              Outcome
            </dt>
            <dd className="flex-1 text-warn/90">{memory.outcome}</dd>
          </div>
        )}
        {memory.lessonLearned && (
          <div className="flex gap-2">
            <dt className="flex w-24 shrink-0 items-center gap-1 text-success/90">
              <BookOpen size={11} aria-hidden />
              Lesson
            </dt>
            <dd className="flex-1 text-success/90">{memory.lessonLearned}</dd>
          </div>
        )}
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-edge pt-2 text-[10px] text-muted/70">
        {/* Seeded memory ids share a prefix, so the tail is what distinguishes them. */}
        <span className="font-mono">memory …{memory.id.slice(-8)}</span>
        <ArrowRight size={10} aria-hidden />
        <span>{date ? new Date(date).toLocaleDateString(undefined, { dateStyle: 'medium' }) : 'undated'}</span>
        <span className="font-mono">cosine distance {memory.distance.toFixed(4)}</span>
      </div>
    </article>
  );
}
