import '@/routes/agent'

import { beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useConversationTurn } from '@/lib/test/doubles/conversation-turn'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'

import { agent } from './router'

const turns: { text: string; avatar?: string }[] = []

useConversationTurn({
  startConversationTurn: (_data, target, text) => {
    turns.push({ text, avatar: target.avatar })

    return Promise.resolve({ status: 'started' as const, run: Promise.resolve(undefined) })
  },
})

const teamId = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const otherTeam = 'cccccccccccccccccccccccc'
const caller = 'bbbbbbbbbbbbbbbbbbbbbbbb'

let owner = caller
let managerIds: string[] = []
let saved: (string | null)[] = []
let stillThere = true
let shells: Record<string, unknown>[] = []
let currentAvatar: string | undefined
let member = true
let claimWins = true
let parentSessionId: string | undefined

useIdentity({
  authenticateToken: async () => ({ user: { id: caller } }),
  getTeamMembership: async () => (member ? { role: 'MEMBER' } : null),
})
useAgentDb({
  getReadableConversation: async (_session, _user, team) =>
    team === teamId
      ? {
          sessionId: 's1',
          userId: owner,
          teamId,
          participantIds: managerIds,
          managerIds,
          ...(currentAvatar ? { avatar: currentAvatar } : {}),
          ...(parentSessionId ? { parentSessionId } : {}),
        }
      : null,
  upsertConversationShell: async (data) => {
    shells.push(data)

    return { isNew: true }
  },
  claimBotAvatar: async (_session, avatar) => {
    if (!claimWins) {
      currentAvatar = '07-ada'

      return false
    }
    saved.push(avatar)

    return true
  },
  // As the write: a face changes only on a Bot; taking it away works on any.
  setConversationAvatar: async (_session, avatar) => {
    if (!stillThere || (avatar !== null && !currentAvatar)) return false
    saved.push(avatar)

    return true
  },
})
// Full-access grants a new Bot starts with: \`${userId}:${conversationId}\` → bypass.
const bypass = new Map<string, unknown>()

useDb({
  db: () => ({
    collection: () => ({
      updateOne: (
        filter: { conversationId: string; userId: string },
        update: { $setOnInsert?: { bypass?: unknown } },
      ) => {
        bypass.set(`${filter.userId}:${filter.conversationId}`, update.$setOnInsert?.bypass)

        return Promise.resolve()
      },
    }),
  }),
})
const app = new Hono().route('/agent', agent)

app.onError((error, c) =>
  c.json({ error: error.message }, (error as { status?: 400 | 404 }).status ?? 500),
)
beforeEach(() => {
  owner = caller
  managerIds = []
  saved = []
  stillThere = true
  shells = []
  currentAvatar = undefined
  member = true
  claimWins = true
  parentSessionId = undefined
  turns.length = 0
})
const pick = (avatar: unknown, team = teamId) =>
  app.request(`/agent/conversations/s1/avatar?teamId=${team}`, {
    method: 'PATCH',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify({ avatar }),
  })

test("the owner changes a Bot's face, and taking it away makes it a Task", async () => {
  currentAvatar = '07-ada'
  const response = await pick('05-rembrandt')

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ avatar: '05-rembrandt' })
  expect((await pick(null)).status).toBe(200)
  expect(saved).toEqual(['05-rembrandt', null])
})

test('only the owner picks; a participant may not', async () => {
  owner = 'someone-else'
  expect((await pick('07-ada')).status).toBe(404)
  managerIds = [caller]
  expect((await pick('07-ada')).status).toBe(404)
  expect(saved).toEqual([])
})

test('rejects anything that is not a catalog name', async () => {
  for (const avatar of ['../etc/passwd', 'rembrandt', '05-Rembrandt.svg', 5, ''])
    expect((await pick(avatar)).status).toBe(400)
  expect(saved).toEqual([])
})

test('another team cannot see the conversation', async () => {
  expect((await pick('07-ada', otherTeam)).status).toBe(404)
  expect(saved).toEqual([])
})

test('an Agent deleted between the check and the write is not found', async () => {
  currentAvatar = '07-ada'
  stillThere = false
  expect((await pick('05-rembrandt')).status).toBe(404)
})

test('a face never makes a Task a Bot', async () => {
  parentSessionId = 'lead'
  const response = await pick('07-ada')

  expect(response.status).toBe(400)
  expect(await response.json()).toEqual({ error: 'Only a Bot has a face to change' })
  expect(saved).toEqual([])
})

const createBot = (body: Record<string, unknown> = {}, team = teamId) =>
  app.request(`/agent/bots?teamId=${team}`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

test('"+" on Bots creates a Bot with a name and its derived face, before any message', async () => {
  const response = await createBot()
  const body = (await response.json()) as { sessionId: string; title: string; avatar: string }

  expect(response.status).toBe(201)
  // A Bot works on its own: it starts in full access.
  expect(bypass.get(`${caller}:${body.sessionId}`)).toBe(true)
  expect(body.title).toBe('New Bot')
  expect(body.avatar).toMatch(/^\d{2}-[a-z-]+$/)
  expect(shells).toEqual([
    {
      sessionId: body.sessionId,
      userId: caller,
      teamId,
      title: 'New Bot',
      firstMessage: '',
      avatar: body.avatar,
    },
  ])
})

const makeBot = () =>
  app.request(`/agent/conversations/s1/bot?teamId=${teamId}`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-token' },
  })

test('"Make this a Bot" gives the Task its face and asks it to name itself', async () => {
  const response = await makeBot()
  const { avatar } = (await response.json()) as { avatar: string }

  expect(response.status).toBe(200)
  expect(saved).toEqual([avatar])
  expect(turns).toHaveLength(1)
  expect(turns[0]?.avatar).toBe(avatar)
  expect(turns[0]?.text).toContain('update_self')
})

test('"Make this a Bot" leaves a Bot as it is, and only the owner may', async () => {
  currentAvatar = '07-ada'
  expect(await (await makeBot()).json()).toEqual({ avatar: '07-ada' })
  currentAvatar = undefined
  owner = 'someone-else'
  expect((await makeBot()).status).toBe(404)
  expect(saved).toEqual([])
  expect(turns).toEqual([])
})

test('"Make this a Bot" refuses a sub-task', async () => {
  parentSessionId = 'parent'
  expect((await makeBot()).status).toBe(400)
  expect(saved).toEqual([])
  expect(turns).toEqual([])
})

test('"+" on Bots places the Bot on the runtime a new chat would use', async () => {
  const response = await createBot({
    runtimeId: 'rt_local-1',
    agentRuntime: 'claude-code',
    runtimeLabel: 'This Mac',
  })

  expect(response.status).toBe(201)
  expect(shells[0]).toMatchObject({
    agentRuntime: 'claude-code',
    runtimeId: 'rt_local-1',
    runtimeLabel: 'This Mac',
  })
})

test('"+" on Bots rejects a runtime that is not one', async () => {
  expect((await createBot({ agentRuntime: 'not-a-runtime' })).status).toBe(400)
  expect((await createBot({ runtimeId: '../x' })).status).toBe(400)
  expect(shells).toEqual([])
})

test('"+" on Bots needs membership in the team', async () => {
  member = false
  expect((await createBot()).status).toBe(403)
  expect(shells).toEqual([])
})

test('"Make this a Bot" clicked twice at once starts one turn', async () => {
  claimWins = false

  expect(await (await makeBot()).json()).toEqual({ avatar: '07-ada' })
  expect(saved).toEqual([])
  expect(turns).toEqual([])
})
