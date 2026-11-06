import '@/routes/agent'

import { beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useConversationTurn } from '@/lib/test/doubles/conversation-turn'
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

useIdentity({
  authenticateToken: async () => ({ user: { id: caller } }),
  getTeamMembership: async () => ({ role: 'MEMBER' }),
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
        }
      : null,
  upsertConversationShell: async (data) => {
    shells.push(data)

    return { isNew: true }
  },
  setConversationAvatar: async (_session, avatar) => {
    saved.push(avatar)

    return stillThere
  },
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
  turns.length = 0
})
const pick = (avatar: unknown, team = teamId) =>
  app.request(`/agent/conversations/s1/avatar?teamId=${team}`, {
    method: 'PATCH',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify({ avatar }),
  })

test('the owner picks a character and can go back to the derived one', async () => {
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
  stillThere = false
  expect((await pick('07-ada')).status).toBe(404)
})

const createBot = (team = teamId) =>
  app.request(`/agent/bots?teamId=${team}`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: '{}',
  })

test('"+" on Bots creates a Bot with a name and its derived face, before any message', async () => {
  const response = await createBot()
  const body = (await response.json()) as { sessionId: string; title: string; avatar: string }

  expect(response.status).toBe(201)
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
