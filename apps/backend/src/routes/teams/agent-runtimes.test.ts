import { describe, expect, test } from 'bun:test'

import { probeSchema } from './agent-runtimes'

import type { TeamAuthVariables } from '@/middleware/auth'

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
    const app = new Hono<{ Variables: TeamAuthVariables }>()

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

test("a computer's agent is not changed or removed as a team runtime", async () => {
  const { Hono } = await import('hono')
  const { registerAgentRuntimeRoutes } = await import('./agent-runtimes')
  const { AppError } = await import('@/lib/errors')
  const app = new Hono<{ Variables: TeamAuthVariables }>()

  app.use('*', async (c, next) => {
    c.set('teamRole', 'ADMINISTRATOR')
    c.set('teamId', 'team')
    c.set('userId', 'admin')
    await next()
  })
  app.onError((error, c) =>
    c.json(
      { code: error instanceof AppError ? error.code : 'unknown' },
      error instanceof AppError ? error.status : 500,
    ),
  )
  registerAgentRuntimeRoutes(app)
  const local = '/agent-runtimes/local_owner_box_codex'

  for (const init of [
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'disabled' }),
    },
    { method: 'DELETE' },
  ]) {
    const result = await app.request(local, init)

    expect(result.status).toBe(400)
    expect(await result.json()).toEqual({ code: 'local_agent_not_team_runtime' })
  }
})

test.each(['claude-code', 'codex', 'grok', 'antigravity', 'opencode'])(
  'legacy %s creation returns a stable retirement error',
  async (provider) => {
    const { Hono } = await import('hono')
    const { registerAgentRuntimeRoutes } = await import('./agent-runtimes')
    const { AppError } = await import('@/lib/errors')
    const app = new Hono<{ Variables: TeamAuthVariables }>()

    app.use('*', async (c, next) => {
      c.set('teamRole', 'ADMINISTRATOR')
      c.set('teamId', 'team')
      c.set('userId', 'admin')
      await next()
    })
    app.onError((error, c) =>
      c.json(
        { code: error instanceof AppError ? error.code : 'unknown', message: error.message },
        error instanceof AppError ? error.status : 500,
      ),
    )
    registerAgentRuntimeRoutes(app)
    for (const body of [JSON.stringify({ provider, label: 'Legacy runtime' }), 'invalid json']) {
      const response = await app.request('/agent-runtimes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })

      expect(response.status).toBe(410)
      expect(await response.json()).toEqual({
        code: 'managed_runtime_retired',
        message:
          'Managed runtimes are being retired. Add a Nuphos Box or connect your own computer instead.',
      })
    }
  },
)
