import { beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { errorHandler } from '@/lib/errors'
import { useEmail } from '@/lib/test/doubles/email'
import { useModels } from '@/lib/test/doubles/models'

import type { TeamInvitation } from '@/models'

const TEAM = new ObjectId()
let rows: TeamInvitation[] = []
let sent: string[] = []
let configured = true
let role = 'ADMINISTRATOR'
let now = Date.now()

const matches = (row: TeamInvitation, filter: Record<string, unknown>): boolean =>
  Object.entries(filter).every(([key, value]): boolean => {
    if (key === '$or')
      return (value as Record<string, unknown>[]).some((option) => matches(row, option))
    const actual = (row as Record<string, unknown>)[key]

    if (value && typeof value === 'object' && '$exists' in value)
      return (actual !== undefined) === (value as { $exists: boolean }).$exists
    if (value && typeof value === 'object' && '$lt' in value)
      return actual instanceof Date && actual < (value as { $lt: Date }).$lt
    if (value instanceof ObjectId) return value.equals(actual as ObjectId)

    return actual === value
  })

useModels({
  teamInvitations: () =>
    ({
      findOneAndUpdate: async (
        filter: Record<string, unknown>,
        update: { $set: object },
        options?: { returnDocument?: string },
      ) => {
        const row = rows.find((one) => matches(one, filter))

        if (!row) return null
        const before = { ...row }

        Object.assign(row, update.$set)

        return options?.returnDocument === 'before' ? before : row
      },
      updateOne: async (
        filter: Record<string, unknown>,
        update: { $set?: object; $unset?: Record<string, ''> },
      ) => {
        const row = rows.find((one) => matches(one, filter))

        if (!row) return { modifiedCount: 0 }
        Object.assign(row, update.$set ?? {})
        for (const key of Object.keys(update.$unset ?? {}))
          delete (row as Record<string, unknown>)[key]

        return { modifiedCount: 1 }
      },
      insertOne: async (row: TeamInvitation) => {
        rows.push(row)

        return { acknowledged: true }
      },
      findOne: async (filter: Record<string, unknown>) =>
        rows.find((one) => matches(one, filter)) ?? null,
      find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => rows }) }) }),
    }) as never,
})
useEmail({
  isEmailConfigured: () => configured,
  sendEmail: async ({ to }: { to: string }) => {
    sent.push(to)
  },
})

const { registerTeamInvitationRoutes } = await import('./invitations')
const app = new Hono()

app.use('*', async (c, next) => {
  c.set('teamId' as never, TEAM.toHexString() as never)
  c.set('teamRole' as never, role as never)
  c.set('team' as never, { name: 'Acme' } as never)
  c.set('userId' as never, new ObjectId().toHexString() as never)
  await next()
})
registerTeamInvitationRoutes(app as never)
app.onError(errorHandler)

const invitation = (minutesAgo: number, extra: Partial<TeamInvitation> = {}): TeamInvitation => ({
  _id: new ObjectId(),
  inviterId: new ObjectId(),
  teamId: TEAM,
  invitedAt: new Date(now - minutesAgo * 60_000),
  inviteeEmail: 'leo@acme.dev',
  ...extra,
})
const resend = (id: ObjectId) =>
  app.request(`/invitations/${id.toHexString()}/resend`, { method: 'POST' })

beforeEach(() => {
  rows = []
  sent = []
  configured = true
  role = 'ADMINISTRATOR'
  now = Date.now()
})

test('an admin resends a pending invitation, and the email goes out again', async () => {
  const pending = invitation(10)

  rows = [pending]
  const response = await resend(pending._id)

  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    emailSent: true,
    invitation: { id: pending._id.toHexString() },
  })
  expect(sent).toEqual(['leo@acme.dev'])
  expect(pending.lastSentAt).toBeInstanceOf(Date)
})

test('a resend right after the last email is refused, so nobody is spammed', async () => {
  rows = [invitation(30, { lastSentAt: new Date(now - 60_000) })]
  expect(await (await resend(rows[0]!._id)).json()).toMatchObject({
    error: { code: 'resend_too_soon' },
  })
  expect(sent).toEqual([])
})

test('accepted, cancelled, other teams’ and unknown invitations cannot be resent', async () => {
  const accepted = invitation(30, { acceptedAt: new Date() })
  const cancelled = invitation(30, { rejectedAt: new Date() })
  const elsewhere = invitation(30, { teamId: new ObjectId() })

  rows = [accepted, cancelled, elsewhere]
  for (const id of [accepted._id, cancelled._id, elsewhere._id, new ObjectId()])
    expect((await resend(id)).status).toBe(404)
  expect(sent).toEqual([])
})

test('only admins resend', async () => {
  role = 'EDITOR'
  rows = [invitation(30)]
  expect((await resend(rows[0]!._id)).status).toBe(403)
})

test('without email set up, the resend says so, and trying again is not held back', async () => {
  configured = false
  rows = [invitation(30)]
  expect(await (await resend(rows[0]!._id)).json()).toMatchObject({ emailSent: false })
  expect(rows[0]!.lastSentAt).toBeUndefined()
  expect(await (await resend(rows[0]!._id)).json()).toMatchObject({ emailSent: false })
  // An earlier send that did go out still counts.
  const earlier = new Date(now - 30 * 60_000)

  rows = [invitation(60, { lastSentAt: earlier })]
  await resend(rows[0]!._id)
  expect(rows[0]!.lastSentAt).toEqual(earlier)
})

test('the list carries the link the email points at, to copy, for admins only', async () => {
  rows = [invitation(30)]
  const list = async () =>
    (
      (await (await app.request('/invitations')).json()) as {
        invitations: { inviteUrl?: string }[]
      }
    ).invitations[0]

  expect((await list())?.inviteUrl).toMatch(/\/invite\?team=Acme$/u)
  for (const other of ['EDITOR', 'VIEWER']) {
    role = other
    expect(await list()).not.toHaveProperty('inviteUrl')
  }
})

test('after an invite whose email never went out, Resend sends at once, and only once', async () => {
  configured = false
  await create({ inviteeEmail: 'leo@acme.dev' })
  configured = true
  const id = rows[0]!._id

  expect(await (await resend(id)).json()).toMatchObject({ emailSent: true })
  expect(await (await resend(id)).json()).toMatchObject({ error: { code: 'resend_too_soon' } })
  expect(sent).toEqual(['leo@acme.dev'])
})

test('an invite whose email went out holds Resend back', async () => {
  await create({ inviteeEmail: 'leo@acme.dev' })
  expect(await (await resend(rows[0]!._id)).json()).toMatchObject({
    error: { code: 'resend_too_soon' },
  })
  expect(sent).toEqual(['leo@acme.dev'])
})

const create = (body: Record<string, unknown>) =>
  app.request('/invitations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

test('an invitation carries the role its person joins with', async () => {
  for (const role of ['VIEWER', 'ADMINISTRATOR', 'EDITOR'] as const) {
    rows = []
    const response = await create({ inviteeEmail: 'leo@acme.dev', role })

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ invitation: { role } })
    expect(rows[0]?.role).toBe(role)
  }
})

test('without a role, an invitation joins as Editor, as before', async () => {
  expect(await (await create({ inviteeEmail: 'leo@acme.dev' })).json()).toMatchObject({
    invitation: { role: 'EDITOR' },
  })
  rows = [invitation(30)]
  const body = (await (await app.request('/invitations')).json()) as {
    invitations: { role?: string }[]
  }

  // One made before roles were stored reads as Editor, which is what accepting it gives.
  expect(body.invitations[0]?.role).toBe('EDITOR')
})

test('an unknown role is refused', async () => {
  expect((await create({ inviteeEmail: 'leo@acme.dev', role: 'OWNER' })).status).toBe(400)
  expect(rows).toEqual([])
})
