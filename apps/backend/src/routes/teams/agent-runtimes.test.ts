import { describe, expect, test } from 'bun:test'

import { probeSchema } from './agent-runtimes'

describe('agent runtime provider probe schema', () => {
  test('accepts an address and password with no other fields', () => {
    expect(
      probeSchema.safeParse({ url: 'wss://openab.example/acp', authKey: 'a-password' }).success,
    ).toBe(true)
  })

  test('rejects unknown fields, matching the connect form it backs', () => {
    expect(
      probeSchema.safeParse({
        url: 'wss://openab.example/acp',
        authKey: 'a-password',
        provider: 'codex',
      }).success,
    ).toBe(false)
  })

  test('rejects a missing password', () => {
    expect(probeSchema.safeParse({ url: 'wss://openab.example/acp', authKey: '' }).success).toBe(
      false,
    )
  })
})

test.each(['VIEWER', 'EDITOR'] as const)(
  '%s cannot request a managed runtime update',
  async (role) => {
    const { Hono } = await import('hono')
    const { registerAgentRuntimeRoutes } = await import('./agent-runtimes')
    const { AppError } = await import('@/lib/errors')
    const app = new Hono<{ Variables: import('@/middleware/auth').TeamAuthVariables }>()

    app.use('*', async (c, next) => {
      c.set('teamRole', role)
      c.set('teamId', 'another-team')
      c.set('userId', 'viewer')
      await next()
    })
    app.onError((error, c) =>
      c.json({ error: error.message }, error instanceof AppError ? error.status : 500),
    )
    registerAgentRuntimeRoutes(app)
    const result = await app.request('/agent-runtimes/runtime-id/update', { method: 'POST' })

    expect(result.status).toBe(403)
  },
)
