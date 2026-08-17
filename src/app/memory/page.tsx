import { getStore } from '@/lib/store';
import { MemoryExplorer } from '@/components/memory-explorer';
import { DEMO_MEMORY_QUERY } from '@/lib/seed-data';

export const dynamic = 'force-dynamic';

const SUGGESTIONS = [
  DEMO_MEMORY_QUERY,
  'Is it safe to open a guard panel while the motor is still running?',
  'What happens when ventilation is increased before the source is isolated?',
  'When has restoring power caused harm?',
];

export default async function MemoryPage() {
  const store = getStore();
  const totalMemories = await store.countMemories();

  return (
    <MemoryExplorer
      demoQuery={DEMO_MEMORY_QUERY}
      suggestions={SUGGESTIONS}
      totalMemories={totalMemories}
      storeKind={store.kind}
    />
  );
}
