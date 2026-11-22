import { beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { errorHandler } from '@/lib/errors'
import { useAgentSessionsShared } from '@/lib/test/doubles/agent-sessions-shared'
import { useByosAccount } from '@/lib/test/doubles/byos-account'
import { useByosSecrets } from '@/lib/test/doubles/byos-secrets'
import { useIdentity } from '@/lib/test/doubles/identity'

import type { AgentZeaburVars } from './shared'

const teamId = new ObjectId().toHexString()
const providerId = 'provider-1'
let selected: string[] = []
let bound = true
let decrypted = 0
const roles = new Map<string, 'ADMINISTRATOR' | 'EDITOR' | 'VIEWER'>()

useIdentity({
  getTeamMembership: (userId) => {
    const role = roles.get(userId)

    return role ? { role } : null
  },
})
useByosAccount({
  findZeaburProviderByZeaburId: () =>
    bound
      ? {
          identities: [{ zeaburId: providerId, kind: 'team', name: 'Fixture' }],
          encryptedToken: {},
        }
      : null,
})
useByosSecrets({
  decryptZeaburToken: () => {
    decrypted += 1

    return 'fixture-token'
  },
})
useAgentSessionsShared({ getAgentCredentialAccess: () => ({ zeaburIds: selected }) })

const { zeaburScoped } = await import('./zeabur')

function request(sender = 'editor', owner = 'editor') {
  const app = new Hono<{ Variables: AgentZeaburVars }>()

  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    c.set('teamId', teamId)
    c.set('userId', sender)
    c.set('agent', { userId: sender, conversationOwnerUserId: owner, sessionId: 'fixture' })
    await next()
  })
  app.route('/zeabur-providers/:zeaburId', zeaburScoped)

  return app.request(`/zeabur-providers/${providerId}/credentials`)
}

beforeEach(() => {
  selected = [providerId]
  bound = true
  decrypted = 0
  roles.clear()
  roles.set('admin', 'ADMINISTRATOR')
  roles.set('editor', 'EDITOR')
  roles.set('viewer', 'VIEWER')
})

for (const sender of ['admin', 'editor']) {
  test(`vends selected credentials to ${sender} in an editor-owned conversation`, async () => {
    const response = await request(sender)

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toMatchObject({ token: 'fixture-token' })
    expect(decrypted).toBe(1)
  })
}

for (const [sender, owner] of [
  ['viewer', 'admin'],
  ['admin', 'viewer'],
  ['missing', 'editor'],
] as const) {
  test(`refuses credentials for sender ${sender} and owner ${owner}`, async () => {
    expect((await request(sender, owner)).status).toBe(403)
    expect(decrypted).toBe(0)
  })
}

test('refuses an unselected provider before decrypting', async () => {
  selected = []
  expect((await request()).status).toBe(403)
  expect(decrypted).toBe(0)
})

test('refuses a provider that is no longer bound to the team', async () => {
  bound = false
  expect((await request()).status).toBe(404)
  expect(decrypted).toBe(0)
})
