import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { errorHandler } from '@/lib/errors'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'

import type { AgentConversation } from '@/lib/agent/db'
import type * as dbActual from '@/lib/db'
import type { AuthVariables } from '@/middleware/auth'

const TEAM = new ObjectId().toHexString()
const OWNER = 'owner-user'
const TEAMMATE = 'teammate-user'
const INVITEE = 'invitee-user'
const OUTSIDER = 'outsider-user'

const MEMBERS = [OWNER, TEAMMATE, INVITEE]

let viewer = OWNER
let conversation: AgentConversation | null
let updates: { filter: Record<string, unknown>; update: Record<string, unknown> }[] = []

const collection = {
  findOneAndUpdate: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
    updates.push({ filter, update })
    const added = (update.$addToSet as { participantIds: { $each: string[] } }).participantIds.$each

    // Stand in for the atomic post-write read the route renders.
    return { ...conversation, participantIds: [...(conversation?.participantIds ?? []), ...added] }
  },
}

useDb({ db: (() => ({ collection: () => collection })) as unknown as typeof dbActual.db })
useAgentDb({
  // The route reads the doc through the viewer-scoped helper, so a viewer who
  // may not see the conversation gets null here rather than a filtered doc.
  getReadableConversation: async (_sessionId, viewerUserId, teamId) =>
    teamId && MEMBERS.includes(viewerUserId) ? conversation : null,
  getConversationBySessionId: async () => conversation,
})
useIdentity({
  getTeamMembership: async (userId, teamId) =>
    teamId === TEAM && MEMBERS.includes(userId) ? ({ role: 'MEMBER' } as never) : null,
  getTeamMembers: async () =>
    MEMBERS.map((id) => ({
      id,
      name: `${id} name`,
      email: `${id}@example.com`,
      avatarURL: `https://avatars.example.com/${id}`,
    })) as never,
})

const { conversationParticipantsRoutes } = await import('./routes-conversation-participants')
const app = new Hono<{ Variables: AuthVariables }>()

app.use('*', async (c, next) => {
  c.set('userId', viewer)
  await next()
})
app.route('/', conversationParticipantsRoutes)
app.onError(errorHandler)

type ParticipantsBody = { participants: { id: string; name: string; isOwner: boolean }[] }

async function listParticipants(team: string = TEAM) {
  const response = await app.request(`/conversations/shared/participants?teamId=${team}`)

  return { status: response.status, body: (await response.json()) as ParticipantsBody }
}

async function invite(userIds: unknown, team: string = TEAM) {
  return app.request(`/conversations/shared/participants?teamId=${team}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userIds }),
  })
}

beforeEach(() => {
  viewer = OWNER
  updates = []
  conversation = {
    sessionId: 'shared',
    userId: OWNER,
    teamId: TEAM,
    participantIds: [TEAMMATE],
  } as AgentConversation
})

describe('conversation participants API', () => {
  test('lists the owner first and never twice, even when stored as a participant', async () => {
    conversation!.participantIds = [TEAMMATE, OWNER, TEAMMATE]
    const { status, body } = await listParticipants()

    expect(status).toBe(200)
    expect(body.participants.map((participant) => participant.id)).toEqual([OWNER, TEAMMATE])
    expect(body.participants[0]).toMatchObject({ isOwner: true, name: `${OWNER} name` })
    expect(body.participants[1]).toMatchObject({ isOwner: false })
  })

  test('a teammate sees the list; an outsider is refused and a missing session 404s', async () => {
    viewer = TEAMMATE
    expect((await listParticipants()).status).toBe(200)
    viewer = OUTSIDER
    expect((await listParticipants()).status).toBe(403)
    viewer = TEAMMATE
    conversation = null
    expect((await listParticipants()).status).toBe(404)
  })

  // An unverifiable team scope must be refused, not quietly narrowed to the
  // viewer's own conversations — that would 404 a teammate who may read this.
  test('an unresolved team scope is refused rather than downgraded to owner-only', async () => {
    viewer = TEAMMATE
    expect((await listParticipants('not-a-team-id')).status).toBe(403)
    expect((await invite([INVITEE], 'not-a-team-id')).status).toBe(403)
    expect(updates).toHaveLength(0)
  })

  test('inviting a teammate adds them without rewriting the existing list', async () => {
    const response = await invite([INVITEE])
    const body = (await response.json()) as ParticipantsBody

    expect(response.status).toBe(200)
    expect(body.participants.map((participant) => participant.id)).toEqual([
      OWNER,
      TEAMMATE,
      INVITEE,
    ])
    expect(updates).toEqual([
      {
        filter: { sessionId: 'shared' },
        update: { $addToSet: { participantIds: { $each: [INVITEE] } } },
      },
    ])
  })

  test('any participant can invite, but only current team members can be invited', async () => {
    viewer = TEAMMATE
    expect((await invite([INVITEE])).status).toBe(200)

    const rejected = await invite([INVITEE, OUTSIDER])

    expect(rejected.status).toBe(403)
    expect(await rejected.json()).toMatchObject({ error: { code: 'not_team_member' } })
    // The whole request is refused: no partial invite lands.
    expect(updates).toHaveLength(1)
  })

  test('an empty or malformed invitee list is a request error', async () => {
    expect((await invite([])).status).toBe(400)
    expect((await invite('nobody')).status).toBe(400)
    expect(updates).toHaveLength(0)
  })
})
