import { describe, expect, test } from 'bun:test'

import {
  affectedSessionsPipeline,
  backfillCostDeltaUsd,
  backfillPatchForRecord,
} from './token-usage-backfill'

import type { AgentTokenUsageRecord } from './token-usage-db'

// A real-shaped legacy row: rawUsage kept Anthropic's cache_creation count, but
// tokens/ never had a place to put it, so the row priced its cache writes at
// the plain input rate.
const legacyStepTotal = {
  recordId: 'stream:req:step:0:step_total',
  sessionId: 'session-1',
  userId: 'user-1',
  teamId: 'team-1',
  operation: 'chat',
  source: 'ai-sdk',
  kind: 'step_total',
  accounting: 'upstream_reported',
  billing: 'billable',
  provider: 'vertex.anthropic',
  modelId: 'claude-opus-5',
  providerCostUsd: (20_000 * 5 + 50_000 * 0.5 + 30_000 * 5 + 1_000 * 25) / 1e6,
  tokens: {
    inputTokens: 100_000,
    outputTokens: 1_000,
    totalTokens: 101_000,
    cachedInputTokens: 50_000,
  },
  rawUsage: {
    inputTokens: 100_000,
    outputTokens: 1_000,
    cachedInputTokens: 50_000,
    raw: {
      input_tokens: 20_000,
      cache_read_input_tokens: 50_000,
      cache_creation_input_tokens: 30_000,
      output_tokens: 1_000,
    },
  },
  createdAt: new Date('2026-08-01T00:00:00Z'),
} as unknown as AgentTokenUsageRecord

const correctedCostUsd = (20_000 * 5 + 50_000 * 0.5 + 30_000 * 6.25 + 1_000 * 25) / 1e6

describe('backfillPatchForRecord', () => {
  test('recovers cacheWriteTokens from rawUsage, leaving the settled cost alone', () => {
    const patch = backfillPatchForRecord(legacyStepTotal)!

    expect(patch.recordId).toBe(legacyStepTotal.recordId)
    expect(patch.set['tokens.cacheWriteTokens']).toBe(30_000)
    // See the 'never raises billing-authoritative cost' block below.
    expect(patch.set.providerCostUsd).toBeUndefined()
  })

  test('is idempotent: a row already carrying cacheWriteTokens is left alone', () => {
    const done = {
      ...legacyStepTotal,
      tokens: { ...legacyStepTotal.tokens, cacheWriteTokens: 30_000 },
    }

    expect(backfillPatchForRecord(done)).toBeNull()
  })

  test('patches the input row too, and never invents a cost it does not own', () => {
    const inputRow = {
      ...legacyStepTotal,
      recordId: 'stream:req:step:0:input',
      kind: 'input',
      providerCostUsd: undefined,
      tokens: { inputTokens: 100_000, cachedInputTokens: 50_000 },
    } as unknown as AgentTokenUsageRecord
    const patch = backfillPatchForRecord(inputRow)!

    expect(patch.set['tokens.cacheWriteTokens']).toBe(30_000)
    expect(patch.set.providerCostUsd).toBeUndefined()
  })

  test('leaves output/thinking rows untouched — they carry no prompt classes', () => {
    for (const kind of ['output', 'thinking', 'tool_call']) {
      expect(
        backfillPatchForRecord({ ...legacyStepTotal, kind } as unknown as AgentTokenUsageRecord),
      ).toBeNull()
    }
  })

  test('never invents a count: no rawUsage, or no cache write in it, means no patch', () => {
    expect(
      backfillPatchForRecord({
        ...legacyStepTotal,
        rawUsage: undefined,
      } as unknown as AgentTokenUsageRecord),
    ).toBeNull()
    expect(
      backfillPatchForRecord({
        ...legacyStepTotal,
        rawUsage: { inputTokens: 100_000, outputTokens: 1_000 },
      } as unknown as AgentTokenUsageRecord),
    ).toBeNull()
  })

  test('a zero cache write is still written, so the row stops looking un-backfilled', () => {
    const patch = backfillPatchForRecord({
      ...legacyStepTotal,
      rawUsage: { ...legacyStepTotal.rawUsage, raw: { cache_creation_input_tokens: 0 } },
    } as unknown as AgentTokenUsageRecord)!

    expect(patch.set['tokens.cacheWriteTokens']).toBe(0)
  })

  test('an unpriced model gets its tokens fixed but no fabricated cost', () => {
    const patch = backfillPatchForRecord({
      ...legacyStepTotal,
      modelId: 'gemini-2.5-flash-lite',
    } as unknown as AgentTokenUsageRecord)!

    expect(patch.set['tokens.cacheWriteTokens']).toBe(30_000)
    expect(patch.set.providerCostUsd).toBeUndefined()
  })
})

describe('backfillCostDeltaUsd', () => {
  test('reports the under-billed amount without crediting anything', () => {
    const delta = backfillCostDeltaUsd(legacyStepTotal, backfillPatchForRecord(legacyStepTotal)!)

    // 30k cache-write tokens moving from $5/M to $6.25/M.
    expect(delta).toBeCloseTo((30_000 * 1.25) / 1e6, 10)
  })

  test('still reports the shortfall for rows that never froze a cost', () => {
    const row = { ...legacyStepTotal, providerCostUsd: undefined } as AgentTokenUsageRecord

    expect(backfillCostDeltaUsd(row, backfillPatchForRecord(row)!)).toBeCloseTo(
      (30_000 * 1.25) / 1e6,
      10,
    )
  })

  test('is zero for the input projection, which carries no cost of its own', () => {
    const inputRow = {
      ...legacyStepTotal,
      recordId: 'stream:req:step:0:input',
      kind: 'input',
      providerCostUsd: undefined,
      tokens: { inputTokens: 100_000, cachedInputTokens: 50_000 },
    } as unknown as AgentTokenUsageRecord

    expect(backfillCostDeltaUsd(inputRow, backfillPatchForRecord(inputRow)!)).toBe(0)
  })

  test('is zero when the model has no known price', () => {
    const row = {
      ...legacyStepTotal,
      modelId: 'gemini-2.5-flash-lite',
      providerCostUsd: undefined,
    } as unknown as AgentTokenUsageRecord

    expect(backfillCostDeltaUsd(row, backfillPatchForRecord(row)!)).toBe(0)
  })
})

// usage-boundary.ts reads step_total rows directly to rebuild partial
// cycle-boundary hours, and overage.ts settles from that. Raising a historical
// providerCostUsd therefore RETROACTIVELY charges a team for our own
// under-count. The backfill fixes tokens only; display cost is recomputed on
// read by withCostUsd, so the UI still shows the corrected figure.
describe('backfill never raises billing-authoritative cost', () => {
  test('a frozen providerCostUsd is left exactly as settled', () => {
    const patch = backfillPatchForRecord(legacyStepTotal)!

    expect(patch.set.providerCostUsd).toBeUndefined()
    expect('providerCostUsd' in patch.set).toBe(false)
    expect(patch.set['tokens.cacheWriteTokens']).toBe(30_000)
  })

  test('a row with no frozen cost gets the PRE-fix cost frozen, not the corrected one', () => {
    // Otherwise usage-boundary's fallback would recompute from the new tokens
    // and quietly bill the difference on the next partial hour.
    const unfrozen = {
      ...legacyStepTotal,
      providerCostUsd: undefined,
    } as unknown as AgentTokenUsageRecord
    const patch = backfillPatchForRecord(unfrozen)!

    expect(patch.set.providerCostUsd).toBeCloseTo(
      (20_000 * 5 + 50_000 * 0.5 + 30_000 * 5 + 1_000 * 25) / 1e6,
      10,
    )
    expect(patch.set.providerCostUsd).toBeLessThan(correctedCostUsd)
  })

  test('an unpriced model with no frozen cost still gets no fabricated cost', () => {
    const patch = backfillPatchForRecord({
      ...legacyStepTotal,
      modelId: 'gemini-2.5-flash-lite',
      providerCostUsd: undefined,
    } as unknown as AgentTokenUsageRecord)!

    expect(patch.set.providerCostUsd).toBeUndefined()
  })

  test('the reported delta is what WOULD have been charged, and is never applied', () => {
    const patch = backfillPatchForRecord(legacyStepTotal)!

    expect(backfillCostDeltaUsd(legacyStepTotal, patch)).toBeCloseTo((30_000 * 1.25) / 1e6, 10)
    expect(patch.set.providerCostUsd).toBeUndefined()
  })
})

// A crash between "rows patched" and "summaries refreshed" must be repairable
// by rerunning the command. Collecting sessions only while walking the
// missing-cacheWriteTokens candidates cannot do that: the rerun finds no
// candidates (they are already patched) and so never revisits their stale
// conversation summaries.
describe('affectedSessionsPipeline', () => {
  const from = new Date('2026-07-01T00:00:00Z')
  const to = new Date('2026-08-08T00:00:00Z')

  test('rediscovers sessions from the window, not from the patch candidates', () => {
    const pipeline = affectedSessionsPipeline({ from, to })
    const match = (pipeline[0] as any).$match

    expect(match.createdAt).toEqual({ $gte: from, $lt: to })
    // Crucially NOT `'tokens.cacheWriteTokens': { $exists: false }` — that is
    // the candidate filter, and it is empty on a rerun.
    expect(match['tokens.cacheWriteTokens']).toEqual({ $exists: true })
  })

  test('yields one entry per conversation, carrying the team for the summary write', () => {
    const pipeline = affectedSessionsPipeline({ from, to })
    const group = (pipeline[1] as any).$group

    expect(group._id).toEqual({ sessionId: '$sessionId', userId: '$userId' })
    expect(group.teamId).toEqual({ $first: '$teamId' })
    expect(JSON.stringify(pipeline)).not.toContain('$out')
    expect(JSON.stringify(pipeline)).not.toContain('$merge')
  })

  test('is read-only and independent of how far a previous run got', () => {
    const first = affectedSessionsPipeline({ from, to })
    const rerun = affectedSessionsPipeline({ from, to })

    expect(rerun).toEqual(first)
  })
})
