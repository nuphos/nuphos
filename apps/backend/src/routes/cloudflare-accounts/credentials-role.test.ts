import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { errorHandler } from '@/lib/errors'

import { registerCloudflareAccountRoutes } from './account'

import type { CloudflareAccountVariables } from '@/middleware/auth'

function app(role: 'ADMINISTRATOR' | 'EDITOR' | 'VIEWER') {
  const scoped = new Hono<{ Variables: CloudflareAccountVariables }>()

  scoped.use('*', async (c, next) => {
    c.set('teamRole', role)
    c.set('cloudflareAccountId', 'a'.repeat(32))
    c.set('cloudflareAccountName', 'Acme')
    c.set('cloudflareBinding', { oauth: {} } as never)
    await next()
  })
  registerCloudflareAccountRoutes(scoped)

  return scoped.onError(errorHandler)
}

describe('GET /cloudflare-accounts/:id/credentials', () => {
  test('refuses team viewers', async () => {
    expect((await app('VIEWER').request('/credentials')).status).toBe(403)
  })

  test('serves editors', async () => {
    const response = await app('EDITOR').request('/credentials')

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ authType: 'oauth' })
  })
})
