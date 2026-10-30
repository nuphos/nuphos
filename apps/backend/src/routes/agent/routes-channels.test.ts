import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { errorHandler } from '@/lib/errors'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import type * as agentDb from '@/lib/agent/db'
import type * as dbActual from '@/lib/db'
import type { AuthVariables } from '@/middleware/auth'

const TEAM = new ObjectId().toHexString()
const OTHER_TEAM = new ObjectId().toHexString()
const OWNER = 'owner-user'
const TEAMMATE = 'teammate-user'
const MEMBERS = [OWNER, TEAMMATE]

let viewer = OWNER
// A sign-in session, as the app sends; a CLI or agent-run token has none.
let signedIn = true
let memory = portabilityDb()
let appended: Parameters<typeof agentDb.appendConversationMessages>[0][] = []

useDb({ db: (() => memory) as unknown as typeof dbActual.db })
// The in-memory store has no bulkWrite, so the transcript append is recorded.
useAgentDb({
  appendConversationMessages: async (data) => {
    appended.push(data)

    return true
  },
})
useIdentity({
  getTeamMembership: async (userId, teamId) =>
    teamId === TEAM && MEMBERS.includes(userId) ? ({ role: 'MEMBER' } as never) : null,
})

const { channelRoutes } = await import('./routes-channels')
const { conversationParticipantsRoutes } = await import('./routes-conversation-participants')
const { agentConversations } = await import('@/lib/agent/db')
const { authorizeThreadDelivery } = await import('@/lib/agent/thread-bridge')
const app = new Hono<{ Variables: AuthVariables }>()

app.use('*', async (c, next) => {
  c.set('userId', viewer)
  if (signedIn) c.set('sessionId', 'sign-in')
  await next()
})
app.route('/', channelRoutes)
app.route('/', conversationParticipantsRoutes)
app.onError(errorHandler)

function send(method: string, path: string, body?: unknown) {
  const join = path.includes('?') ? '&' : '?'

  return app.request(`${path}${join}teamId=${TEAM}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

async function createChannel(title = 'Launch room') {
  const response = await send('POST', '/channels', { title })

  expect(response.status).toBe(201)

  return ((await response.json()) as { sessionId: string }).sessionId
}

async function seedAgent(sessionId: string, userId: string, extra: Record<string, unknown> = {}) {
  await agentConversations().insertOne({
    sessionId,
    userId,
    teamId: TEAM,
    title: `${sessionId} title`,
    firstMessage: '',
    messageCount: 0,
    createdAt: new Date(),
    lastActiveAt: new Date(),
    ...extra,
  })
}

async function agentIds(channelId: string) {
  const response = await send('GET', `/conversations/${channelId}/agents`)
  const body = (await response.json()) as { agents: { sessionId: string }[] }

  return { status: response.status, ids: body.agents?.map((agent) => agent.sessionId) }
}

beforeEach(() => {
  viewer = OWNER
  signedIn = true
  memory = portabilityDb()
  appended = []
})

describe('creating a channel', () => {
  test('is a private conversation that runs no agent', async () => {
    const channelId = await createChannel()
    const channel = await agentConversations().findOne({ sessionId: channelId })

    expect(channel).toMatchObject({
      kind: 'channel',
      userId: OWNER,
      teamId: TEAM,
      title: 'Launch room',
      generalAccess: 'none',
    })
    expect(channel?.agentRuntime).toBeUndefined()
  })

  test('needs a title and a team the caller belongs to', async () => {
    expect((await send('POST', '/channels', { title: '  ' })).status).toBe(400)
    viewer = 'outsider'
    expect((await send('POST', '/channels', { title: 'x' })).status).toBe(403)
  })
})

describe('agents in a channel', () => {
  test('the owner adds an agent they own, once', async () => {
    const channelId = await createChannel()

    await seedAgent('agent-a', OWNER)
    await send('POST', `/conversations/${channelId}/agents`, { sessionId: 'agent-a' })
    const response = await send('POST', `/conversations/${channelId}/agents`, {
      sessionId: 'agent-a',
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      agents: [{ sessionId: 'agent-a', title: 'agent-a title', ownerId: OWNER }],
    })
  })

  test('only its owner can add an agent, not a manager of it', async () => {
    const channelId = await createChannel()

    await seedAgent('teammate-agent', TEAMMATE, { participantIds: [OWNER], managerIds: [OWNER] })
    expect(
      (await send('POST', `/conversations/${channelId}/agents`, { sessionId: 'teammate-agent' }))
        .status,
    ).toBe(403)
  })

  test('a member who can post brings in their own agent', async () => {
    const channelId = await createChannel()

    await seedAgent('teammate-agent', TEAMMATE)
    viewer = TEAMMATE
    // Not in the channel yet: no way in for their agent either.
    expect(
      (await send('POST', `/conversations/${channelId}/agents`, { sessionId: 'teammate-agent' }))
        .status,
    ).toBe(403)
    await agentConversations().updateOne(
      { sessionId: channelId },
      { $set: { participantIds: [TEAMMATE] } },
    )
    const response = await send('POST', `/conversations/${channelId}/agents`, {
      sessionId: 'teammate-agent',
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ agents: [{ sessionId: 'teammate-agent' }] })
  })

  test('only an agent conversation of the same team can join', async () => {
    const channelId = await createChannel()

    await seedAgent('elsewhere', OWNER, { teamId: OTHER_TEAM })
    await seedAgent('other-channel', OWNER, { kind: 'channel' })
    for (const sessionId of ['elsewhere', 'other-channel', 'missing']) {
      expect((await send('POST', `/conversations/${channelId}/agents`, { sessionId })).status).toBe(
        404,
      )
    }
  })

  test('the agent’s owner can take it out of someone else’s channel', async () => {
    const channelId = await createChannel()

    await seedAgent('teammate-agent', TEAMMATE)
    // The channel stays private: its owner brought the agent in, its owner takes it out.
    await agentConversations().updateOne(
      { sessionId: channelId },
      { $set: { agentSessionIds: ['teammate-agent'] } },
    )
    viewer = TEAMMATE
    expect((await agentIds(channelId)).status).toBe(404)
    const response = await send('DELETE', `/conversations/${channelId}/agents/teammate-agent`)

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect((await agentConversations().findOne({ sessionId: channelId }))?.agentSessionIds).toEqual(
      [],
    )
  })

  test('removing needs a channel of the caller’s team', async () => {
    await seedAgent('agent-a', OWNER)
    await seedAgent('elsewhere', OWNER, { kind: 'channel', teamId: OTHER_TEAM })
    for (const channelId of ['agent-a', 'elsewhere', 'missing']) {
      expect((await send('DELETE', `/conversations/${channelId}/agents/agent-a`)).status).toBe(404)
    }
  })

  test('nobody else can take an agent out', async () => {
    const channelId = await createChannel()

    await seedAgent('agent-a', OWNER)
    await agentConversations().updateOne(
      { sessionId: channelId },
      { $set: { generalAccess: 'reply', agentSessionIds: ['agent-a'] } },
    )
    viewer = TEAMMATE
    expect((await send('DELETE', `/conversations/${channelId}/agents/agent-a`)).status).toBe(403)
  })

  test('an ordinary conversation has no agents to list', async () => {
    await seedAgent('agent-a', OWNER)
    expect((await agentIds('agent-a')).status).toBe(404)
  })
})

describe('posting to a channel', () => {
  test('records the message with its sender and starts nothing', async () => {
    const channelId = await createChannel()
    const response = await send('POST', `/conversations/${channelId}/channel-messages`, {
      id: 'm1',
      text: ' hello ',
    })

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ id: 'm1' })
    expect(appended).toHaveLength(1)
    expect(appended[0]).toMatchObject({
      sessionId: channelId,
      userId: OWNER,
      teamId: TEAM,
      messages: [
        {
          id: 'm1',
          role: 'user',
          parts: [{ type: 'text', text: 'hello' }],
          metadata: { sender: { type: 'user', id: OWNER }, source: 'nuphos' },
        },
      ],
    })
  })

  test('a teammate with reply access joins by speaking', async () => {
    const channelId = await createChannel()

    await agentConversations().updateOne(
      { sessionId: channelId },
      { $set: { generalAccess: 'reply' } },
    )
    viewer = TEAMMATE
    expect(
      (await send('POST', `/conversations/${channelId}/channel-messages`, { text: 'hi' })).status,
    ).toBe(201)
    expect((await agentConversations().findOne({ sessionId: channelId }))?.participantIds).toEqual([
      TEAMMATE,
    ])
  })

  test('takes reply access, a channel and some text', async () => {
    const channelId = await createChannel()

    await seedAgent('agent-a', OWNER)
    expect(
      (await send('POST', `/conversations/${channelId}/channel-messages`, { text: '' })).status,
    ).toBe(400)
    expect(
      (await send('POST', '/conversations/agent-a/channel-messages', { text: 'hi' })).status,
    ).toBe(404)
    viewer = TEAMMATE
    expect(
      (await send('POST', `/conversations/${channelId}/channel-messages`, { text: 'hi' })).status,
    ).toBe(403)
    expect(appended).toHaveLength(0)
  })
})

test('only a person in the app can post; an agent token would refill the agents’ budget', async () => {
  const channelId = await createChannel()

  signedIn = false
  expect(
    (await send('POST', `/conversations/${channelId}/channel-messages`, { text: 'hi' })).status,
  ).toBe(403)
  expect(appended).toHaveLength(0)
})

describe('a channel never runs a turn', () => {
  test('send_message_to_thread refuses a channel target', async () => {
    const channelId = await createChannel()

    await seedAgent('agent-a', OWNER, { credentialAccess: { mode: 'all' } })
    await expect(
      authorizeThreadDelivery({
        userId: OWNER,
        teamId: TEAM,
        sessionId: 'agent-a',
        locale: 'en-US',
        targetSessionId: channelId,
      }),
    ).rejects.toThrow('A channel has no agent of its own to message.')
  })
})
