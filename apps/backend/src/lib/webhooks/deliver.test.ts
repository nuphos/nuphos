import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { MongoServerError, ObjectId } from 'mongodb'

import { config } from '@/config'
import { encryptWebhookSecret } from '@/lib/byos/secrets'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useMcpNotifications } from '@/lib/test/doubles/mcp-notifications'

import { RETRY_WINDOW_MS, deliverDueWebhooks } from './deliver'

import type { TeamWebhook, WebhookDelivery } from './store'

process.env.LINODE_BYOK_ENCRYPTION_KEY = 'a'.repeat(64)

type Doc = Record<string, unknown>
const tables = new Map<string, Doc[]>()
const table = (name: string) => {
  const rows = tables.get(name) ?? []

  tables.set(name, rows)

  return rows
}

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([field, want]) => {
    if (want && typeof want === 'object' && '$lte' in want)
      return (doc[field] as Date) <= (want as { $lte: Date }).$lte

    return String(doc[field]) === String(want)
  })
}

const ONCE = ['webhookId', 'sessionId', 'type', 'stateHash']

function collection(name: string) {
  const rows = table(name)

  return {
    findOne: async (filter: Doc) => rows.find((row) => matches(row, filter)) ?? null,
    findOneAndUpdate: async (filter: Doc, update: { $set: Doc }) => {
      const row = rows
        .filter((r) => matches(r, filter))
        .sort((a, b) => Number(a.nextAttemptAt) - Number(b.nextAttemptAt))[0]

      if (!row) return null
      const before = { ...row }

      Object.assign(row, update.$set)

      return before
    },
    updateOne: async (filter: Doc, update: { $set: Doc }) => {
      const row = rows.find((r) => matches(r, filter))

      if (!row) return { modifiedCount: 0 }
      const next = { ...row, ...update.$set }

      if (
        name === 'team_webhook_deliveries' &&
        next.stateHash &&
        rows.some((r) => r !== row && ONCE.every((k) => String(r[k]) === String(next[k])))
      )
        throw new MongoServerError({ message: 'duplicate key', code: 11000 })
      Object.assign(row, update.$set)

      return { modifiedCount: 1 }
    },
  }
}

useDb({ db: () => ({ collection }) as never })
let role: string | null = 'ADMINISTRATOR'

useIdentity({ getTeamMembership: async () => (role ? { role } : null) })
let status = 'completed'
let message = 1

useMcpNotifications({
  sessionNotification: async (sessionId: string) => ({
    id: `hash-${status}-${String(message)}`,
    notification: {
      jsonrpc: '2.0',
      method: 'notifications/nuphos/session',
      params: { session_id: sessionId, status, message_count: message, answer: 'Done.' },
    },
  }),
})

let reply = 200
const received: { headers: Headers; body: Doc }[] = []
let server: ReturnType<typeof Bun.serve>

beforeAll(() => {
  config.byos.outbound.allowPrivateHosts = true
  server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      received.push({ headers: req.headers, body: (await req.json()) as Doc })

      return new Response(null, { status: reply })
    },
  })
})

afterAll(async () => {
  config.byos.outbound.allowPrivateHosts = false
  await server.stop(true)
})

const hookId = new ObjectId()
const createdAt = new Date('2026-01-01T00:00:00Z')

function hook(events: TeamWebhook['events'] = ['session.turn.completed']): TeamWebhook {
  return {
    _id: hookId,
    teamId: 'team-1',
    name: 'Ops',
    url: `http://127.0.0.1:${String(server.port)}/hook`,
    events,
    headers: [{ name: 'Authorization', value: encryptWebhookSecret('Bearer s3cret') }],
    enabled: true,
    createdBy: 'admin-1',
    createdAt,
    updatedAt: createdAt,
  }
}

function queue(id: string, extra: Partial<WebhookDelivery> = {}): WebhookDelivery {
  const row: WebhookDelivery = {
    _id: id,
    webhookId: hookId,
    teamId: 'team-1',
    sessionId: 'session-1',
    state: 'pending',
    attempts: 0,
    nextAttemptAt: createdAt,
    createdAt,
    ...extra,
  }

  table('team_webhook_deliveries').push(row)

  return row
}

const now = new Date(createdAt.getTime() + 5_000)
const endpoint = () => table('team_webhooks')[0] as TeamWebhook

beforeEach(() => {
  tables.clear()
  received.length = 0
  reply = 200
  role = 'ADMINISTRATOR'
  status = 'completed'
  message = 1
})

describe('deliverDueWebhooks', () => {
  test('posts the session state with the endpoint headers', async () => {
    table('team_webhooks').push(hook())
    const row = queue('evt_1')

    expect(await deliverDueWebhooks(now)).toBe(1)
    expect(row.state).toBe('delivered')
    expect(received).toHaveLength(1)
    const { headers, body } = received[0]!

    expect(headers.get('authorization')).toBe('Bearer s3cret')
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('webhook-id')).toBe('evt_1')
    expect(body).toMatchObject({
      id: 'evt_1',
      type: 'session.turn.completed',
      team_id: 'team-1',
      data: {
        session_id: 'session-1',
        status: 'completed',
        answer: 'Done.',
        next: { check: { tool: 'nuphos_check', session_id: 'session-1' } },
      },
    })
    expect(endpoint().lastDelivery).toMatchObject({ ok: true, status: 200 })
  })

  test('a hint picks the event type', async () => {
    table('team_webhooks').push(hook(['task.reported']))
    queue('evt_1', { hint: 'task.reported' })

    await deliverDueWebhooks(now)
    expect(received[0]?.body.type).toBe('task.reported')
  })

  test('skips events the endpoint did not subscribe to, and running sessions', async () => {
    table('team_webhooks').push(hook(['session.turn.failed']))
    const done = queue('evt_1')

    await deliverDueWebhooks(now)
    status = 'running'
    const running = queue('evt_2', { nextAttemptAt: now })

    await deliverDueWebhooks(now)
    expect([done.state, running.state]).toEqual(['skipped', 'skipped'])
    expect(received).toHaveLength(0)
  })

  test('announces one state once', async () => {
    table('team_webhooks').push(hook())
    queue('evt_1')
    const again = queue('evt_2')

    await deliverDueWebhooks(now)
    expect(received).toHaveLength(1)
    expect(again.state).toBe('skipped')
  })

  test('sends nothing once the creator is no longer an administrator', async () => {
    table('team_webhooks').push(hook())
    role = 'MEMBER'
    const row = queue('evt_1')

    await deliverDueWebhooks(now)
    expect(row.state).toBe('skipped')
    expect(received).toHaveLength(0)
  })

  test('retries a 5xx with the same payload', async () => {
    table('team_webhooks').push(hook())
    reply = 503
    const row = queue('evt_1')

    await deliverDueWebhooks(now)
    expect(row).toMatchObject({ state: 'pending', attempts: 1, lastError: 'HTTP 503' })
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime())

    message = 2
    reply = 200
    await deliverDueWebhooks(row.nextAttemptAt)
    expect(row.state).toBe('delivered')
    expect(received.map((r) => r.body.id)).toEqual(['evt_1', 'evt_1'])
    expect(received[1]?.body).toEqual(received[0]!.body)
  })

  test('fails a 4xx without retrying and keeps the endpoint on', async () => {
    table('team_webhooks').push(hook())
    reply = 404
    const row = queue('evt_1')

    await deliverDueWebhooks(now)
    expect(row).toMatchObject({ state: 'failed', attempts: 1 })
    expect(endpoint().enabled).toBe(true)
  })

  test('410 Gone switches the endpoint off', async () => {
    table('team_webhooks').push(hook())
    reply = 410
    queue('evt_1')

    await deliverDueWebhooks(now)
    expect(endpoint()).toMatchObject({ enabled: false })
    expect(endpoint().disabledReason).toContain('410')
    const later = queue('evt_2', { nextAttemptAt: now })

    await deliverDueWebhooks(now)
    expect(later.state).toBe('skipped')
  })

  test('a day of failures switches the endpoint off', async () => {
    table('team_webhooks').push(hook())
    reply = 500
    const row = queue('evt_1')
    const late = new Date(createdAt.getTime() + RETRY_WINDOW_MS)

    await deliverDueWebhooks(late)
    expect(row.state).toBe('failed')
    expect(endpoint().enabled).toBe(false)
  })

  test('refuses private addresses unless allowed', async () => {
    config.byos.outbound.allowPrivateHosts = false
    try {
      table('team_webhooks').push(hook())
      const row = queue('evt_1')

      await deliverDueWebhooks(now)
      expect(row.state).toBe('failed')
      expect(received).toHaveLength(0)
    } finally {
      config.byos.outbound.allowPrivateHosts = true
    }
  })
})
