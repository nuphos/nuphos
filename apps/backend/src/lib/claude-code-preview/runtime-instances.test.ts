import { randomBytes } from 'node:crypto'

import { OPENAB_PROVIDERS } from './runtime-provider'
import { afterAll, beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'

import {
  publishedRuntimeImage,
  publishRuntimeRelease,
  restoreRuntimeReleases,
} from './runtime-release-testing'

import { config } from '@/config'
import { AppError } from '@/lib/errors'
import { useDb } from '@/lib/test/doubles/db'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { OpenAbProvider } from './runtime-provider'

const previousKey = config.claudeCodePreview.tokenEncryptionKey
const FLEET_VERSION = '0.3.1'

config.claudeCodePreview.tokenEncryptionKey = randomBytes(32).toString('base64')
afterAll(() => {
  config.claudeCodePreview.tokenEncryptionKey = previousKey
  restoreRuntimeReleases()
})

let store = portabilityDb()

useDb({ db: () => ({ collection: (name: string) => store.collection(name) }) })
const { registerAgentRuntimeRoutes } = await import('@/routes/teams/agent-runtimes')
const { listRuntimeInstances, requireRuntimeInstance } = await import('./runtime-catalog')
const { resolveTeamRuntimeEndpoints } = await import('./runtime-registry')
const { createManagedRuntimeInstance } = await import('./runtime-instances')

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
// Seed a runtime that predates retirement without reopening the HTTP creation path.
async function existing(label: string, provider: OpenAbProvider = 'codex') {
  return createManagedRuntimeInstance({ teamId: 'one', userId: 'admin', label, provider })
}
const runtimeRows = () => store.rows('claude_code_runtimes')

beforeEach(async () => {
  store = portabilityDb()
  await publishRuntimeRelease({ version: FLEET_VERSION })
})

test('an existing managed runtime keeps its row but no longer resolves', async () => {
  for (const provider of OPENAB_PROVIDERS) {
    const created = await existing(`${provider} work`, provider)
    const row = runtimeRows().find((doc) => doc._id === created.id)!

    expect(created).toMatchObject({
      kind: 'managed',
      image: publishedRuntimeImage(FLEET_VERSION, provider),
    })
    expect(row).toMatchObject({ hostedBy: 'nuphos', provider, status: 'active' })
    expect(row.url).toMatch(
      new RegExp(
        `^ws://openab-[a-z]+-[0-9a-f]{24}\\.${config.claudeCodeRuntimeProvisioner.namespace}\\.svc:8080/acp$`,
      ),
    )
    expect(await resolveTeamRuntimeEndpoints('one', undefined, provider)).toEqual([])
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
  expect(await resolveTeamRuntimeEndpoints('one', undefined, 'codex')).toEqual([])
})
