import { describe, expect, test } from 'bun:test'

import { makeSideCallTokenUsageRecords, recordSideCallTokenUsage } from './token-usage-side-call'

const usage = {
  inputTokens: 100_000,
  outputTokens: 1_000,
  totalTokens: 101_000,
  cachedInputTokens: 50_000,
  inputTokenDetails: { cacheReadTokens: 50_000, cacheWriteTokens: 30_000 },
}

const base = {
  operation: 'stop_gate.judge',
  callId: 'call-abc',
  modelId: 'claude-opus-5',
  context: { sessionId: 'session-1', userId: 'user-1', teamId: 'team-1' },
  usage,
}

describe('makeSideCallTokenUsageRecords', () => {
  test('records a Vertex side call with full billing attribution', () => {
    const records = makeSideCallTokenUsageRecords(base)
    const stepTotal = records.find((r) => r.kind === 'step_total')!

    expect(stepTotal).toMatchObject({
      sessionId: 'session-1',
      userId: 'user-1',
      teamId: 'team-1',
      operation: 'stop_gate.judge',
      modelId: 'claude-opus-5',
      source: 'ai-sdk',
    })
    expect(stepTotal.tokens.cacheWriteTokens).toBe(30_000)
    expect(stepTotal.providerCostUsd).toBeCloseTo(
      (20_000 * 5 + 50_000 * 0.5 + 30_000 * 6.25 + 1_000 * 25) / 1e6,
      10,
    )
  })

  test('the record id is unique per call and stable across retries of the write', () => {
    const first = makeSideCallTokenUsageRecords(base)
    const retry = makeSideCallTokenUsageRecords(base)
    const other = makeSideCallTokenUsageRecords({ ...base, callId: 'call-def' })

    expect(first[0]!.recordId).toBe(retry[0]!.recordId)
    expect(first[0]!.recordId).not.toBe(other[0]!.recordId)
    expect(first[0]!.recordId).toContain('stop_gate.judge')
    expect(first[0]!.recordId).toContain('call-abc')
  })

  test('two operations in the same session never share a record id', () => {
    const judge = makeSideCallTokenUsageRecords(base)
    const memory = makeSideCallTokenUsageRecords({ ...base, operation: 'memory.rerank' })

    expect(judge[0]!.recordId).not.toBe(memory[0]!.recordId)
  })

  test('never fabricates tokens for a call the provider reported no usage for', () => {
    expect(makeSideCallTokenUsageRecords({ ...base, usage: undefined })).toEqual([])
    expect(makeSideCallTokenUsageRecords({ ...base, usage: {} })).toEqual([])
  })

  test('drops the record when there is no user to attribute it to', () => {
    expect(makeSideCallTokenUsageRecords({ ...base, context: { sessionId: 'session-1' } })).toEqual(
      [],
    )
  })

  test('a sessionless side call still bills the team under a synthetic session id', () => {
    const records = makeSideCallTokenUsageRecords({
      ...base,
      operation: 'starter_suggestions',
      context: { userId: 'user-1', teamId: 'team-1' },
    })
    const stepTotal = records.find((r) => r.kind === 'step_total')!

    expect(stepTotal.sessionId).toBe('starter_suggestions:user-1')
    expect(stepTotal.teamId).toBe('team-1')
  })

  test('normalizes a null teamId to absent rather than storing null', () => {
    const records = makeSideCallTokenUsageRecords({
      ...base,
      context: { sessionId: 's', userId: 'u', teamId: null },
    })

    expect(records[0]!.teamId).toBeUndefined()
    expect('teamId' in records[0]!).toBe(false)
  })

  test('a team-scoped job with no human user bills under an explicit system user', () => {
    // Cost-insight generation is scheduled per team, not per user, but the
    // tokens are still the team's spend — dropping the row would reopen the
    // very Mongo-vs-BigQuery gap this exists to close.
    const records = makeSideCallTokenUsageRecords({
      ...base,
      operation: 'cost_insight',
      context: { teamId: 'team-1' },
      systemUserId: 'system:cost-insight',
    })
    const stepTotal = records.find((r) => r.kind === 'step_total')!

    expect(stepTotal.userId).toBe('system:cost-insight')
    expect(stepTotal.teamId).toBe('team-1')
    expect(stepTotal.sessionId).toBe('cost_insight:system:cost-insight')
  })

  test('a real user always wins over the system fallback', () => {
    const records = makeSideCallTokenUsageRecords({ ...base, systemUserId: 'system:x' })

    expect(records[0]!.userId).toBe('user-1')
  })

  test('side calls are tagged background so they never eat the included plan', () => {
    const records = makeSideCallTokenUsageRecords(base)

    for (const record of records) expect(record.billing).toBe('background')
  })
})

describe('recordSideCallTokenUsage is safe to await', () => {
  test('a write failure is swallowed, so awaiting can never fail the caller', async () => {
    // No Mongo connection in unit tests: the underlying write throws, and the
    // helper must absorb it — otherwise awaiting would flip fail-open judges
    // into their failure branch.
    await expect(
      recordSideCallTokenUsage({
        operation: 'stop_gate.judge',
        callId: 'call-1',
        modelId: 'claude-opus-5',
        context: { sessionId: 's', userId: 'u', teamId: 't' },
        usage,
      }),
    ).resolves.toBeUndefined()
  })

  test('a call with no usage resolves without touching the database at all', async () => {
    await expect(
      recordSideCallTokenUsage({
        operation: 'stop_gate.judge',
        callId: 'call-2',
        modelId: 'claude-opus-5',
        context: { sessionId: 's', userId: 'u' },
        usage: undefined,
      }),
    ).resolves.toBeUndefined()
  })
})

describe('attribution uses real metadata, never a synthetic stand-in', () => {
  test('a real sessionId wins over the synthetic fallback', () => {
    const records = makeSideCallTokenUsageRecords({
      ...base,
      operation: 'memory.conflict',
      context: { sessionId: 'conversation-42', userId: 'user-1', teamId: 'team-1' },
    })

    expect(records[0]!.sessionId).toBe('conversation-42')
    expect(records[0]!.sessionId).not.toContain('memory.conflict:')
  })

  test('the synthetic id is only reached when there is genuinely no conversation', () => {
    const records = makeSideCallTokenUsageRecords({
      ...base,
      operation: 'memory.conflict',
      context: { userId: 'user-1', teamId: 'team-1' },
    })

    expect(records[0]!.sessionId).toBe('memory.conflict:user-1')
  })
})
