import { describe, expect, test } from 'bun:test'

import {
  MAX_BUDGET_CONTINUATIONS,
  MAX_STEER_CONTINUATIONS,
  budgetContinuationNudge,
  budgetPauseKind,
  decideRoundOutcome,
  pausedTurnKind,
} from './round-continuation'
import { MAX_STOP_GATE_CONTINUATIONS } from './stop-gate'

import type { RoundDecisionInput } from './round-continuation'

function decide(overrides: Partial<RoundDecisionInput> = {}) {
  return decideRoundOutcome({
    finishReason: 'length',
    aborted: false,
    authPending: false,
    runawayNudged: false,
    budgetContinuations: 0,
    stopGateContinuations: 0,
    pendingUserMessages: false,
    steerContinuations: 0,
    ...overrides,
  })
}

describe('budgetPauseKind', () => {
  test('the output-token cap is the only budget pause', () => {
    expect(budgetPauseKind('length')).toBe('output-budget')
  })

  // There is no step cap, so a round that ends mid-tool-call ended at the Auto
  // Mode approval gate. Replaying it would talk over the approve/deny.
  test('a tool-calls finish is not a budget pause', () => {
    expect(budgetPauseKind('tool-calls')).toBeNull()
  })

  test('is null for finishes that would reproduce on replay', () => {
    for (const finishReason of ['stop', 'error', 'content-filter', 'other', undefined]) {
      expect(budgetPauseKind(finishReason)).toBeNull()
    }
  })
})

describe('decideRoundOutcome', () => {
  test('continues a headless output-budget pause', () => {
    expect(decide()).toEqual({ next: 'budget-continuation', pause: 'output-budget' })
  })

  test('ends a round that stopped mid-tool-call instead of replaying it', () => {
    expect(decide({ finishReason: 'tool-calls' })).toEqual({ next: 'end' })
  })

  // No client re-issues a paused turn, so every surface — in-app included —
  // recovers its own truncation here or delivers half a message.
  test('continues a budget pause on every surface', () => {
    expect(decide()).toEqual({ next: 'budget-continuation', pause: 'output-budget' })
  })

  // Continuing here would talk over the approve/deny buttons the user is
  // looking at.
  test('never continues a turn awaiting authorization', () => {
    expect(decide({ authPending: true })).toEqual({ next: 'end' })
  })

  test('never continues an aborted turn', () => {
    expect(decide({ aborted: true })).toEqual({ next: 'end' })
  })

  // A fresh budget would restart the loop the wrap-up just tried to stop.
  test('never hands a fresh budget to a round the runaway wrap-up already hit', () => {
    expect(decide({ runawayNudged: true })).toEqual({ next: 'end' })
  })

  test('still lets a runaway round end through the stop gate', () => {
    expect(decide({ runawayNudged: true, finishReason: 'stop' })).toEqual({ next: 'stop-gate' })
  })

  test('stops continuing once the budget ceiling is spent', () => {
    expect(decide({ budgetContinuations: MAX_BUDGET_CONTINUATIONS - 1 })).toEqual({
      next: 'budget-continuation',
      pause: 'output-budget',
    })
    expect(decide({ budgetContinuations: MAX_BUDGET_CONTINUATIONS })).toEqual({ next: 'end' })
  })

  test('ends on finishes that would reproduce on replay', () => {
    expect(decide({ finishReason: 'content-filter' })).toEqual({ next: 'end' })
    expect(decide({ finishReason: undefined })).toEqual({ next: 'end' })
  })

  test('routes a clean stop to the stop gate until its own ceiling', () => {
    expect(decide({ finishReason: 'stop' })).toEqual({ next: 'stop-gate' })
    expect(
      decide({ finishReason: 'stop', stopGateContinuations: MAX_STOP_GATE_CONTINUATIONS }),
    ).toEqual({ next: 'end' })
  })

  // The two fuses are spent by different causes; a turn that used its stop-gate
  // rounds must still be able to recover from a budget pause, and vice versa.
  test('the two continuation ceilings are independent', () => {
    expect(decide({ stopGateContinuations: MAX_STOP_GATE_CONTINUATIONS })).toEqual({
      next: 'budget-continuation',
      pause: 'output-budget',
    })
    expect(decide({ finishReason: 'stop', budgetContinuations: MAX_BUDGET_CONTINUATIONS })).toEqual(
      { next: 'stop-gate' },
    )
  })
})

describe('budgetContinuationNudge', () => {
  test('numbers the attempt against the ceiling', () => {
    expect(budgetContinuationNudge('output-budget', 0)).toContain(
      `continuation 1 of at most ${String(MAX_BUDGET_CONTINUATIONS)}`,
    )
    expect(budgetContinuationNudge('output-budget', 3)).toContain('continuation 4 of at most')
  })

  test('tells a truncated message to resume rather than restart', () => {
    expect(budgetContinuationNudge('output-budget', 0)).toContain('Do not restart the message')
  })
})

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

describe('steer continuation', () => {
  test('a message the user sent mid-turn continues the turn instead of ending it', () => {
    expect(decide({ finishReason: 'stop', pendingUserMessages: true })).toEqual({
      next: 'steer-continuation',
    })
  })

  test('it outranks the stop gate and a budget pause — a live person beats a heuristic', () => {
    expect(decide({ finishReason: 'stop', pendingUserMessages: true })).toEqual({
      next: 'steer-continuation',
    })
    expect(decide({ finishReason: 'tool-calls', pendingUserMessages: true })).toEqual({
      next: 'steer-continuation',
    })
  })

  test('it overrides the runaway wrap-up, which a correcting message is often answering', () => {
    expect(decide({ runawayNudged: true, pendingUserMessages: true })).toEqual({
      next: 'steer-continuation',
    })
    expect(decide({ runawayNudged: true, pendingUserMessages: false })).toEqual({ next: 'end' })
  })

  test('an aborted or approval-gated turn is never extended', () => {
    expect(decide({ aborted: true, pendingUserMessages: true })).toEqual({ next: 'end' })
    expect(decide({ authPending: true, pendingUserMessages: true })).toEqual({ next: 'end' })
  })

  test('its own fuse: past the ceiling the message starts a fresh turn instead', () => {
    expect(
      decide({
        finishReason: 'stop',
        pendingUserMessages: true,
        steerContinuations: MAX_STEER_CONTINUATIONS,
      }),
    ).toEqual({ next: 'stop-gate' })
  })

  test('steering does not spend the budget or stop-gate allowances', () => {
    // At the budget ceiling, a steer still runs; the budget fuse is untouched.
    expect(
      decide({
        finishReason: 'tool-calls',
        pendingUserMessages: true,
        budgetContinuations: MAX_BUDGET_CONTINUATIONS,
      }),
    ).toEqual({ next: 'steer-continuation' })
    // And spent steer rounds do not block a budget continuation.
    expect(
      decide({
        finishReason: 'length',
        pendingUserMessages: false,
        steerContinuations: MAX_STEER_CONTINUATIONS,
      }),
    ).toEqual({ next: 'budget-continuation', pause: 'output-budget' })
  })
})
