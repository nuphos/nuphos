import { afterEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { config } from '@/config'
import { AppError } from '@/lib/errors'
import { useModels } from '@/lib/test/doubles/models'

import { larkInstallationsRoutes } from './lark-installations'

import type { TeamAuthVariables } from '@/middleware/auth'

const saved = {
  publicBackendUrl: config.agent.publicBackendUrl,
  backendUrl: config.agent.backendUrl,
}
const binding = {
  id: new ObjectId(),
  appId: 'cli_testapp',
  domain: 'feishu',
  createdAt: new Date(),
}

const installModels = useModels({
  teamByosBindings: () => ({ findOne: () => Promise.resolve({ larkApps: [binding] }) }),
})

const app = new Hono<{ Variables: TeamAuthVariables }>()

app.use('*', async (c, next) => {
  c.set('teamId', new ObjectId().toHexString())
  c.set('teamRole', 'ADMINISTRATOR')
  await next()
})
app.onError((error, c) =>
  c.json({ error: error instanceof AppError ? error.code : 'internal' }, 503),
)
app.route('/installations', larkInstallationsRoutes)

afterEach(() => Object.assign(config.agent, saved))

describe('Lark event URLs belong to the configured backend', () => {
  for (const endpoint of ['', '/status']) {
    test(`${endpoint} returns the self-hosted public backend`, async () => {
      config.agent.publicBackendUrl = 'https://backend.example.test/'

      const response = await app.request(`/installations${endpoint}`)

      expect(response.status).toBe(200)
      expect(((await response.json()) as { webhookUrl: string }).webhookUrl).toBe(
        'https://backend.example.test/lark/events/cli_testapp',
      )
    })

    test(`${endpoint} never falls back to Cloud without a public backend`, async () => {
      config.agent.publicBackendUrl = undefined
      config.agent.backendUrl = undefined

      const response = await app.request(`/installations${endpoint}`)

      expect(response.status).toBe(503)
      expect(((await response.json()) as { error: string }).error).toBe(
        'public_backend_url_unconfigured',
      )
    })
  }
})

test('connecting requires a public backend before reading or writing credentials', async () => {
  config.agent.publicBackendUrl = undefined
  config.agent.backendUrl = undefined
  installModels({
    teamByosBindings: () => {
      throw new Error('Credentials must not be read or changed')
    },
  })
  const response = await app.request('/installations', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appId: 'cli_synthetic',
      appSecret: 'synthetic',
      encryptKey: 'synthetic',
    }),
  })

  expect(response.status).toBe(503)
  expect(((await response.json()) as { error: string }).error).toBe(
    'public_backend_url_unconfigured',
  )
})
