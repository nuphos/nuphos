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
  provider: OpenAbProvider = 'codex',
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
  for (const provider of OPENAB_PROVIDERS) {
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

test('model discovery needs a runtime from the current workspace, not an administrator', async () => {
  const instance = await add(app(), 'Models')
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

test('a managed agent can be added by type alone and gets a name unique in its team', async () => {
  const server = app()
  const add = async () =>
    (await (
      await server.request('/agent-runtimes', json('POST', { provider: 'codex' }))
    ).json()) as { label: string; kind: string }

  expect(await add()).toMatchObject({ label: 'Codex', kind: 'managed' })
  expect((await add()).label).toBe('Codex 2')
})
