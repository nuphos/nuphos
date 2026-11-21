import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { decryptWebhookSecret } from '@/lib/byos/secrets'
import { errorHandler } from '@/lib/errors'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'
import { nuphosWebhooks } from '@/routes/mcp/webhooks'

import { teamWebhooksRoutes } from './team-webhooks'

import type { TeamWebhook } from '@/lib/webhooks/store'

process.env.LINODE_BYOK_ENCRYPTION_KEY = 'a'.repeat(64)

type Doc = Record<string, unknown>
const tables = new Map<string, Doc[]>()
const table = (name: string) => {
  const rows = tables.get(name) ?? []

  tables.set(name, rows)

  return rows
}
const matches = (doc: Doc, filter: Doc) =>
  Object.entries(filter).every(([field, want]) => String(doc[field]) === String(want))

function collection(name: string) {
  const rows = table(name)

  return {
    find: (filter: Doc) => {
      const found = rows.filter((row) => matches(row, filter))
      const cursor = { sort: () => cursor, toArray: async () => found }

      return cursor
    },
    countDocuments: async (filter: Doc) => rows.filter((row) => matches(row, filter)).length,
    insertOne: async (doc: Doc) => {
      rows.push(doc)
    },
    findOne: async (filter: Doc) => rows.find((row) => matches(row, filter)) ?? null,
    findOneAndUpdate: async (filter: Doc, update: { $set: Doc; $unset?: Doc }) => {
      const row = rows.find((r) => matches(r, filter))

      if (!row) return null
      Object.assign(row, update.$set)
      for (const field of Object.keys(update.$unset ?? {})) Reflect.deleteProperty(row, field)

      return row
    },
    deleteOne: async (filter: Doc) => {
      rows.splice(
        rows.findIndex((row) => matches(row, filter)),
        1,
      )
    },
    deleteMany: async (filter: Doc) => {
      const keep = rows.filter((row) => !matches(row, filter))

      rows.splice(0, rows.length, ...keep)
    },
  }
}

useDb({ db: () => ({ collection }) as never })

let role = 'ADMINISTRATOR'
let member = true

useIdentity({
  getTeamMembership: async () => (member ? { role, team: {} } : null),
})
const app = new Hono()

app.onError(errorHandler)
app.use('*', async (c, next) => {
  c.set('teamId' as never, 'team-1')
  c.set('userId' as never, 'admin-1')
  c.set('teamRole' as never, role)
  await next()
})
app.route('/webhooks', teamWebhooksRoutes)

const call = (method: string, path: string, body?: unknown) =>
  app.request(`/webhooks${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const valid = {
  name: 'Ops',
  url: 'https://hooks.example.com/nuphos',
  events: ['session.turn.completed', 'session.turn.completed'],
  headers: [{ name: 'Authorization', value: 'Bearer s3cret' }],
}

async function create(): Promise<string> {
  const res = await call('POST', '', valid)

  expect(res.status).toBe(201)

  return ((await res.json()) as { webhook: { id: string } }).webhook.id
}

const stored = () => table('team_webhooks')[0] as unknown as TeamWebhook

beforeEach(() => {
  tables.clear()
  role = 'ADMINISTRATOR'
  member = true
})

describe('team webhooks routes', () => {
  test('only administrators can manage webhooks', async () => {
    role = 'MEMBER'
    expect((await call('GET', '')).status).toBe(403)
  })

  test('creates an endpoint with encrypted headers and shows only header names', async () => {
    await create()
    expect(stored().events).toEqual(['session.turn.completed'])
    expect(stored().createdBy).toBe('admin-1')
    expect(JSON.stringify(stored().headers)).not.toContain('s3cret')
    expect(decryptWebhookSecret(stored().headers[0]!.value)).toBe('Bearer s3cret')

    const listed = (await (await call('GET', '')).json()) as {
      webhooks: Doc[]
      events: string[]
    }

    expect(listed.webhooks[0]).toMatchObject({ headers: ['Authorization'], enabled: true })
    expect(JSON.stringify(listed)).not.toContain('s3cret')
    expect(listed.events).toContain('task.reported')
  })

  test.each([
    ['plain http', { url: 'http://hooks.example.com/nuphos' }],
    ['a private address', { url: 'https://127.0.0.1/hook' }],
    ['a reserved header', { headers: [{ name: 'Webhook-Id', value: 'x' }] }],
    ['a header with a newline', { headers: [{ name: 'X-Key', value: 'a\r\nb' }] }],
    ['no events', { events: [] }],
    ['an unknown event', { events: ['session.created'] }],
  ])('rejects %s', async (_label, patch) => {
    expect((await call('POST', '', { ...valid, ...patch })).status).toBe(400)
  })

  test('an update keeps a header value that was not re-entered', async () => {
    const id = await create()
    const before = stored().headers[0]!.value
    const res = await call('PATCH', `/${id}`, {
      headers: [{ name: 'authorization' }, { name: 'X-Team', value: 'ops' }],
    })

    expect(res.status).toBe(200)
    expect(stored().headers.map((h) => h.name)).toEqual(['authorization', 'X-Team'])
    expect(stored().headers[0]!.value).toEqual(before)

    const missing = await call('PATCH', `/${id}`, { headers: [{ name: 'X-New' }] })

    expect(missing.status).toBe(400)
  })

  test('switching an endpoint back on clears why it was switched off', async () => {
    const id = await create()

    Object.assign(stored(), { enabled: false, disabledReason: 'The endpoint answered 410 Gone.' })
    await call('PATCH', `/${id}`, { enabled: true })
    expect(stored().enabled).toBe(true)
    expect(stored().disabledReason).toBeUndefined()
  })

  test('deleting an endpoint drops its queued deliveries', async () => {
    const id = await create()

    table('team_webhook_deliveries').push({ _id: 'evt_1', webhookId: stored()._id })
    expect((await call('DELETE', `/${id}`)).status).toBe(200)
    expect(table('team_webhooks')).toHaveLength(0)
    expect(table('team_webhook_deliveries')).toHaveLength(0)
    expect((await call('DELETE', `/${id}`)).status).toBe(404)
  })
})

describe('nuphos_webhooks MCP tool', () => {
  const team = 'a'.repeat(24)
  const tool = (args: Record<string, unknown>) =>
    nuphosWebhooks({ team_id: team, ...args }, { userId: 'mcp-admin' })

  test('manages webhooks through the Team settings routes', async () => {
    const created = await tool({ action: 'create', ...valid })
    const id = (created.structuredContent as { webhook: { id: string } }).webhook.id

    expect(created.isError).not.toBe(true)
    expect(JSON.stringify(created)).not.toContain('s3cret')
    expect(stored()).toMatchObject({ teamId: team, createdBy: 'mcp-admin' })
    expect(decryptWebhookSecret(stored().headers[0]!.value)).toBe('Bearer s3cret')

    await tool({ action: 'update', webhook_id: id, enabled: false, events: ['task.reported'] })
    expect(stored()).toMatchObject({ enabled: false, events: ['task.reported'] })
    const listed = await tool({ action: 'list' })

    expect(listed.structuredContent).toMatchObject({
      webhooks: [{ id, headers: ['Authorization'] }],
    })
    expect((await tool({ action: 'delete', webhook_id: id })).isError).not.toBe(true)
    expect(table('team_webhooks')).toHaveLength(0)
  })

  test('refuses what the routes refuse', async () => {
    const http = await tool({ action: 'create', ...valid, url: 'http://hooks.example.com/x' })

    expect(http.isError).toBe(true)
    expect(JSON.stringify(http)).toContain('URL must be https://')
    expect((await tool({ action: 'update' })).isError).toBe(true)
    role = 'MEMBER'
    expect(JSON.stringify(await tool({ action: 'list' }))).toContain('ADMINISTRATOR')
    member = false
    expect(JSON.stringify(await tool({ action: 'list' }))).toContain('not a member')
    expect(table('team_webhooks')).toHaveLength(0)
  })
})
