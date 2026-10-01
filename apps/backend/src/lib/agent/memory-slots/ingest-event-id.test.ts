import { describe, expect, test } from 'bun:test'

import { parseMemoryIngestEventId } from './ingest-event-id'

describe('parseMemoryIngestEventId', () => {
  test('recognizes turn-key ids synthesized by post-stream polling', () => {
    expect(parseMemoryIngestEventId('session:auto-ingest-turn:turn-1')).toEqual({
      kind: 'turn',
      turnKey: 'turn-1',
    })
  })

  test('recognizes runtime auto-ingest and explicit-save memory ids', () => {
    expect(parseMemoryIngestEventId('session:auto-ingest:memory-1')).toEqual({
      kind: 'memory',
      memoryId: 'memory-1',
    })
    expect(parseMemoryIngestEventId('session:memory-saved:memory-2')).toEqual({
      kind: 'memory',
      memoryId: 'memory-2',
    })
  })

  test('rejects foreign and empty ids', () => {
    expect(parseMemoryIngestEventId('legacy:event')).toBeNull()
    expect(parseMemoryIngestEventId('session:auto-ingest-turn:')).toBeNull()
  })
})
