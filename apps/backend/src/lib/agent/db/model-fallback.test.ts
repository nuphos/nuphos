import { describe, expect, test } from 'bun:test'

import { buildModelFallbackMark, pickModelFallbackModelId } from './conversations'

describe('buildModelFallbackMark', () => {
  const now = new Date('2026-08-17T12:00:00.000Z')

  test('guards on the field being absent so repeated turns cannot rewrite it', () => {
    const { filter } = buildModelFallbackMark(
      's1',
      { fromModelId: 'claude-opus-5', toModelId: 'claude-opus-4-8' },
      now,
    )

    // The once-guard: a doc that already carries modelFallback never matches,
    // so firstTriggeredAt survives every later content-filter turn.
    expect(filter).toEqual({ sessionId: 's1', modelFallback: { $exists: false } })
  })

  test('records the switch with a server timestamp and content-filter reason', () => {
    const { update } = buildModelFallbackMark(
      's1',
      { fromModelId: 'claude-opus-5', toModelId: 'claude-opus-4-8' },
      now,
    )

    expect(update.$set.modelFallback).toEqual({
      active: true,
      reason: 'content-filter',
      firstTriggeredAt: now,
      fromModelId: 'claude-opus-5',
      toModelId: 'claude-opus-4-8',
    })
  })
})

describe('pickModelFallbackModelId', () => {
  test('returns the fallback model id when the conversation is flagged active', () => {
    expect(
      pickModelFallbackModelId({
        active: true,
        reason: 'content-filter',
        firstTriggeredAt: new Date(),
        fromModelId: 'claude-opus-5',
        toModelId: 'claude-opus-4-8',
      }),
    ).toBe('claude-opus-4-8')
  })

  // Mirrors selectChatModels/resolveTurnModelId: the picked id (or the primary
  // when there is none) is the model the turn runs on.
  test('drives selection: active picks the fallback, inactive/absent keeps the primary', () => {
    const primary = 'claude-opus-5'
    const active = {
      active: true,
      reason: 'content-filter' as const,
      firstTriggeredAt: new Date(),
      fromModelId: primary,
      toModelId: 'claude-opus-4-8',
    }

    expect(pickModelFallbackModelId(active) ?? primary).toBe('claude-opus-4-8')
    expect(pickModelFallbackModelId({ ...active, active: false }) ?? primary).toBe(primary)
    expect(pickModelFallbackModelId(undefined) ?? primary).toBe(primary)
  })

  test('returns null when inactive or absent', () => {
    expect(
      pickModelFallbackModelId({
        active: false,
        reason: 'content-filter',
        firstTriggeredAt: new Date(),
        fromModelId: 'claude-opus-5',
        toModelId: 'claude-opus-4-8',
      }),
    ).toBeNull()
    expect(pickModelFallbackModelId(undefined)).toBeNull()
  })
})
