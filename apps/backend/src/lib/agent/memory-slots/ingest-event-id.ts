export type MemoryIngestEventSelector =
  { kind: 'turn'; turnKey: string } | { kind: 'memory'; memoryId: string }

/** Parse every memory-ingest chip id emitted by the runtime or synthesized by
 * the desktop. Older persisted transcripts keep these ids indefinitely. */
export function parseMemoryIngestEventId(eventId: string): MemoryIngestEventSelector | null {
  const markers = [
    { marker: ':auto-ingest-turn:', kind: 'turn' as const },
    { marker: ':auto-ingest:', kind: 'memory' as const },
    { marker: ':memory-saved:', kind: 'memory' as const },
  ]

  for (const { marker, kind } of markers) {
    const at = eventId.indexOf(marker)

    if (at === -1) continue
    const value = eventId.slice(at + marker.length)

    if (!value) return null

    return kind === 'turn' ? { kind, turnKey: value } : { kind, memoryId: value }
  }

  return null
}
