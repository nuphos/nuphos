import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { config } from '@/config'
import * as composioClient from '@/lib/composio'
import { errorHandler } from '@/lib/errors'
import { useModels } from '@/lib/test/doubles/models'

import { trelloAppRoutes } from './trello-app'
import { persistTrelloBinding, publicView, trelloIntegrationsRoutes } from './trello-integrations'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { TrelloIntegrationBinding } from '@/models'

const TEAM = new ObjectId()
const MEMBER = new ObjectId().toHexString()

type Pending = {
  _id: string
  teamId: ObjectId
  requesterUserId: string
  composioAccountId: string
  expiresAt: Date
}
let pending: Pending[]
let staged: Record<string, unknown>[]
let stored: TrelloIntegrationBinding[]
let writes: number
let calls: string[]
let callbackUrls: string[]
let deleted: string[]
let profileFails: boolean
let cleanupFails: boolean
let role: 'ADMINISTRATOR' | 'VIEWER'
const realFetch = globalThis.fetch
const authConfigSpy = spyOn(composioClient, 'composioAuthConfigId').mockResolvedValue('ac_fixture')

afterAll(() => authConfigSpy.mockRestore())
const saved = {
  ...config.byos.composio,
  publicBackendUrl: config.agent.publicBackendUrl,
  backendUrl: config.agent.backendUrl,
  deferred: config.byos.connectorOAuthDeferredBind,
}

useModels({
  trelloPendingOAuth: () => ({
    insertOne: async (doc: Pending) => {
      pending.push(doc)

      return { acknowledged: true }
    },
    findOneAndDelete: async (filter: { _id: string }) => {
      const index = pending.findIndex((p) => p._id === filter._id)

      return index < 0 ? null : pending.splice(index, 1)[0]
    },
  }),
  connectorOAuthReady: () => ({
    insertOne: async (doc: Record<string, unknown>) => {
      staged.push(doc)

      return { acknowledged: true }
    },
  }),
  teamByosBindings: () => ({
    findOne: async () => ({ trelloIntegrations: stored }),
    updateOne: async (
      _filter: unknown,
      update: {
        $push?: { trelloIntegrations: TrelloIntegrationBinding }
        $set?: Record<string, unknown>
      },
    ) => {
      if (update.$push) stored.push(update.$push.trelloIntegrations)
      if (update.$set?.['trelloIntegrations.$'])
        stored = [update.$set['trelloIntegrations.$'] as TrelloIntegrationBinding]
      writes += 1

      return { matchedCount: 1 }
    },
  }),
})

beforeEach(() => {
  pending = []
  staged = []
  writes = 0
  stored = []
  calls = []
  deleted = []
  profileFails = false
  cleanupFails = false
  role = 'ADMINISTRATOR'
  Object.assign(config.byos.composio, { apiKey: 'fixture-key' })
  config.agent.publicBackendUrl = 'https://app.example'
  config.agent.backendUrl = undefined
  callbackUrls = []
  config.byos.connectorOAuthDeferredBind = false
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(url instanceof Request ? url.url : url.toString()).pathname

    calls.push(path)
    if (path.endsWith('/link'))
      callbackUrls.push((JSON.parse(init?.body as string) as { callback_url: string }).callback_url)
    if (init?.method === 'DELETE') {
      deleted.push(path)
      if (cleanupFails)
        return new Response(JSON.stringify({ error: { message: 'fixture-secret-marker' } }), {
          status: 503,
        })
    }
    const body = path.endsWith('/link')
      ? {
          redirect_url: 'https://connect.composio.dev/link/fixture',
          connected_account_id: 'ca_fixture',
        }
      : path.includes('/tools/execute/')
        ? { successful: !profileFails, data: { id: 'member-fixture', username: 'Fixture' } }
        : {
            status: 'ACTIVE',
            user_id: `${TEAM.toHexString()}:${MEMBER}`,
            toolkit: { slug: 'trello' },
            auth_config: { id: 'ac_fixture' },
          }

    return new Response(JSON.stringify(body))
  }) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
  const { publicBackendUrl, backendUrl, deferred, ...composio } = saved

  Object.assign(config.byos.composio, composio)
  config.agent.publicBackendUrl = publicBackendUrl
  config.agent.backendUrl = backendUrl
  config.byos.connectorOAuthDeferredBind = deferred
})

function app() {
  const outer = new Hono<{ Variables: TeamAuthVariables }>()

  outer.onError(errorHandler)
  outer.use('/trello-integrations/*', async (c, next) => {
    c.set('teamId', TEAM.toHexString())
    c.set('userId', MEMBER)
    c.set('teamRole', role)
    await next()
  })
  outer.route('/trello-integrations', trelloIntegrationsRoutes)
  outer.route('/trello-app', trelloAppRoutes)

  return outer
}

async function start() {
  const response = await app().request('/trello-integrations/start-oauth', { method: 'POST' })

  expect(response.status).toBe(200)

  return (await response.json()) as { state: string }
}

describe('Trello managed OAuth lifecycle', () => {
  test('only administrators can start a team connection', async () => {
    role = 'VIEWER'
    expect(
      (await app().request('/trello-integrations/start-oauth', { method: 'POST' })).status,
    ).toBe(403)
    expect(calls).toHaveLength(0)
  })
  test('falls back to a public NUPHOS_BACKEND_URL like the other connectors', async () => {
    config.agent.publicBackendUrl = undefined
    config.agent.backendUrl = 'https://api.example'
    const { state } = await start()

    expect(callbackUrls).toEqual([`https://api.example/trello-app/setup?state=${state}`])
  })
  test('refuses to start without a public HTTPS backend URL', async () => {
    config.agent.publicBackendUrl = undefined
    config.agent.backendUrl = 'http://nuphos-backend.prod.svc:3000'
    const response = await app().request('/trello-integrations/start-oauth', { method: 'POST' })

    expect(response.status).toBe(503)
    expect(calls).toHaveLength(0)
  })
  test('callback stages the original account and never trusts a callback account ID', async () => {
    const { state } = await start()
    const response = await app().request(
      `/trello-app/setup?state=${state}&status=success&connected_account_id=ca_attacker`,
    )

    expect(response.status).toBe(200)
    expect(staged).toHaveLength(1)
    expect(staged[0]).toMatchObject({
      provider: 'trello',
      requesterUserId: MEMBER,
      binding: { composioAccountId: 'ca_fixture' },
    })
    expect(writes).toBe(0)
    expect(deleted).toHaveLength(0)
    expect(calls.some((path) => path.includes('ca_attacker'))).toBe(false)
    await app().request(`/trello-app/setup?state=${state}&status=success`)
    expect(staged).toHaveLength(1)
  })
  test('expired, declined and unknown callbacks never stage a binding', async () => {
    const { state } = await start()

    pending[0]!.expiresAt = new Date(0)
    await app().request(`/trello-app/setup?state=${state}&status=success`)
    const second = await start()

    await app().request(`/trello-app/setup?state=${second.state}&status=failed`)
    await app().request('/trello-app/setup?state=unknown&status=success')
    expect(deleted).toEqual([
      '/api/v3.1/connected_accounts/ca_fixture',
      '/api/v3.1/connected_accounts/ca_fixture',
    ])
    expect(staged).toHaveLength(0)
    expect(writes).toBe(0)
  })
  test('a failed profile lookup deletes the pending connection without staging it', async () => {
    const { state } = await start()

    profileFails = true
    await app().request(`/trello-app/setup?state=${state}&status=success`)
    expect(staged).toHaveLength(0)
    expect(deleted).toEqual(['/api/v3.1/connected_accounts/ca_fixture'])
  })
  test('a cleanup failure is best effort and never forwards upstream secrets', async () => {
    const { state } = await start()

    cleanupFails = true
    const response = await app().request(`/trello-app/setup?state=${state}&status=failed`)

    expect(staged).toHaveLength(0)
    expect(deleted).toHaveLength(1)
    expect(await response.text()).not.toContain('fixture-secret-marker')
  })
  test('cancel removes the pending connection and prevents late approval', async () => {
    const { state } = await start()

    expect(
      (await app().request(`/trello-integrations/start-oauth/${state}`, { method: 'DELETE' }))
        .status,
    ).toBe(204)
    await app().request(`/trello-app/setup?state=${state}&status=success`)
    expect(staged).toHaveLength(0)
    expect(calls).toContain('/api/v3.1/connected_accounts/ca_fixture')
  })
  test('reconnecting preserves the selected binding and explicit ACL', async () => {
    const draft = {
      memberId: 'member-fixture',
      username: 'Fixture',
      authorizedBy: MEMBER,
      composioAccountId: 'ca_fixture',
      composioUserId: `${TEAM.toHexString()}:${MEMBER}`,
    }
    const first = await persistTrelloBinding(TEAM, draft)

    stored[0]!.access!.memberAllowList = ['chosen-member']
    const second = await persistTrelloBinding(TEAM, {
      ...draft,
      composioAccountId: 'ca_reconnected',
    })

    expect(second.binding_id).toBe(first.binding_id)
    expect(stored).toHaveLength(1)
    expect(stored[0]!.access!.memberAllowList).toEqual(['chosen-member'])
    expect(calls).toContain('/api/v3.1/connected_accounts/ca_fixture')
  })
  test('public metadata does not expose the Composio connection or credentials', () => {
    const view = publicView({
      id: new ObjectId(),
      label: 'Fixture',
      memberId: 'member',
      username: 'fixture',
      authorizedBy: MEMBER,
      createdAt: new Date(),
      composioAccountId: 'ca_private',
      composioUserId: 'private-user',
    } as TrelloIntegrationBinding)

    expect(JSON.stringify(view)).not.toContain('ca_private')
    expect(JSON.stringify(view)).not.toContain('private-user')
  })
})
