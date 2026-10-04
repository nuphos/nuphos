import { randomBytes } from 'node:crypto'

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
const { deriveRuntimeControlKey } = await import('./runtime-control-key')

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
async function add(
  server: ReturnType<typeof app>,
  label: string,
  provider: 'claude-code' | 'codex' = 'codex',
) {
  const response = await server.request('/agent-runtimes', json('POST', { label, provider }))

  expect(response.status).toBe(201)

  return (await response.json()) as { id: string; label: string; kind: string; image: string }
}
const runtimeRows = () => store.rows('claude_code_runtimes')

beforeEach(async () => {
  store = portabilityDb()
  await publishRuntimeRelease({ version: FLEET_VERSION })
})

test('adding a managed agent registers a hosted runtime with its own generated password', async () => {
  for (const provider of ['claude-code', 'codex'] as const) {
    const created = await add(app(), `${provider} work`, provider)
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
    const [endpoint] = await resolveTeamRuntimeEndpoints('one', undefined, provider)

    expect(endpoint?.runtimeId).toBe(created.id)
    expect(endpoint?.authKey.length).toBeGreaterThanOrEqual(32)
    expect(JSON.stringify(row)).not.toContain(endpoint!.authKey)
    const [control] = await resolveTeamRuntimeEndpoints('one', undefined, provider, 'control')

    expect(control?.authKey).toBe(deriveRuntimeControlKey(endpoint!.authKey))
  }
})

test('the create route takes a name and a type, and nothing that signs the agent in', async () => {
  for (const extra of [
    { image: `registry.example/codex@sha256:${'a'.repeat(64)}` },
    { credential: `sk-ant-${'a'.repeat(40)}` },
  ])
    expect(
      (
        await app().request(
          '/agent-runtimes',
          json('POST', { label: 'Claude', provider: 'claude-code', ...extra }),
        )
      ).status,
    ).toBe(400)
  expect((await app().request('/agent-runtimes/images')).status).toBe(404)
})

test('hosted runtimes list as managed; rows of the retired provisioner model are hidden', async () => {
  const created = await add(app(), 'Hosted', 'claude-code')

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

test('rename and disable change the hosted runtime row itself', async () => {
  const server = app()
  const instance = await add(server, 'Work')

  expect(
    (
      await server.request(
        `/agent-runtimes/${instance.id}`,
        json('PATCH', { label: 'Renamed', status: 'disabled' }),
      )
    ).status,
  ).toBe(200)
  expect(await requireRuntimeInstance('one', instance.id)).toMatchObject({
    label: 'Renamed',
    status: 'disabled',
    kind: 'managed',
  })
  expect(await resolveTeamRuntimeEndpoints('one', undefined, 'codex')).toEqual([])
})

test('workspace scope and administrator checks apply to each instance mutation', async () => {
  const instance = await add(app(), 'Work')

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
  const instance = await add(server, 'Work')

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

test('defaults round-trip on creation and remain isolated across runtimes and workspaces', async () => {
  const server = app()
  const defaults = { model: 'model-a', fast: 'off' as const, effort: 'high' }
  const created = await server.request(
    '/agent-runtimes',
    json('POST', {
      label: 'Defaults',
      provider: 'codex',
      defaults,
    }),
  )

  expect(created.status).toBe(201)
  const first = (await created.json()) as { id: string; defaults: unknown }

  expect(first.defaults).toEqual(defaults)
  const second = await add(server, 'Other')

  expect((await requireRuntimeInstance('one', first.id)).defaults).toEqual(defaults)
  expect((await requireRuntimeInstance('one', second.id)).defaults).toEqual({})
  for (const [client, status] of [
    [app('two'), 404],
    [app('one', 'EDITOR'), 403],
  ] as const) {
    expect(
      (await client.request(`/agent-runtimes/${first.id}`, json('PATCH', { defaults: {} }))).status,
    ).toBe(status)
  }
  expect(
    (
      await server.request(
        `/agent-runtimes/${first.id}`,
        json('PATCH', { defaults: { fast: 'on' } }),
      )
    ).status,
  ).toBe(200)
  expect((await requireRuntimeInstance('one', first.id)).defaults).toEqual({ fast: 'on' })
  await server.request(
    `/agent-runtimes/${first.id}`,
    json('PATCH', { label: 'Renamed', status: 'disabled' }),
  )
  expect((await requireRuntimeInstance('one', first.id)).defaults).toEqual({ fast: 'on' })
  await server.request(`/agent-runtimes/${first.id}`, json('PATCH', { defaults: {} }))
  expect((await requireRuntimeInstance('one', first.id)).defaults).toEqual({})
  await server.request(`/agent-runtimes/${first.id}`, { method: 'DELETE' })
  // Defaults and credentials survive until the deletion worker verifies storage cleanup.
  expect(store.rows('agent_runtime_defaults')).toHaveLength(1)
  expect(store.rows('agent_runtime_deletions')).toMatchObject([
    { _id: first.id, placements: [{ id: first.id, state: 'pending' }] },
  ])
})

test('defaults reject invalid values and permission controls', async () => {
  const server = app()
  const instance = await add(server, 'Work')

  for (const defaults of [
    null,
    [],
    { fast: true },
    { fast: 'auto' },
    { model: ' ' },
    { effort: '' },
    { model: 'm'.repeat(501) },
    { effort: 'e'.repeat(101) },
    { mode: 'agent-full-access' },
  ]) {
    expect(
      (await server.request(`/agent-runtimes/${instance.id}`, json('PATCH', { defaults }))).status,
    ).toBe(400)
  }
  const updated = await server.request(
    `/agent-runtimes/${instance.id}`,
    json('PATCH', { defaults: { model: ' model-a ', effort: ' high ' } }),
  )

  expect(updated.status).toBe(200)
  expect(await updated.json()).toMatchObject({ defaults: { model: 'model-a', effort: 'high' } })
})

test('external runtimes store defaults without changing their endpoint or credentials', async () => {
  runtimeRows().push({
    _id: 'external',
    teamId: 'one',
    url: 'wss://external.invalid/acp',
    provider: 'claude-code',
    status: 'active',
    createdAt: new Date(),
    createdByUserId: 'admin',
  })
  const server = app()
  const response = await server.request(
    '/agent-runtimes/external',
    json('PATCH', { defaults: { model: 'claude-model', fast: 'on' } }),
  )

  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    kind: 'external',
    defaults: { model: 'claude-model', fast: 'on' },
  })
  expect(runtimeRows()[0]?.url).toBe('wss://external.invalid/acp')
})

test('development runtime defaults are workspace-scoped while endpoint management stays read-only', async () => {
  const previous = config.claudeCodePreview.developmentRuntimeEndpoint

  config.claudeCodePreview.developmentRuntimeEndpoint = {
    url: 'ws://localhost:9999/acp',
    authKey: 'fixture',
  }
  try {
    const path = '/agent-runtimes/development-claude-code'
    const response = await app().request(path, json('PATCH', { defaults: { fast: 'off' } }))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ kind: 'development', defaults: { fast: 'off' } })
    expect((await requireRuntimeInstance('two', 'development-claude-code')).defaults).toEqual({})
    expect(
      (await app().request(path, json('PATCH', { label: 'Changed', defaults: {} }))).status,
    ).toBe(400)
    expect((await requireRuntimeInstance('one', 'development-claude-code')).defaults).toEqual({
      fast: 'off',
    })
    expect((await app('one', 'EDITOR').request(path, json('PATCH', { defaults: {} }))).status).toBe(
      403,
    )
  } finally {
    config.claudeCodePreview.developmentRuntimeEndpoint = previous
  }
})

test('model discovery requires an administrator and a runtime from the current workspace', async () => {
  const instance = await add(app(), 'Models')
  const server = app()

  await server.request(`/agent-runtimes/${instance.id}`, json('PATCH', { status: 'disabled' }))

  expect((await app('one', 'EDITOR').request(`/agent-runtimes/${instance.id}/models`)).status).toBe(
    403,
  )
  expect((await app('two').request(`/agent-runtimes/${instance.id}/models`)).status).toBe(404)
  // A disabled runtime runs no pod to probe.
  expect((await server.request(`/agent-runtimes/${instance.id}/models`)).status).toBe(409)
})

test('a managed agent can be added by type alone and gets a name unique in its team', async () => {
  const server = app()
  const add = async () =>
    (await (
      await server.request('/agent-runtimes', json('POST', { provider: 'codex' }))
    ).json()) as { label: string; kind: string }

  expect(await add()).toMatchObject({ label: 'Codex', kind: 'managed' })
  expect((await add()).label).toBe('Codex 2')
})
