import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { errorHandler } from '@/lib/errors'
import { useAgentSessionsShared } from '@/lib/test/doubles/agent-sessions-shared'
import { useByosSecrets } from '@/lib/test/doubles/byos-secrets'
import { useModels } from '@/lib/test/doubles/models'

import type { AgentPosthogVars } from '@/routes/agent-sessions/shared'

const TEAM_ID = new ObjectId()
const USER_ID = new ObjectId().toHexString()
const BINDING_ID = new ObjectId()

let selected: string[] = []
let allowList = ['*']
let reconnectRequired = false

useModels({
  teamByosBindings: () => ({
    findOne: async () => ({
      _id: TEAM_ID,
      posthogIntegrations: [
        {
          id: BINDING_ID,
          label: 'Product',
          region: 'eu',
          apiBaseUrl: 'https://eu.posthog.com',
          userEmail: 'jane@acme.com',
          userUuid: 'u-1',
          projects: [{ id: 12, name: 'Web', organizationId: 'org', organizationName: 'Acme' }],
          clientId: 'https://api.example.com/posthog-app/client-metadata.json',
          scopedTeams: [],
          requestedScopes: ['user:read', 'query:read'],
          scope: 'user:read query:read',
          encryptedAccessToken: {
            v: 1,
            alg: 'A256GCM',
            keyId: 'default',
            iv: '',
            authTag: '',
            ciphertext: '',
          },
          encryptedRefreshToken: null,
          accessTokenExpiresAt: new Date(Date.now() + 3600_000),
          reconnectRequired,
          createdAt: new Date(),
          access: { memberAllowList: allowList, updatedAt: new Date(), updatedBy: USER_ID },
        },
      ],
    }),
  }),
})

useByosSecrets({ decryptPosthogSecret: () => 'pha_vended' })

useAgentSessionsShared({
  getAgentCredentialAccess: async () => ({ posthogIntegrationIds: selected }),
})

const { posthogScoped } = await import('@/routes/agent-sessions/posthog')

function fetchCredentials() {
  const outer = new Hono<{ Variables: AgentPosthogVars }>()

  outer.onError(errorHandler)
  outer.use('*', async (c, next) => {
    c.set('teamId', TEAM_ID.toHexString())
    c.set('userId', USER_ID)
    c.set('agent', { userId: USER_ID, sessionId: 's-1' } as AgentPosthogVars['agent'])
    await next()
  })
  outer.route('/posthog-integrations/:integrationId', posthogScoped)

  return outer.request(`/posthog-integrations/${BINDING_ID.toHexString()}/credentials`)
}

beforeEach(() => {
  selected = []
  allowList = ['*']
  reconnectRequired = false
})

describe('GET posthog-integrations/:id/credentials (session)', () => {
  test('vends the key, host and projects when the integration is selected', async () => {
    selected = [BINDING_ID.toHexString()]

    const res = await fetchCredentials()

    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store, private')
    expect(await res.json()).toMatchObject({
      apiBaseUrl: 'https://eu.posthog.com',
      accessToken: 'pha_vended',
      defaultProjectId: 12,
      projects: [{ id: 12, name: 'Web' }],
      authType: 'oauth_bearer',
    })
  })

  test('refuses an integration this conversation did not select', async () => {
    const res = await fetchCredentials()

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({
      error: { code: 'posthog_integration_agent_access_denied' },
    })
  })

  test('refuses a member outside the binding allow-list even when selected', async () => {
    selected = [BINDING_ID.toHexString()]
    allowList = [new ObjectId().toHexString()]

    const res = await fetchCredentials()

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: { code: 'posthog_integration_access_denied' } })
  })

  test('answers 409 when the grant needs a reconnect', async () => {
    selected = [BINDING_ID.toHexString()]
    reconnectRequired = true

    const res = await fetchCredentials()

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: { code: 'posthog_reconnect_required' } })
  })
})
