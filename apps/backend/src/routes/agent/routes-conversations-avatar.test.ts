import '@/routes/agent'

import { beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { hostedAvatarOwner } from '@/lib/identity/avatar-url'
import { options } from '@/lib/test/credential-options-fixture'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useConversationTurn } from '@/lib/test/doubles/conversation-turn'
import { useCredentialOptions } from '@/lib/test/doubles/credential-options'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'

import { agent } from './router'

let optionsLoad = () => Promise.resolve(options)

useCredentialOptions({ getAgentCredentialOptions: () => optionsLoad() })

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
const botId = 'dddddddddddddddddddddddd'

let owner = caller
let managerIds: string[] = []
let saved: (string | null)[] = []
// The background each saved face was stored with; undefined leaves it as it was.
let backgrounds: (string | undefined)[] = []
// Who each saved face is recorded as changed by.
let actors: string[] = []
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
          _id: new ObjectId(botId),
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
  claimBotAvatar: async (_session, avatar, actorId) => {
    if (!claimWins) {
      currentAvatar = '07-ada'

      return false
    }
    saved.push(avatar)
    actors.push(actorId)

    return true
  },
  // As the write: a face changes only on a Bot; taking it away works on any.
  setConversationAvatar: async (_session, avatar, actorId, background) => {
    if (!stillThere || (avatar !== null && !currentAvatar)) return false
    saved.push(avatar)
    backgrounds.push(background)
    actors.push(actorId)

    return true
  },
})
// Full-access grants a new Bot starts with: \`${userId}:${conversationId}\` → bypass.
const bypass = new Map<string, unknown>()
let left: string[] = []
// The Bots whose stored photos were pruned.
let pruned: string[] = []

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
      // The chats a Bot made a Task leaves.
      find: (filter: { agentSessionIds?: string }) => {
        if (filter.agentSessionIds) left.push(filter.agentSessionIds)

        return { toArray: () => Promise.resolve([]) }
      },
      updateMany: () => Promise.resolve(),
      // An uploaded face: nothing else is stored for this Bot, and nothing to prune.
      // A new Bot also has no parent to take its permission mode from.
      findOne: () => Promise.resolve(null),
      deleteMany: (filter: { userId: unknown }) => {
        pruned.push(String(filter.userId))

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
  left = []
  pruned = []
  owner = caller
  managerIds = []
  saved = []
  backgrounds = []
  actors = []
  stillThere = true
  shells = []
  currentAvatar = undefined
  member = true
  claimWins = true
  parentSessionId = undefined
  turns.length = 0
})
const pick = (avatar: unknown, team = teamId, background?: unknown) =>
  app.request(`/agent/conversations/s1/avatar?teamId=${team}`, {
    method: 'PATCH',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify(background === undefined ? { avatar } : { avatar, background }),
  })

test("the owner changes a Bot's face, and taking it away makes it a Task", async () => {
  currentAvatar = '07-ada'
  const response = await pick('05-rembrandt')

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ avatar: '05-rembrandt' })
  // A photo it wore before is not kept.
  expect(pruned).toEqual([botId])
  expect(left).toEqual([])
  expect((await pick(null)).status).toBe(200)
  expect(saved).toEqual(['05-rembrandt', null])
  expect(actors).toEqual([caller, caller])
  // A Task is never in a chat.
  expect(left).toEqual(['s1'])
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

test('a background is saved with the face, and leaving it out keeps the one there is', async () => {
  currentAvatar = '07-ada'
  const response = await pick('05-rembrandt', teamId, 'sky')

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ avatar: '05-rembrandt', background: 'sky' })
  expect((await pick('05-rembrandt', teamId, 'none')).status).toBe(200)
  expect((await pick('07-ada')).status).toBe(200)
  expect(backgrounds).toEqual(['sky', 'none', undefined])
})

test('rejects a background that is not a tint name', async () => {
  currentAvatar = '07-ada'
  for (const background of ['teal', 'Sky', '#D6E6F7', '', null, 3])
    expect((await pick('05-rembrandt', teamId, background)).status).toBe(400)
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

// A 1x1 PNG.
const photo = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)
const upload = (body: Uint8Array) =>
  app.request(`/agent/conversations/s1/avatar/image?teamId=${teamId}`, {
    method: 'PUT',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/octet-stream' },
    body,
  })

test("the owner uploads a photo as a Bot's face", async () => {
  currentAvatar = '07-ada'
  const response = await upload(photo)
  const { avatar } = (await response.json()) as { avatar: string }

  expect(response.status).toBe(200)
  expect(hostedAvatarOwner(avatar)).toBe(botId)
  expect(saved).toEqual([avatar])
  expect(actors).toEqual([caller])
})

test('a photo is only for a Bot, from its owner, and must be an image', async () => {
  expect((await upload(photo)).status).toBe(400)
  currentAvatar = '07-ada'
  expect((await upload(Buffer.from('not an image'))).status).toBe(415)
  owner = 'someone-else'
  expect((await upload(photo)).status).toBe(404)
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
      // It may use everything its owner may, as a new chat does; sending mail stays opt-in.
      credentialAccess: expect.objectContaining({
        awsRoleIds: ['role-1'],
        deviceIds: ['mac'],
        resendIntegrationIds: [],
      }),
      bot: {
        avatar: body.avatar,
        change: {
          kind: 'bot_changed',
          at: expect.any(Date),
          actorId: caller,
          via: 'new_bot',
          avatar: body.avatar,
        },
      },
    },
  ])
})

test('"+" on Bots still makes the Bot when its owner\'s options cannot be read', async () => {
  optionsLoad = () => Promise.reject(new Error('down'))
  try {
    const response = await createBot()

    expect(response.status).toBe(201)
    // Nothing stored: the Bot asks its owner to choose.
    expect(shells[0]).not.toHaveProperty('credentialAccess')
  } finally {
    optionsLoad = () => Promise.resolve(options)
  }
})

test('"+" on Bots may start a Bot on a picked background', async () => {
  const response = await createBot({ avatar: '07-ada', background: 'peach' })

  expect(response.status).toBe(201)
  expect(await response.json()).toMatchObject({ avatar: '07-ada', avatarBackground: 'peach' })
  expect(shells[0]?.bot).toMatchObject({ avatar: '07-ada', background: 'peach' })
  // None is no background at all.
  expect((await createBot({ background: 'none' })).status).toBe(201)
  expect(shells[1]?.bot).not.toHaveProperty('background')
  expect((await createBot({ background: 'teal' })).status).toBe(400)
  expect(shells).toHaveLength(2)
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
  expect(actors).toEqual([caller])
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

test('coordination starter saves durable instructions without a primary role', async () => {
  const response = await createBot({
    title: 'Coordinator',
    starter: 'coordinate',
    onboarding: true,
  })

  expect(response.status).toBe(201)
  expect(shells[0]?.instructions).toContain('list_tasks')
  expect(shells[0]?.instructions).toContain('never grants human approval')
  expect(shells[0]?.botOnboarding).toBe('pending')
  expect(shells[0]).not.toHaveProperty('primary')
  expect(turns).toHaveLength(0)
})

test('ordinary onboarding learns purpose and persists it', async () => {
  const response = await createBot({ title: 'Research Expert', onboarding: true })

  expect(response.status).toBe(201)
  expect(shells[0]?.instructions).toContain('one focused question')
  expect(shells[0]?.instructions).toContain('update_self')
})

test('unknown starters and invalid onboarding values are rejected', async () => {
  expect((await createBot({ starter: 'admin' })).status).toBe(400)
  expect((await createBot({ onboarding: 'yes' })).status).toBe(400)
})
