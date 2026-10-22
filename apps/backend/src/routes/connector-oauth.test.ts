import { afterEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { config } from '@/config'
import { errorHandler } from '@/lib/errors'
import { useModels } from '@/lib/test/doubles/models'

type Ready = Record<string, unknown> & { _id: string }
const staged = new Map<string, Ready>()

function valueAt(doc: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], doc)
}

function matches(doc: Ready, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, expected]) =>
    key === 'expiresAt'
      ? (doc.expiresAt as Date) > (expected as { $gt: Date }).$gt
      : String(valueAt(doc, key)) === String(expected),
  )
}

useModels({
  connectorOAuthReady: () =>
    ({
      insertOne: (doc: Ready) => {
        staged.set(doc._id, doc)

        return Promise.resolve({ acknowledged: true })
      },
      findOneAndDelete: (filter: Record<string, unknown>) => {
        const doc = staged.get(filter._id as string)

        if (!doc || !matches(doc, filter)) return Promise.resolve(null)
        staged.delete(doc._id)

        return Promise.resolve(doc)
      },
    }) as never,
})

const { finishConnectorOAuth } = await import('@/lib/connector-oauth')
const { connectorOAuthRoutes } = await import('./connector-oauth')

const TEAM = new ObjectId()
const USER = 'requester'

afterEach(() => {
  config.byos.connectorOAuthDeferredBind = false
  staged.clear()
})

async function stage(state: string, provider: string, draft: Record<string, unknown>) {
  config.byos.connectorOAuthDeferredBind = true
  const { code = '' } = await finishConnectorOAuth({
    provider,
    state,
    teamId: TEAM,
    requesterUserId: USER,
    draft,
    persist: () => Promise.resolve({}),
  })

  return code
}

function complete(state: string, code: string, teamRole: string) {
  const app = new Hono()

  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    const ctx = c as unknown as { set: (key: string, value: unknown) => void }

    ctx.set('teamId', TEAM.toHexString())
    ctx.set('userId', USER)
    ctx.set('teamRole', teamRole)
    await next()
  })
  app.route('/', connectorOAuthRoutes as never)

  return app.request(`/${state}/complete`, { method: 'POST', body: JSON.stringify({ code }) })
}

describe('POST /connector-oauth/:state/complete', () => {
  test.each(['EDITOR', 'VIEWER'])(
    'a requester who is now %s cannot finish connecting a workspace',
    async (role) => {
      const code = await stage('s1', 'linear', {})
      const res = await complete('s1', code, role)

      expect(res.status).toBe(404)
      // Refused without consuming it, so nothing was bound.
      expect(staged.has('s1')).toBe(true)
    },
  )

  test('a member still finishes linking their own Discord account', async () => {
    const code = await stage('s2', 'discord', { pending: { operation: 'link' } })

    await complete('s2', code, 'VIEWER')
    expect(staged.has('s2')).toBe(false)
  })

  test('a member cannot finish a Discord server install', async () => {
    const code = await stage('s3', 'discord', { pending: { operation: 'install' } })

    expect((await complete('s3', code, 'VIEWER')).status).toBe(404)
    expect(staged.has('s3')).toBe(true)
  })
})
