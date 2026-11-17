import { beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { errorHandler } from '@/lib/errors'
import { useByosNotion } from '@/lib/test/doubles/byos-notion'
import { useByosSecrets } from '@/lib/test/doubles/byos-secrets'
import { useModels } from '@/lib/test/doubles/models'

import { notionIntegrationsRoutes } from './notion-integrations'

import type { NuphosTeam } from '@/lib/identity'
import type { TeamAuthVariables } from '@/middleware/auth'

// What the connect dialog sends reaches the binding that is stored.
let pushed: { access?: { memberAllowList: string[]; ownerUserId?: string } } | undefined

useByosNotion({
  verifyNotionToken: async () => ({ workspaceName: 'Acme', botId: 'bot' }) as never,
})
useByosSecrets({ encryptNotionSecret: () => ({ sealed: true }) as never })
useModels({
  teamByosBindings: () =>
    ({
      updateOne: async (
        _filter: unknown,
        update: { $push: { notionIntegrations: typeof pushed } },
      ) => {
        pushed = update.$push.notionIntegrations

        return { matchedCount: 1, modifiedCount: 1 }
      },
    }) as never,
})

beforeEach(() => {
  pushed = undefined
})

async function connect(share: unknown, teamDefault: 'private' | 'team' = 'private') {
  const app = new Hono<{ Variables: TeamAuthVariables }>()

  app.use('*', async (c, next) => {
    c.set('teamId', new ObjectId().toHexString())
    c.set('userId', 'u1')
    c.set('teamRole', 'ADMINISTRATOR')
    c.set('team', { bindingShareDefault: teamDefault } as unknown as NuphosTeam)
    await next()
  })
  app.route('/', notionIntegrationsRoutes)
  const response = await app.onError(errorHandler).request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: 'Docs', token: 'ntn_x', ...(share ? { share } : {}) }),
  })

  expect(response.status).toBeLessThan(300)

  return pushed?.access
}

test('only me: the binding is private to the member who connects it', async () => {
  expect(await connect({ mode: 'private' }, 'team')).toMatchObject({
    memberAllowList: ['u1'],
    ownerUserId: 'u1',
  })
})

test('the whole team: everyone may use it', async () => {
  expect(await connect({ mode: 'team' })).toMatchObject({ memberAllowList: ['*'] })
})

test('chosen members: they and the member who connects it', async () => {
  expect(await connect({ mode: 'members', memberIds: ['u2', 'u3'] })).toMatchObject({
    memberAllowList: ['u1', 'u2', 'u3'],
    ownerUserId: 'u1',
  })
})

test('no choice: the team default', async () => {
  expect(await connect(undefined, 'team')).toMatchObject({ memberAllowList: ['*'] })
  expect(await connect(undefined, 'private')).toMatchObject({ memberAllowList: ['u1'] })
})
