import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { errorHandler } from '@/lib/errors'
import { useAgentSessionsShared } from '@/lib/test/doubles/agent-sessions-shared'
import { useCredentialRole } from '@/lib/test/doubles/byos-credential-role'
import { useByosSecrets } from '@/lib/test/doubles/byos-secrets'
import { useModels } from '@/lib/test/doubles/models'

const TEAM_ID = new ObjectId()
const INTEGRATION_ID = new ObjectId()
const EDITORS = new Set(['editor'])
const envelope = { ciphertext: 'uptime-token' }

useModels({
  teamByosBindings: () => ({
    findOne: async () => ({
      _id: TEAM_ID,
      betterStackIntegrations: [
        {
          id: INTEGRATION_ID,
          label: 'Ops',
          encryptedUptimeApiToken: envelope,
          access: { memberAllowList: ['*'] },
        },
      ],
    }),
  }),
})
useByosSecrets({
  decryptBetterStackToken: (value: { ciphertext: string }) => value.ciphertext,
})
useCredentialRole({
  canMintCredentials: (_teamId: string, userIds: string[]) =>
    Promise.resolve(userIds.every((id) => EDITORS.has(id))),
})
useAgentSessionsShared({
  getAgentCredentialAccess: async () =>
    ({ betterStackIntegrationIds: [INTEGRATION_ID.toHexString()] }) as never,
})

const { requireBetterStackIntegration } = await import('@/middleware/auth')
const { betterStackScoped } = await import('@/routes/agent-sessions/betterstack')
const { registerBetterStackIntegrationRoutes } = await import('./integration-scoped')

const PATH = `/betterstack-integrations/${INTEGRATION_ID.toHexString()}/credentials`

function request(vars: Record<string, unknown>, mount: (router: Hono) => void) {
  const router = new Hono()

  router.onError(errorHandler)
  router.use('*', async (c, next) => {
    const ctx = c as unknown as { set: (key: string, value: unknown) => void }

    ctx.set('teamId', TEAM_ID.toHexString())
    for (const [key, value] of Object.entries(vars)) ctx.set(key, value)
    await next()
  })
  mount(router)

  return router.request(PATH)
}

function desktop(teamRole: string) {
  return request({ userId: 'member', teamRole }, (router) => {
    const scoped = new Hono()

    scoped.use('*', requireBetterStackIntegration() as never)
    registerBetterStackIntegrationRoutes(scoped as never)
    router.route('/betterstack-integrations/:integrationId', scoped)
  })
}

function agent(sender: string) {
  const conversation = { userId: sender, sessionId: 's', conversationOwnerUserId: sender }

  return request({ userId: sender, agent: conversation }, (router) => {
    router.route('/betterstack-integrations/:integrationId', betterStackScoped as never)
  })
}

describe('Better Stack credentials are write-level', () => {
  test('an editor gets the tokens from the app', async () => {
    const res = await desktop('EDITOR')

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ uptimeApiToken: 'uptime-token' })
  })

  test('a viewer cannot read the tokens from the app', async () => {
    expect((await desktop('VIEWER')).status).toBe(403)
  })

  test('an editor conversation gets the tokens', async () => {
    const res = await agent('editor')

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ uptimeApiToken: 'uptime-token' })
  })

  test('a viewer conversation cannot read the tokens', async () => {
    expect((await agent('viewer')).status).toBe(403)
  })
})
