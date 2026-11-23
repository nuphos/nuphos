import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'

import { ObjectId } from 'mongodb'

import { upsertConversationShell } from '@/lib/agent/db/conversations'
import { agentConversations } from '@/lib/agent/db/shared'
import { closeDb, connectDb } from '@/lib/db'
import { startChoice } from '@/routes/mcp/ask-pick'

import { queueWebhookEvents, teamWebhooks, webhookDeliveries } from './store'

const teamId = randomUUID()
const userId = randomUUID()
const hook = async (enabled = true, team = teamId) => {
  const _id = new ObjectId()

  await teamWebhooks().insertOne({
    _id,
    teamId: team,
    name: 'endpoint',
    url: 'https://example.com/hook',
    events: ['session.turn.completed'],
    headers: [],
    enabled,
    createdBy: userId,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  return _id.toHexString()
}
const start = (webhook_id: string) => startChoice({ webhook_id }, null, teamId, userId)
const session = async (webhookId?: string) => {
  const sessionId = randomUUID()

  await upsertConversationShell({
    sessionId,
    userId,
    teamId,
    title: '',
    firstMessage: 'hi',
    locale: 'en',
    agentRuntime: 'claude-code',
    ...(webhookId ? { webhookId } : {}),
  })

  return sessionId
}
const queued = async (sessionId: string) => {
  queueWebhookEvents(sessionId)
  for (let tries = 0; tries < 100; tries++) {
    const rows = await webhookDeliveries().find({ sessionId }).toArray()

    if (rows.length) return rows.map((row) => row.webhookId.toHexString()).sort()
    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  return []
}

// #4747: a session an endpoint started reports to that endpoint, not the whole team.
describe.skipIf(!process.env.TEST_MONGODB_URI)('a session started for one webhook', () => {
  let a = ''
  let b = ''

  beforeAll(async () => {
    await connectDb()
    a = await hook()
    b = await hook()
  })
  afterAll(async () => {
    await teamWebhooks().deleteMany({ createdBy: userId })
    await webhookDeliveries().deleteMany({ teamId })
    await agentConversations().deleteMany({ userId })
    await closeDb()
  })

  test('nuphos_ask takes only an enabled webhook of the same team, for a new session', async () => {
    expect(await start(a)).toEqual({ fullAccess: true, webhookId: a })
    for (const id of [
      'not-an-id',
      new ObjectId().toHexString(),
      await hook(false),
      await hook(true, randomUUID()),
    ])
      expect(await start(id)).toHaveProperty('refused')

    expect(await startChoice({ webhook_id: a }, {} as never, teamId, userId)).toEqual({
      refused: 'webhook_id applies to a new session only.',
    })
  })

  test('its events are queued for that endpoint alone; other sessions still fan out', async () => {
    const own = await session(a)

    expect((await agentConversations().findOne({ sessionId: own }))?.webhookId).toBe(a)
    expect(await queued(own)).toEqual([a])
    expect(await queued(await session())).toEqual([a, b].sort())
  })
})
