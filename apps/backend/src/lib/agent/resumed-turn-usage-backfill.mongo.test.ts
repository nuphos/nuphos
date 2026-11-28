// The backfill's write path against a real MongoDB: what it changes on each row
// of a turn, what it keeps, and what it leaves alone.
// Runs when TEST_MONGODB_URI is set, with MONGODB_URI pointing at the same server.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { closeDb, connectDb } from '@/lib/db'

import {
  applyResumedTurnCorrections,
  RESUMED_TURN_ROWS,
  resumedTurnDecisions,
} from './resumed-turn-usage-backfill'
import { agentTokenUsage } from './token-usage-db'

const SESSION = `${new ObjectId().toHexString()}-resumed`
const USER = new ObjectId().toHexString()
const MODEL = 'claude-opus-5-5'
const at = (minute: number) => new Date(Date.UTC(2026, 10, 20, 0, minute))

/** One turn's rows, as the turn recorder writes them. */
function turn(minute: number, inputTokens: number, outputTokens: number) {
  const base = {
    ...RESUMED_TURN_ROWS,
    sessionId: SESSION,
    userId: USER,
    source: 'agent-runtime' as const,
    modelId: MODEL,
    createdAt: at(minute),
  }
  const row = (kind: 'step_total' | 'input' | 'output', tokens: Record<string, number>) => ({
    ...base,
    recordId: new ObjectId().toHexString(),
    kind,
    tokens,
  })

  return [
    row('step_total', {
      inputTokens,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    }),
    row('input', { inputTokens, cachedInputTokens: 0, cacheWriteTokens: 0 }),
    row('output', { outputTokens }),
  ]
}

async function sessionRows() {
  return agentTokenUsage()
    .find({ sessionId: SESSION }, { projection: { _id: 0 } })
    .sort({ createdAt: 1, kind: 1 })
    .toArray()
}

async function backfill(): Promise<void> {
  const rows = await agentTokenUsage().find({ sessionId: SESSION, kind: 'step_total' }).toArray()
  const decisions = resumedTurnDecisions(
    rows.map((r) => ({
      recordId: r.recordId,
      modelId: r.modelId ?? '',
      createdAt: r.createdAt,
      tokens: r.tokens,
      original: (r as { resumedUsageCorrection?: { original: never } }).resumedUsageCorrection
        ?.original,
    })),
  )

  await applyResumedTurnCorrections(SESSION, decisions)
}

describe.skipIf(!process.env.TEST_MONGODB_URI)('resumed turn usage backfill', () => {
  beforeAll(async () => {
    await connectDb()
    await agentTokenUsage().insertMany([
      ...[0, 1, 2, 3, 4, 5].flatMap((m) => turn(m, 100_000, 100)),
      ...turn(10, 50_000_000, 5_000), // chain start: estimated
      ...turn(11, 100_000, 10_000),
      ...turn(20, 50_200_000, 5_200), // grew less than the turn between: manual
    ] as never)
  })

  afterAll(async () => {
    await agentTokenUsage().deleteMany({ sessionId: SESSION })
    await closeDb()
  })

  test('corrects every row of a restored turn and keeps what was recorded', async () => {
    await backfill()
    const restored = (await sessionRows()).filter((r) => r.createdAt.getTime() === at(10).getTime())
    const kinds = Object.fromEntries(restored.map((r) => [r.kind, r]))
    const original = { inputTokens: 50_000_000, cachedInputTokens: 0, cacheWriteTokens: 0 }
    const marker = {
      original: { ...original, outputTokens: 5_000 },
      method: 'chain_start_estimate',
    }

    expect(restored).toHaveLength(3)
    expect(kinds.step_total).toMatchObject({
      tokens: {
        inputTokens: 100_000,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 100,
        totalTokens: 100_100,
      },
      resumedUsageCorrection: marker,
    })
    expect(kinds.input).toMatchObject({
      tokens: { inputTokens: 100_000, cachedInputTokens: 0, cacheWriteTokens: 0 },
      resumedUsageCorrection: marker,
    })
    expect(kinds.output).toMatchObject({
      tokens: { outputTokens: 100 },
      resumedUsageCorrection: marker,
    })
  })

  test('leaves ordinary turns and rows left for a person exactly as recorded', async () => {
    const untouched = (await sessionRows()).filter(
      (r) => r.createdAt.getTime() !== at(10).getTime(),
    )

    expect(untouched.every((r) => !('resumedUsageCorrection' in r))).toBe(true)
    expect(
      untouched
        .filter((r) => r.kind === 'step_total' && r.createdAt.getTime() === at(20).getTime())
        .map((r) => r.tokens),
    ).toEqual([
      {
        inputTokens: 50_200_000,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 5_200,
        totalTokens: 50_205_200,
      },
    ])
  })

  test('a rerun changes nothing', async () => {
    const before = await sessionRows()

    await backfill()
    expect(await sessionRows()).toEqual(before)
  })
})
