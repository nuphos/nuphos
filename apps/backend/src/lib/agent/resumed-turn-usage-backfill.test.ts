import { describe, expect, test } from 'bun:test'

import { resumedTurnDecisions } from './resumed-turn-usage-backfill'

import type { ResumedUsageRow } from './resumed-turn-usage-backfill'

let n = 0
const row = (
  minute: number,
  inputTokens: number,
  outputTokens: number,
  modelId = 'claude-opus-5-5',
): ResumedUsageRow => ({
  recordId: `r${n++}`,
  modelId,
  createdAt: new Date(Date.UTC(2026, 10, 20, 0, minute)),
  tokens: { inputTokens, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens },
})
const after = (inputTokens: number, outputTokens: number) => ({
  inputTokens,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens,
})

describe('resumedTurnDecisions', () => {
  test('a restored reading becomes its own turn: minus the previous reading and the turns between', () => {
    const decisions = resumedTurnDecisions([
      ...Array.from({ length: 6 }, (_, i) => row(i, 100_000, 100)),
      row(10, 50_000_000, 5_000), // chain start
      row(11, 100_000, 100),
      row(12, 100_000, 100),
      row(20, 50_300_000, 5_300), // 50M + two turns + its own 100k/100
    ])

    expect(decisions.map((d) => d.action === 'correct' && [d.method, d.after])).toEqual([
      ['chain_start_estimate', after(100_000, 100)],
      ['chain_diff', after(100_000, 100)],
    ])
  })

  test('every model in a restored result is corrected, even one too small to flag', () => {
    const decisions = resumedTurnDecisions([
      ...Array.from({ length: 4 }, (_, i) => row(i, 100_000, 100)),
      row(1, 60_000, 20, 'claude-haiku-5-5'),
      row(10, 50_000_000, 5_000),
      row(10, 60_000, 20, 'claude-haiku-5-5'),
      row(20, 50_200_000, 5_200),
      row(20, 60_000, 20, 'claude-haiku-5-5'),
    ])
    const haiku = decisions.filter((d) => d.modelId === 'claude-haiku-5-5')

    expect(haiku.map((d) => d.action === 'correct' && d.after)).toEqual([
      after(60_000, 20),
      after(0, 0),
    ])
  })

  test('an estimate never raises a recorded value', () => {
    const decisions = resumedTurnDecisions([
      ...Array.from({ length: 4 }, (_, i) => row(i, 100_000, 100)),
      ...Array.from({ length: 4 }, (_, i) => row(i, 60_000, 20, 'claude-haiku-5-5')),
      row(10, 50_000_000, 5_000),
      row(10, 2_000, 500, 'claude-haiku-5-5'),
    ])
    const haiku = decisions.find((d) => d.modelId === 'claude-haiku-5-5')

    expect(haiku?.action === 'correct' && haiku.after).toEqual(after(2_000, 20))
  })

  test('a reading that grew less than the turns between is left for a person', () => {
    const [, second] = resumedTurnDecisions([
      ...Array.from({ length: 6 }, (_, i) => row(i, 100_000, 100)),
      row(10, 50_000_000, 5_000),
      row(11, 100_000, 10_000),
      row(20, 50_200_000, 5_200),
    ])

    expect(second).toMatchObject({ action: 'manual', reason: expect.stringMatching(/^negative/) })
  })

  test('a lower reading restarts the chain instead of going negative', () => {
    const decisions = resumedTurnDecisions([
      ...Array.from({ length: 6 }, (_, i) => row(i, 100_000, 100)),
      row(10, 50_000_000, 5_000),
      row(20, 40_000_000, 4_000),
    ])

    expect(decisions.map((d) => d.action === 'correct' && d.method)).toEqual([
      'chain_start_estimate',
      'chain_start_estimate',
    ])
  })

  test('a rerun reads corrected rows as recorded and does not touch them again', () => {
    const rows = [
      ...Array.from({ length: 6 }, (_, i) => row(i, 100_000, 100)),
      row(10, 50_000_000, 5_000),
      row(20, 50_100_000, 5_100),
    ]
    const first = resumedTurnDecisions(rows)
    const corrected = rows.map((r) => {
      const d = first.find((x) => x.recordId === r.recordId)

      return d?.action === 'correct' ? { ...r, tokens: d.after, original: d.before } : r
    })

    expect(resumedTurnDecisions(corrected).map((d) => d.action)).toEqual([
      'already_corrected',
      'already_corrected',
    ])
  })

  test('ordinary sessions produce no decisions', () => {
    expect(resumedTurnDecisions([row(0, 100_000, 100), row(1, 9_000_000, 900)])).toEqual([])
  })
})
