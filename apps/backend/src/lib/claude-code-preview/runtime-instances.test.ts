import { randomBytes, randomUUID } from 'node:crypto'

import { IMAGE_PROVIDERS } from './runtime-provider'
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
const { registerTeamRuntime, resolveTeamRuntimeEndpoints } = await import('./runtime-registry')

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
// A runtime Nuphos hosted before retirement, as its row was stored.
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
    hostedBy: 'nuphos',
  })
}
const runtimeRows = () => store.rows('claude_code_runtimes')

beforeEach(() => {
  store = portabilityDb()
})

test('an existing managed runtime keeps its row but no longer resolves', async () => {
  for (const provider of IMAGE_PROVIDERS) {
    const created = await existing(`${provider} work`, provider)
    const row = runtimeRows().find((doc) => doc._id === created.id)!

    expect(row).toMatchObject({ hostedBy: 'nuphos', provider, status: 'active' })
    expect(await resolveTeamRuntimeEndpoints('one', provider)).toEqual([])
  }
})

test('hosted runtimes list as managed; rows of the retired provisioner model are hidden', async () => {
  const created = await existing('Hosted', 'claude-code')

  runtimeRows().push({
    _id: 'legacy',
    teamId: 'one',
    url: 'ws://openab-team-one.openab-runtimes.svc:8080/acp',
    provider: 'claude-code',
    status: 'active',
    managedBy: 'provisioner',
    createdByUserId: 'provisioner',
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  const instances = await listRuntimeInstances('one')

  expect(instances.map((instance) => [instance.id, instance.kind])).toEqual([
    [created.id, 'managed'],
  ])
})

test('a retired managed runtime lists as disabled and refuses status, update and patch', async () => {
  const server = app()
  const instance = await existing('Work')

  expect(await requireRuntimeInstance('one', instance.id)).toMatchObject({
    status: 'disabled',
    kind: 'managed',
  })
  for (const [path, init] of [
    [`/agent-runtimes/${instance.id}/status`, undefined],
    [`/agent-runtimes/${instance.id}/update`, json('POST', {})],
    [`/agent-runtimes/${instance.id}`, json('PATCH', { status: 'active' })],
  ] as const) {
    const response = await server.request(path, init)

    expect(response.status).toBe(410)
    expect(await response.json()).toEqual({ code: 'managed_runtime_retired' })
  }
  expect(runtimeRows().find((doc) => doc._id === instance.id)).toMatchObject({ label: 'Work' })
})

test('deleting a retired managed runtime removes it the way an external one goes', async () => {
  const server = app()
  const instance = await existing('Retired')
  const external = await registerTeamRuntime({
    teamId: 'one',
    userId: 'admin',
    url: 'wss://own.example/acp',
    authKey: randomBytes(32).toString('hex'),
  })
  const device = { userId: 'admin', deviceId: 'pod-device' }

  runtimeRows().find((doc) => doc._id === instance.id)!.device = device
  store.rows('agent_devices').push({ ...device })
  store.rows('agent_device_join_tokens').push({ deviceId: device.deviceId })
  // A teardown job the retired Kubernetes cleanup never finished.
  store.rows('agent_runtime_deletions').push({ _id: instance.id, teamId: 'one', placements: [] })

  for (const id of [instance.id, external.id]) {
    const response = await server.request(`/agent-runtimes/${id}`, { method: 'DELETE' })

    expect(response.status).toBe(204)
  }
  expect(runtimeRows()).toEqual([])
  expect(store.rows('agent_runtime_deletions')).toEqual([])
  expect(store.rows('agent_devices')).toEqual([])
  expect(store.rows('agent_device_join_tokens')).toEqual([])
  expect(await listRuntimeInstances('one')).toEqual([])
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

test('retired creation leaves existing runtime records and routes untouched', async () => {
  const runtime = await existing('Existing')
  const before = JSON.stringify(runtimeRows())

  const response = await app().request('/agent-runtimes', json('POST', { provider: 'codex' }))

  expect(response.status).toBe(410)
  expect(await response.json()).toEqual({ code: 'managed_runtime_retired' })
  expect(JSON.stringify(runtimeRows())).toBe(before)
  expect(await requireRuntimeInstance('one', runtime.id)).toMatchObject({ kind: 'managed' })
  expect((await app().request('/agent-runtimes')).status).toBe(200)
  expect(await resolveTeamRuntimeEndpoints('one', 'codex')).toEqual([])
})
