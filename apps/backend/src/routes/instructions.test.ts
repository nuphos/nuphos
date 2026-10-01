import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { errorHandler } from '@/lib/errors'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useModels } from '@/lib/test/doubles/models'
import { createFakeInstructionsCollection } from '@/lib/test/fake-instructions-collection'

import type { AgentSessionOrigin } from '@/lib/agent/tools-triggers-shared'
import type { NuphosTeamRole } from '@/lib/identity'
import type { TeamAuthVariables } from '@/middleware/auth'
import type { ConversationTeamAuthVariables } from '@/routes/teams/conversation-auth'

const TEAM_ID = new ObjectId().toHexString()
const collection = createFakeInstructionsCollection()
let currentUserId = 'admin-user'
let currentRole: NuphosTeamRole = 'ADMINISTRATOR'

type ConversationTurn = { key?: string; origin?: AgentSessionOrigin } | null
let conversationTurn: ConversationTurn = null

useModels({ agentInstructions: () => collection })
useAgentDb({
  getConversationBySessionId: async (sessionId) => ({
    sessionId,
    claudeCodePreviewContext: {
      activeTurnKey: conversationTurn?.key,
      activeTurnOrigin: conversationTurn?.origin,
    },
  }),
})

const { instructionsRoutes } = await import('@/routes/instructions')
const app = new Hono<{ Variables: TeamAuthVariables & ConversationTeamAuthVariables }>()

app.use('*', async (c, next) => {
  c.set('teamId', TEAM_ID)
  c.set('userId', currentUserId)
  c.set('teamRole', currentRole)
  if (conversationTurn !== null) {
    c.set('conversationAgent', { userId: currentUserId, sessionId: 'conv-1' })
  }
  await next()
})
app.route('/', instructionsRoutes)
app.onError(errorHandler)

type Listing = {
  team: { id: string; title: string; enabled: boolean }[]
  personal: { id: string; title: string }[]
  canManageTeam: boolean
}

function as(userId: string, role: NuphosTeamRole): void {
  currentUserId = userId
  currentRole = role
}

async function create(body: Record<string, unknown>) {
  return app.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function patch(id: string, body: Record<string, unknown>) {
  return app.request(`/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function list(): Promise<Listing> {
  return (await (await app.request('/')).json()) as Listing
}

beforeEach(() => {
  collection.reset()
  conversationTurn = null
  as('admin-user', 'ADMINISTRATOR')
})

describe('instructions API', () => {
  test('administrators create team instructions that every member can read', async () => {
    const created = await create({ scope: 'team', title: 'Style', content: 'Use British English.' })

    expect(created.status).toBe(201)
    as('viewer-user', 'VIEWER')
    const listing = await list()

    expect(listing.team.map((doc) => doc.title)).toEqual(['Style'])
    expect(listing.personal).toEqual([])
    expect(listing.canManageTeam).toBe(false)
  })

  test('non-administrators cannot create, edit, or delete team instructions', async () => {
    const created = await create({ scope: 'team', title: 'Policy', content: 'Never drop tables.' })
    const { id } = (await created.json()) as { id: string }

    as('editor-user', 'EDITOR')
    expect((await create({ scope: 'team', title: 'x', content: 'y' })).status).toBe(403)
    expect((await patch(id, { enabled: false })).status).toBe(403)
    expect((await app.request(`/${id}`, { method: 'DELETE' })).status).toBe(403)
    expect(collection.docs[0]?.enabled).toBe(true)
  })

  test('personal instructions are private to their owner', async () => {
    as('viewer-user', 'VIEWER')
    const created = await create({ scope: 'personal', title: 'Me', content: 'Reply tersely.' })
    const { id } = (await created.json()) as { id: string }

    expect(created.status).toBe(201)
    expect(collection.docs[0]?.userId).toBe('viewer-user')

    as('admin-user', 'ADMINISTRATOR')
    expect((await list()).personal).toEqual([])
    expect((await patch(id, { title: 'Hijacked' })).status).toBe(404)
    expect((await app.request(`/${id}`, { method: 'DELETE' })).status).toBe(404)

    as('viewer-user', 'VIEWER')
    const updated = await patch(id, { enabled: false, title: 'Mine' })

    expect(updated.status).toBe(200)
    expect(await updated.json()).toMatchObject({ title: 'Mine', enabled: false })
    expect((await app.request(`/${id}`, { method: 'DELETE' })).status).toBe(204)
    expect(collection.docs).toHaveLength(0)
  })

  test('validates input and rejects empty patches', async () => {
    expect((await create({ scope: 'team', title: '', content: 'x' })).status).toBe(400)
    expect((await create({ scope: 'global', title: 't', content: 'x' })).status).toBe(400)
    expect((await create({ scope: 'team', title: 't', content: 'x'.repeat(8_001) })).status).toBe(
      400,
    )
    const created = await create({ scope: 'personal', title: 't', content: 'x' })
    const { id } = (await created.json()) as { id: string }

    expect((await patch(id, {})).status).toBe(400)
    expect((await patch('not-an-id', { enabled: true })).status).toBe(400)
  })

  test('enforces the per-scope count and total size limits', async () => {
    for (let index = 0; index < 3; index += 1) {
      expect(
        (
          await create({
            scope: 'personal',
            title: `t${String(index)}`,
            content: 'x'.repeat(8_000),
          })
        ).status,
      ).toBe(201)
    }
    const tooLarge = await create({ scope: 'personal', title: 'more', content: 'x' })

    expect(tooLarge.status).toBe(422)
    expect(((await tooLarge.json()) as { error: { code: string } }).error.code).toBe(
      'instruction_limit_exceeded',
    )

    collection.reset()
    for (let index = 0; index < 20; index += 1) {
      await create({ scope: 'team', title: `t${String(index)}`, content: 'x' })
    }
    expect((await create({ scope: 'team', title: 'overflow', content: 'x' })).status).toBe(422)
  })

  test('runtime conversations change instructions only during a live user turn', async () => {
    const refusedTurns: ConversationTurn[] = [
      { key: 'turn-1', origin: 'trigger' },
      { origin: 'user' },
      {},
    ]

    for (const turn of refusedTurns) {
      conversationTurn = turn
      expect((await app.request('/')).status).toBe(200)
      const refused = await create({ scope: 'personal', title: 't', content: 'x' })

      expect(refused.status).toBe(403)
      expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
        'instructions_user_conversation_required',
      )
    }
    expect(collection.docs).toHaveLength(0)

    conversationTurn = { key: 'turn-4', origin: 'user' }
    expect((await create({ scope: 'personal', title: 't', content: 'x' })).status).toBe(201)
  })
})
