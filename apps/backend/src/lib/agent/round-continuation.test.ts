import { describe, expect, test } from 'bun:test'

import { pausedTurnKind } from './round-continuation'

describe('pausedTurnKind', () => {
  // A headless turn has no Stop button, so the wall-clock ceiling is the only
  // thing that ends a loop of successful tool calls. It must read as work cut
  // short, not as a stall.
  test('the headless turn deadline reads as a spent budget, not a stall', () => {
    expect(pausedTurnKind('turn-deadline')).toBe('budget-exhausted')
  })

  test('separates a spent budget from a stalled turn', () => {
    expect(pausedTurnKind('output-budget')).toBe('budget-exhausted')
    expect(pausedTurnKind('model-silence')).toBe('stalled')
    expect(pausedTurnKind('tool-execution-timeout')).toBe('stalled')
    expect(pausedTurnKind(undefined)).toBe('stalled')
  })
})
