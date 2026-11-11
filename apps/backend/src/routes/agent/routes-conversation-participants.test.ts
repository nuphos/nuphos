import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { errorHandler } from '@/lib/errors'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

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
let memory = portabilityDb()

useDb({ db: (() => memory) as unknown as typeof dbActual.db })
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

type ParticipantsBody = {
  generalAccess: string
  participants: { id: string; name: string; isOwner: boolean; role: string | null }[]
}

async function listParticipants(team: string = TEAM) {
  const response = await app.request(`/conversations/shared/participants?teamId=${team}`)

  return { status: response.status, body: (await response.json()) as ParticipantsBody }
}

const participantIds = () => conversation?.participantIds ?? []

async function remove(userId: string, team: string = TEAM) {
  return app.request(`/conversations/shared/participants/${userId}?teamId=${team}`, {
    method: 'DELETE',
  })
}

async function invite(
  userIds: unknown,
  team: string = TEAM,
  role?: string,
  /** null stands for a release that sends no answer. */
  grantComputerUse: boolean | null = false,
) {
  return app.request(`/conversations/shared/participants?teamId=${team}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userIds, role, grantComputerUse: grantComputerUse ?? undefined }),
  })
}

async function patch(path: string, body: Record<string, unknown>) {
  return app.request(`/conversations/shared/${path}?teamId=${TEAM}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  viewer = OWNER
  memory = portabilityDb()
  conversation = {
    sessionId: 'shared',
    userId: OWNER,
    teamId: TEAM,
    participantIds: [TEAMMATE],
  } as AgentConversation
  memory.rows('agent_conversations').push(conversation)
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
    expect((await remove(TEAMMATE, 'not-a-team-id')).status).toBe(403)
    expect(participantIds()).toEqual([TEAMMATE])
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
    expect(conversation?.timelineEvents).toMatchObject([
      { kind: 'participant_invited', actorId: OWNER, targetId: INVITEE },
    ])
  })

  // Only someone who was actually absent produces an "invited" line.
  test('re-inviting a participant or the owner records nothing', async () => {
    expect((await invite([TEAMMATE, OWNER])).status).toBe(200)
    expect(participantIds()).toEqual([TEAMMATE])
    expect(conversation?.timelineEvents).toBeUndefined()
  })

  test('only the owner invites, and only current team members can be invited', async () => {
    viewer = TEAMMATE
    expect((await invite([INVITEE])).status).toBe(403)
    viewer = OWNER
    expect((await invite([INVITEE])).status).toBe(200)

    const rejected = await invite([INVITEE, OUTSIDER])

    expect(rejected.status).toBe(403)
    expect(await rejected.json()).toMatchObject({ error: { code: 'not_team_member' } })
    // The whole request is refused: no partial invite lands.
    expect(participantIds()).toEqual([TEAMMATE, INVITEE])
  })

  test('an empty or malformed invitee list is a request error', async () => {
    expect((await invite([])).status).toBe(400)
    expect((await invite('nobody')).status).toBe(400)
    expect(participantIds()).toEqual([TEAMMATE])
  })

  test('the owner removes a teammate, and the timeline says who did it', async () => {
    await invite([INVITEE])
    const response = await remove(INVITEE)
    const body = (await response.json()) as ParticipantsBody

    expect(response.status).toBe(200)
    expect(body.participants.map((participant) => participant.id)).toEqual([OWNER, TEAMMATE])
    expect(conversation?.timelineEvents?.at(-1)).toMatchObject({
      kind: 'participant_removed',
      actorId: OWNER,
      targetId: INVITEE,
    })
    // Removing someone who is not here is a no-op, not a second event.
    expect((await remove(INVITEE)).status).toBe(200)
    expect(conversation?.timelineEvents).toHaveLength(2)
  })

  test('the owner cannot be removed and nobody else can remove anyone', async () => {
    expect((await remove(OWNER)).status).toBe(400)
    await invite([INVITEE])
    viewer = TEAMMATE
    expect((await remove(INVITEE)).status).toBe(403)
    viewer = OUTSIDER
    expect((await remove(TEAMMATE)).status).toBe(403)
    expect((await remove(OUTSIDER)).status).toBe(403)
    expect(participantIds()).toEqual([TEAMMATE, INVITEE])
  })

  test('a participant leaves on their own, and the timeline says they left', async () => {
    viewer = TEAMMATE
    const response = await remove(TEAMMATE)
    const body = (await response.json()) as ParticipantsBody

    expect(response.status).toBe(200)
    expect(body.participants.map((participant) => participant.id)).toEqual([OWNER])
    expect(conversation?.timelineEvents?.at(-1)).toMatchObject({
      kind: 'participant_removed',
      actorId: TEAMMATE,
      targetId: TEAMMATE,
    })
  })

  test('participants have no roles to choose; a role other than reply is refused', async () => {
    const body = (await (await invite([INVITEE], TEAM, 'reply')).json()) as ParticipantsBody

    expect(body.participants.find((p) => p.id === OWNER)?.role).toBe('owner')
    // On a team runtime every member may use the computer, so participants reply.
    expect(body.participants.find((p) => p.id === INVITEE)?.role).toBe('reply')
    expect((await invite([INVITEE], TEAM, 'view')).status).toBe(400)
    expect((await invite([INVITEE], TEAM, 'manage')).status).toBe(400)
    expect((await patch(`participants/${TEAMMATE}`, { role: 'view' })).status).toBe(404)
  })

  test('general access is none or view, older sessions read as view, and only the owner changes it', async () => {
    expect((await listParticipants()).body.generalAccess).toBe('view')
    const response = await patch('access', { generalAccess: 'none' })

    expect(response.status).toBe(200)
    expect(((await response.json()) as ParticipantsBody).generalAccess).toBe('none')
    expect(conversation?.generalAccess).toBe('none')
    expect((await patch('access', { generalAccess: 'reply' })).status).toBe(400)
    // A chat keeps team-wide reply.
    conversation!.kind = 'channel'
    expect((await patch('access', { generalAccess: 'reply' })).status).toBe(200)
    expect((await patch('access', { generalAccess: 'public' })).status).toBe(400)
    viewer = TEAMMATE
    expect((await patch('access', { generalAccess: 'view' })).status).toBe(403)
    viewer = OUTSIDER
    expect((await patch('access', { generalAccess: 'view' })).status).toBe(403)
  })
})

describe('a conversation on someone’s computer', () => {
  const DEVICE = 'owner-mac'

  function computer(grant: { userIds?: string[]; managerIds?: string[] } = {}) {
    memory.rows('agent_devices').push({
      userId: OWNER,
      deviceId: DEVICE,
      label: 'Owner’s Mac',
      createdAt: new Date(),
      access: [
        {
          teamId: TEAM,
          everyone: false,
          userIds: grant.userIds ?? [],
          managerIds: grant.managerIds ?? [],
        },
      ],
    })
    conversation!.runtimeId = `local_${OWNER}_${DEVICE}`
  }

  async function inviteConfirmed(userIds: string[]) {
    return app.request(`/conversations/shared/participants?teamId=${TEAM}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds, grantComputerUse: true }),
    })
  }

  test('a participant who may not use the computer is listed as reading only', async () => {
    computer()
    const { body } = await listParticipants()

    expect(body.participants.find((p) => p.id === TEAMMATE)?.role).toBe('view')
  })

  test('a participant who may use the computer replies', async () => {
    computer({ userIds: [TEAMMATE] })
    const { body } = await listParticipants()

    expect(body.participants.find((p) => p.id === TEAMMATE)?.role).toBe('reply')
  })

  test('inviting someone who may not use it asks to confirm giving them use', async () => {
    computer()
    const response = await invite([INVITEE])

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      error: {
        code: 'computer_use_required',
        details: { userIds: [INVITEE], computer: { deviceId: DEVICE, label: 'Owner’s Mac' } },
      },
    })
    expect(participantIds()).toEqual([TEAMMATE])
  })

  test('someone who already may use it is invited without asking', async () => {
    computer({ userIds: [INVITEE] })
    expect((await invite([INVITEE])).status).toBe(200)
    expect(participantIds()).toEqual([TEAMMATE, INVITEE])
  })

  // The grant is a pipeline update this in-memory db does not run; device-grants.test
  // checks what it writes.
  test('a release without the confirmation invites them to read only', async () => {
    computer()
    const body = (await (await invite([INVITEE], TEAM, undefined, null)).json()) as ParticipantsBody

    expect(body.participants.find((p) => p.id === INVITEE)?.role).toBe('view')
    expect(memory.rows('agent_devices')[0]!.access[0].userIds).toEqual([])
  })

  test('the computer’s owner confirms, and the invite goes through', async () => {
    computer()
    expect((await inviteConfirmed([INVITEE])).status).toBe(200)
    expect(participantIds()).toEqual([TEAMMATE, INVITEE])
  })

  test('an owner who only uses the computer cannot give it away', async () => {
    memory.rows('agent_devices').push({
      userId: TEAMMATE,
      deviceId: 'mate-mac',
      label: 'Teammate’s Mac',
      createdAt: new Date(),
      access: [{ teamId: TEAM, everyone: false, userIds: [OWNER], managerIds: [] }],
    })
    conversation!.runtimeId = `local_${TEAMMATE}_mate-mac`
    const response = await inviteConfirmed([INVITEE])

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: { code: 'computer_manage_required' } })
    expect(participantIds()).toEqual([TEAMMATE])
  })
})
