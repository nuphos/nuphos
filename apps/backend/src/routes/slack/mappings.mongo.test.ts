// The channel settings against a real MongoDB: an upsert keeps its filter's fields only there.
// Runs when TEST_MONGODB_URI is set, with MONGODB_URI pointing at the same server.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { errorHandler } from '@/lib/errors'
import { useAuthMiddleware } from '@/lib/test/doubles/auth-middleware'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useSlackInstallations } from '@/lib/test/doubles/slack-installations'

import type { AuthVariables } from '@/middleware/auth'

const TEAM = new ObjectId().toHexString()
const ADMIN = 'admin-user'
const MEMBER = 'member-user'
let viewer = ADMIN

useAuthMiddleware({
  requireAuth: async (c, next) => {
    c.set('userId', viewer)
    await next()
  },
})
useIdentity({
  getTeamMembership: async (userId, teamId) =>
    teamId === TEAM && [ADMIN, MEMBER].includes(userId)
      ? ({ role: userId === ADMIN ? 'ADMINISTRATOR' : 'MEMBER' } as never)
      : null,
  getTeamsByIds: async () => [],
  getTeamMembers: async () =>
    [
      { id: ADMIN, name: 'Ada', email: 'ada@example.com' },
      { id: MEMBER, name: 'Mei', email: 'mei@example.com' },
    ] as never,
})
// The workspace is this team's own installation, so the channel side needs nothing more.
useSlackInstallations({
  getSlackBindingByWorkspaceId: async () =>
    ({ nuphosTeamId: new ObjectId(TEAM), binding: {} }) as never,
  resolveInstalledWorkspaceBot: async () => null,
})

const { registerSlackMappingRoutes } = await import('./mappings')
const { agentConversations, agentMessages } = await import('@/lib/agent/db')
const { slackChannelMappings } = await import('@/lib/slack/agent-bot')
const { closeDb, connectDb } = await import('@/lib/db')
const app = new Hono<{ Variables: AuthVariables }>()

registerSlackMappingRoutes(app)
app.onError(errorHandler)

let channel = 'C1'
const send = (method: string, path: string, body?: Record<string, unknown>) =>
  app.request(body ? path : `${path}?teamId=${TEAM}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify({ teamId: TEAM, ...body }) } : {}),
  })
const connect = () => send('PUT', '/mappings', { slackWorkspaceId: 'T1', slackChannelId: channel })
const bring = (botSessionId: string) =>
  send('POST', `/mappings/T1/${channel}/bots`, { botSessionId: `${TEAM}-${botSessionId}` })
const record = async () => {
  const mapping = await slackChannelMappings().findOne({ slackChannelId: channel })

  return mapping?.externalChatId
    ? await agentConversations().findOne({ sessionId: mapping.externalChatId })
    : null
}

const seedBot = (sessionId: string, userId: string) =>
  agentConversations().insertOne({
    sessionId: `${TEAM}-${sessionId}`,
    userId,
    teamId: TEAM,
    title: sessionId,
    avatar: '07-ada',
    firstMessage: '',
    messageCount: 0,
    createdAt: new Date(),
    lastActiveAt: new Date(),
  })

const cleanUp = async () => {
  await agentConversations().deleteMany({ teamId: TEAM })
  await slackChannelMappings().deleteMany({ teamId: TEAM })
}

describe.skipIf(!process.env.TEST_MONGODB_URI)(
  'Slack channel settings: channels and their Bots',
  () => {
    beforeAll(async () => {
      await connectDb()
    })
    afterAll(async () => {
      await cleanUp()
      await closeDb()
    })
    beforeEach(async () => {
      await cleanUp()
      viewer = ADMIN
      channel = `C${new ObjectId().toHexString().toUpperCase()}`
      await seedBot('admin-bot', ADMIN)
      await seedBot('member-bot', MEMBER)
    })

    test('an admin connects a channel, which makes its hidden record and the grant', async () => {
      expect((await connect()).status).toBe(200)

      expect(await record()).toMatchObject({
        kind: 'channel',
        external: 'slack',
        teamId: TEAM,
        agentSessionIds: [],
      })
      expect(
        await slackChannelMappings().countDocuments({ teamId: TEAM, slackChannelId: channel }),
      ).toBe(1)
      // Connecting again keeps the same record.
      const first = (await record())?.sessionId

      await connect()
      expect((await record())?.sessionId).toBe(first)
    })

    test('the settings list each channel’s Bots, and only the viewer’s own Bots to add', async () => {
      await connect()
      viewer = MEMBER
      await bring('member-bot')
      const listed = (await (await send('GET', '/mappings')).json()) as {
        mappings: { bots: { sessionId: string; mine: boolean; ownerName?: string }[] }[]
        myBots: { sessionId: string }[]
      }

      expect(listed.mappings[0]?.bots).toEqual([
        expect.objectContaining({ sessionId: `${TEAM}-member-bot`, mine: true, ownerName: 'Mei' }),
      ])
      expect(listed.myBots.map((bot) => bot.sessionId)).toEqual([`${TEAM}-member-bot`])
    })

    test('a member cannot connect a channel', async () => {
      viewer = MEMBER

      expect((await connect()).status).toBe(403)
      expect(await slackChannelMappings().countDocuments({ slackChannelId: channel })).toBe(0)
    })

    test('each member brings only their own Bot, and an admin cannot bring someone else’s', async () => {
      await connect()
      viewer = MEMBER
      expect((await bring('member-bot')).status).toBe(200)
      expect((await bring('admin-bot')).status).toBe(403)
      viewer = ADMIN
      expect((await bring('member-bot')).status).toBe(403)

      expect((await record())?.agentSessionIds).toEqual([`${TEAM}-member-bot`])
    })

    test('a channel answers with one Bot: another waits until its owner takes it out', async () => {
      await connect()
      viewer = MEMBER
      expect((await bring('member-bot')).status).toBe(200)
      // Bringing it in again changes nothing.
      expect((await bring('member-bot')).status).toBe(200)
      viewer = ADMIN
      const refused = await bring('admin-bot')

      expect(refused.status).toBe(409)
      expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
        'slack_channel_has_bot',
      )
      expect((await record())?.agentSessionIds).toEqual([`${TEAM}-member-bot`])
      viewer = MEMBER
      await send('DELETE', `/mappings/T1/${channel}/bots/${TEAM}-member-bot`)
      viewer = ADMIN
      expect((await bring('admin-bot')).status).toBe(200)
      expect((await record())?.agentSessionIds).toEqual([`${TEAM}-admin-bot`])
    })

    test('only a Bot’s owner takes it out; an admin disconnects the whole channel', async () => {
      await connect()
      viewer = MEMBER
      await bring('member-bot')
      viewer = ADMIN
      expect((await send('DELETE', `/mappings/T1/${channel}/bots/${TEAM}-member-bot`)).status).toBe(
        403,
      )
      viewer = MEMBER
      expect((await send('DELETE', `/mappings/T1/${channel}/bots/${TEAM}-member-bot`)).status).toBe(
        200,
      )
      expect((await record())?.agentSessionIds).toEqual([])
    })

    test('disconnecting deletes the hidden record and its messages; connecting again starts afresh', async () => {
      await connect()
      const first = (await record())!.sessionId

      await agentMessages().insertOne({
        sessionId: first,
        userId: ADMIN,
        messageId: 'slack:C:1.1',
        index: 0,
        role: 'user',
        parts: [{ type: 'text', text: 'a Slack message' }],
      } as never)
      await send('DELETE', `/mappings/T1/${channel}`)

      expect(await agentConversations().countDocuments({ sessionId: first })).toBe(0)
      expect(await agentMessages().countDocuments({ sessionId: first })).toBe(0)
      await connect()
      expect((await record())?.sessionId).not.toBe(first)
    })

    test('disconnecting removes the grant', async () => {
      await connect()

      expect((await send('DELETE', `/mappings/T1/${channel}`)).status).toBe(200)
      expect(await slackChannelMappings().countDocuments({ slackChannelId: channel })).toBe(0)
      expect((await bring('admin-bot')).status).toBe(404)
    })
  },
)
