import { describe, expect, test } from 'bun:test'

import { createTurnMemoryAccumulator } from './turn-accumulator'

import { consumePreviewMemoryActivity, previewMemoryActivityFrame } from './preview-activity'

const accumulator = () => {
  const frames: Record<string, unknown>[] = []
  const acc = createTurnMemoryAccumulator({
    providerId: 'native',
    sessionId: 'session-1',
    userId: 'user-1',
    teamId: 'team-1',
    requestId: 'request-1',
    emitFrame: (frame) => frames.push(frame),
    recordEvent: () => {},
  })

  return { acc, frames }
}

describe('preview memory activity', () => {
  test('merges MCP fetch and save signals into the chat turn without leaking a frame', () => {
    const { acc, frames } = accumulator()

    expect(
      consumePreviewMemoryActivity(
        acc,
        previewMemoryActivityFrame('fetched', {
          id: 'memory-1',
          scope: 'personal',
          label: 'Switched t3 to m7i-flex',
        }),
      ),
    ).toBe(true)
    consumePreviewMemoryActivity(
      acc,
      previewMemoryActivityFrame('saved', {
        id: 'memory-2',
        scope: 'team',
        title: 'Use m7i-flex for the shallow pool',
        action: 'created',
      }),
    )

    expect(acc.view().fetchedIds).toEqual(['memory-1'])
    expect(acc.view().fetchedLabels.get('memory-1')).toBe('Switched t3 to m7i-flex')
    expect(acc.view().savedTitles).toEqual(['Use m7i-flex for the shallow pool'])
    expect(frames).toEqual([])
  })

  test('consumes internal frames even when no turn accumulator is available', () => {
    expect(
      consumePreviewMemoryActivity(
        null,
        previewMemoryActivityFrame('fetched', { id: 'memory-1', scope: 'personal' }),
      ),
    ).toBe(true)
    expect(consumePreviewMemoryActivity(null, { type: 'text-delta', delta: 'visible' })).toBe(false)
  })
})
