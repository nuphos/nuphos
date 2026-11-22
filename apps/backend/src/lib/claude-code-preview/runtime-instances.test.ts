import { randomBytes, randomUUID } from 'node:crypto'

import { afterAll, beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { config } from '@/config'
import { AppError } from '@/lib/errors'
import { useDb } from '@/lib/test/doubles/db'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { OpenAbProvider } from './runtime-provider'

const previousKey = config.claudeCodePreview.tokenEncryptionKey

config.claudeCodePreview.tokenEncryptionKey = randomBytes(32).toString('base64')
afterAll(() => {
  config.claudeCodePreview.tokenEncryptionKey = previousKey
})

let store = portabilityDb()

useDb({ db: () => ({ collection: (name: string) => store.collection(name) }) })
const { registerAgentRuntimeRoutes } = await import('@/routes/teams/agent-runtimes')
const { listRuntimeInstances, requireRuntimeInstance } = await import('./runtime-catalog')
const { registerTeamRuntime } = await import('./runtime-registry')

function app(teamId = 'one', role: TeamAuthVariables['teamRole'] = 'ADMINISTRATOR') {
  const app = new Hono<{ Variables: TeamAuthVariables }>()

  app.use('*', async (c, next) => {
    c.set('teamId', teamId)
    c.set('userId', 'admin')
    c.set('teamRole', role)
    await next()
  })
  app.onError((error, c) =>
    error instanceof AppError
      ? c.json({ code: error.code }, error.status)
      : c.json({ code: 'unexpected' }, 500),
  )
  registerAgentRuntimeRoutes(app)

  return app
}
function json(method: string, body: unknown) {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}
// A runtime the team connected, on the cluster's own network.
async function existing(label: string, provider: OpenAbProvider = 'codex') {
  const id = randomUUID()

  return registerTeamRuntime({
    id,
    teamId: 'one',
    userId: 'admin',
    url: `ws://openab-${provider}-${id.slice(0, 8)}.openab-runtimes.svc:8080/acp`,
    provider,
    authKey: randomBytes(32).toString('hex'),
    label,
  })
}
const runtimeRows = () => store.rows('claude_code_runtimes')

beforeEach(() => {
  store = portabilityDb()
})

test('workspace scope and administrator checks apply to each instance mutation', async () => {
  const instance = await existing('Work')

  for (const [server, status] of [
    [app('two'), 404],
    [app('one', 'EDITOR'), 403],
  ] as const) {
    expect(
      (await server.request(`/agent-runtimes/${instance.id}`, json('PATCH', { label: 'Stolen' })))
        .status,
    ).toBe(status)
    expect(
      (await server.request(`/agent-runtimes/${instance.id}`, { method: 'DELETE' })).status,
    ).toBe(status)
  }
  expect((await app('two').request(`/agent-runtimes/${instance.id}/status`)).status).toBe(404)
  expect(
    (
      await app('one', 'EDITOR').request(
        '/agent-runtimes',
        json('POST', { label: 'Extra', provider: 'codex' }),
      )
    ).status,
  ).toBe(403)
  expect((await app('one', 'EDITOR').request('/agent-runtimes')).status).toBe(200)
  await expect(requireRuntimeInstance('two', instance.id)).rejects.toMatchObject({ status: 404 })
  expect(await requireRuntimeInstance('one', instance.id)).toMatchObject({ label: 'Work' })
})

test('provider changes cannot repurpose an existing instance', async () => {
  const server = app()
  const instance = await existing('Work')

  expect(
    (
      await server.request(
        `/agent-runtimes/${instance.id}`,
        json('PATCH', { provider: 'claude-code' }),
      )
    ).status,
  ).toBe(400)
  expect(await requireRuntimeInstance('one', instance.id)).toMatchObject({ provider: 'codex' })
})

test('model discovery needs a runtime from the current workspace, not an administrator', async () => {
  const instance = await existing('Models')
  const server = app()

  await server.request(`/agent-runtimes/${instance.id}`, json('PATCH', { status: 'disabled' }))

  // Any member reaches the runtime check; a disabled runtime runs no pod to probe.
  expect(
    (await app('one', 'EDITOR').request(`/agent-runtimes/${instance.id}/model-config`)).status,
  ).toBe(409)
  expect((await app('two').request(`/agent-runtimes/${instance.id}/models`)).status).toBe(404)
  // A disabled runtime runs no pod to probe.
  expect((await server.request(`/agent-runtimes/${instance.id}/models`)).status).toBe(409)
})

test('creation stays retired and leaves existing runtime records untouched', async () => {
  const runtime = await existing('Existing')
  const before = JSON.stringify(runtimeRows())

  const response = await app().request('/agent-runtimes', json('POST', { provider: 'codex' }))

  expect(response.status).toBe(410)
  expect(await response.json()).toEqual({ code: 'managed_runtime_retired' })
  expect(JSON.stringify(runtimeRows())).toBe(before)
  expect(await requireRuntimeInstance('one', runtime.id)).toMatchObject({ kind: 'external' })
  expect((await app().request('/agent-runtimes')).status).toBe(200)
})

// #2401: a conversation still pointing at a runtime whose record was deleted.
test('a runtime whose record is gone answers runtime_not_found, not an error', async () => {
  const gone = await existing('Deleted')

  store.rows('claude_code_runtimes').splice(
    runtimeRows().findIndex((doc) => doc._id === gone.id),
    1,
  )

  await expect(requireRuntimeInstance('one', gone.id)).rejects.toMatchObject({
    status: 404,
    code: 'runtime_not_found',
  })
  expect((await app().request(`/agent-runtimes/${gone.id}/status`)).status).toBe(404)
})
