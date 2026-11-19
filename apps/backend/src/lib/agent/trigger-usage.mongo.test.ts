// How Trigger usage counts turns, through its real aggregation against a real MongoDB.
// Runs when TEST_MONGODB_URI is set, with MONGODB_URI pointing at the same server.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { closeDb, connectDb } from '@/lib/db'

import { agentTokenUsage } from './token-usage'
import { getTriggerUsage, triggerUsagePipeline } from './trigger-usage'

const TEAM = new ObjectId().toHexString()
const TRIGGER = new ObjectId().toHexString()
const NOW = new Date('2026-11-18T12:00:00.000Z')
// One turn's rows share this time across models, as the turn recorder writes them.
const TURN_AT = new Date('2026-11-18T10:00:00.000Z')

/** A usage row of this Trigger's one fire, in its one conversation. */
const row = (modelId: string, kind: string, tokens: Record<string, number>) => ({
  recordId: new ObjectId().toHexString(),
  sessionId: 'fired',
  userId: 'owner',
  teamId: TEAM,
  operation: 'agent.turn',
  source: 'agent-runtime',
  accounting: 'upstream_reported',
  provider: 'claude-code',
  modelId,
  kind,
  tokens,
  triggerId: TRIGGER,
  triggerFireId: 'fire-1',
  createdAt: TURN_AT,
})

describe.skipIf(!process.env.TEST_MONGODB_URI)('trigger usage turns', () => {
  beforeAll(async () => {
    await connectDb()
    await agentTokenUsage().insertMany([
      // One turn: the main model and a sub-agent on another model.
      row('claude-opus-5', 'step_total', { totalTokens: 1000 }),
      row('claude-opus-5', 'input', { inputTokens: 900 }),
      row('claude-haiku-5', 'step_total', { totalTokens: 300 }),
      row('claude-haiku-5', 'input', { inputTokens: 250 }),
      // A model group with no step_total row, so it has no turn of its own.
      row('claude-sonnet-5', 'input', { inputTokens: 40 }),
    ] as never)
  })

  afterAll(async () => {
    await agentTokenUsage().deleteMany({ teamId: TEAM })
    await closeDb()
  })

  test('a turn that used two models counts once in the totals, its conversation and its fire', async () => {
    const usage = await getTriggerUsage(TRIGGER, TEAM, 7, NOW)

    expect(usage.totals.turns).toBe(1)
    expect(usage.sessions).toEqual([expect.objectContaining({ sessionId: 'fired', turns: 1 })])
    expect(usage.fires).toEqual([expect.objectContaining({ fireId: 'fire-1', turns: 1 })])
  })

  test('a group without a step_total row carries no turn times, not a null one', async () => {
    const groups = await agentTokenUsage()
      .aggregate<{ modelId: string; turnAts: Date[] }>(
        triggerUsagePipeline({ triggerId: TRIGGER, teamId: TEAM }),
      )
      .toArray()

    expect(groups.find((group) => group.modelId === 'claude-sonnet-5')?.turnAts).toEqual([])
    expect(groups.find((group) => group.modelId === 'claude-opus-5')?.turnAts).toEqual([TURN_AT])
  })
})
