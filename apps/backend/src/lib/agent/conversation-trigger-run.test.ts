import { describe, expect, test } from 'bun:test'

import { buildTriggerRunStamp, normalizeConversationTriggerRun } from './conversation-trigger-run'

// The stamp decides where a conversation lives: stamped ones are a Trigger's
// run history, unstamped ones are Chats. Reading it back has to be strict about
// the id — a half-written stamp that still normalized to "some run" would put a
// conversation in a Runs list nothing links to.

describe('normalizeConversationTriggerRun', () => {
  test('an unstamped conversation is not a run', () => {
    expect(normalizeConversationTriggerRun(undefined)).toBeNull()
    expect(normalizeConversationTriggerRun({})).toBeNull()
    expect(normalizeConversationTriggerRun({ source: 'app' })).toBeNull()
  })

  test('a scheduled run carries its trigger and kind', () => {
    expect(
      normalizeConversationTriggerRun({
        trigger: { id: '6512f0a1b2c3d4e5f6a7b8c9', kind: 'scheduled' },
      }),
    ).toEqual({ id: '6512f0a1b2c3d4e5f6a7b8c9', kind: 'scheduled' })
  })

  test('an unrecognised kind is dropped rather than shown as a real one', () => {
    expect(
      normalizeConversationTriggerRun({
        trigger: { id: '6512f0a1b2c3d4e5f6a7b8c9', kind: 'yolo' },
      }),
    ).toEqual({ id: '6512f0a1b2c3d4e5f6a7b8c9' })
  })

  test('a stamp without an id attributes to nothing, so it is not a run', () => {
    expect(normalizeConversationTriggerRun({ trigger: { kind: 'scheduled' } })).toBeNull()
    expect(normalizeConversationTriggerRun({ trigger: { id: '' } })).toBeNull()
    expect(normalizeConversationTriggerRun({ trigger: 'nope' })).toBeNull()
  })

  test('every kind the executor can write survives the round trip', () => {
    for (const kind of ['scheduled', 'webhook', 'manual'] as const) {
      expect(
        normalizeConversationTriggerRun({ trigger: { id: '6512f0a1b2c3d4e5f6a7b8c9', kind } }),
      ).toEqual({ id: '6512f0a1b2c3d4e5f6a7b8c9', kind })
    }
  })
})

describe('buildTriggerRunStamp', () => {
  const TRIGGER = '6512f0a1b2c3d4e5f6a7b8c9'

  test('a standalone run is just its trigger and kind', () => {
    expect(buildTriggerRunStamp({ triggerId: TRIGGER, runKind: 'scheduled' })).toEqual({
      id: TRIGGER,
      kind: 'scheduled',
    })
  })
})
