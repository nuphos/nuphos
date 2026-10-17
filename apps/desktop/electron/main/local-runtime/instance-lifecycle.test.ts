import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { readInstances, writeInstances } from './agent-instances.ts'
import { InstanceControllers, PENDING_TTL_MS } from './instance-controllers.ts'

import type { AgentInstanceRecord } from './agent-instances.ts'
import type { LocalRuntimeControllerDeps } from './controller-types.ts'

type Fake = {
  loggedIn: boolean | null
  started: boolean
  stopped: boolean
  restarts: boolean[]
  release?: () => void
}

function setup(t: { after: (fn: () => void) => void }, options: { slowStart?: boolean } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nuphos-instance-lifecycle-'))

  t.after(() => rmSync(root, { recursive: true, force: true }))
  const fakes = new Map<string, Fake>()
  const removedCredentials: string[] = []
  let now = Date.parse('2026-10-15T00:00:00Z')
  const deps = {
    dataDir: () => root,
    userEnv: async () => ({}),
  } as unknown as LocalRuntimeControllerDeps
  const instances = new InstanceControllers(
    deps,
    (childDeps, provider) => {
      const fake: Fake = { loggedIn: false, started: false, stopped: false, restarts: [] }

      fakes.set(childDeps.dataDir(), fake)

      return {
        setUser: () =>
          options.slowStart
            ? new Promise<void>((resolve) => {
                fake.release = () => {
                  fake.started = true
                  resolve()
                }
              })
            : Promise.resolve().then(() => {
                fake.started = true
              }),
        shutdown: async () => {
          fake.stopped = true
        },
        refresh: async (restart: boolean) => {
          fake.restarts.push(restart)

          return {} as never
        },
        state: () =>
          ({
            // As runtimeStateOf derives it, under the instance's own data dir.
            workspace: path.join(childDeps.dataDir(), 'users', 'alice', 'workspace'),
            agents: {
              [provider]: {
                cli: { installed: true, loggedIn: fake.loggedIn, path: '/mock' },
              },
            },
          }) as never,
        runtime: () => null,
        status: () => ({ agents: {} }),
      }
    },
    () => {},
    {
      now: () => now,
      removeCredential: async (env) => {
        removedCredentials.push(env.CLAUDE_SECURESTORAGE_CONFIG_DIR ?? '')
      },
    },
  )
  const dirOf = (id: string) => path.join(root, 'instances', id)
  const fakeOf = (id: string) => fakes.get(dirOf(id))!
  const inventory = () => readInstances(path.join(root, 'users', 'alice'))

  return {
    root,
    instances,
    dirOf,
    fakeOf,
    inventory,
    removedCredentials,
    advance: (ms: number) => {
      now += ms
    },
  }
}

const claude = () => ({
  instanceId: randomUUID(),
  provider: 'claude-code' as const,
  label: 'Claude',
})

test('create answers before the agent starts, and a pending agent is reported as pending', async (t) => {
  const { instances, fakeOf, inventory } = setup(t, { slowStart: true })

  await instances.load('alice')
  const agent = claude()
  const reply = (await instances.request({ method: 'create', ...agent }, 'alice')) as {
    instance: { state: string }
  }

  assert.equal(reply.instance.state, 'pending')
  assert.equal(fakeOf(agent.instanceId).started, false)
  assert.equal(instances.status()[0]?.state, 'pending')
  assert.equal(inventory()[0]?.state, 'pending')
  fakeOf(agent.instanceId).release!()
})

test('commit keeps a signed-in agent and refuses one that is not signed in', async (t) => {
  const { instances, fakeOf, inventory } = setup(t)

  await instances.load('alice')
  const agent = claude()

  await instances.request({ method: 'create', ...agent }, 'alice')
  await assert.rejects(
    instances.request({ method: 'commit', instanceId: agent.instanceId }, 'alice'),
    /not signed in/u,
  )
  fakeOf(agent.instanceId).loggedIn = true
  await instances.request({ method: 'commit', instanceId: agent.instanceId }, 'alice')
  assert.deepEqual(inventory(), [{ ...agent, state: 'ready' }])
  assert.equal(instances.status()[0]?.state, 'ready')
})

test('a refresh that finds the agent signed in commits it without a request', async (t) => {
  const { instances, fakeOf, inventory } = setup(t)

  await instances.load('alice')
  const agent = claude()

  await instances.request({ method: 'create', ...agent }, 'alice')
  fakeOf(agent.instanceId).loggedIn = true
  await instances.refresh(false)
  assert.equal(inventory()[0]?.state, 'ready')
})

test('remove stops the agent and deletes its directory, Keychain entry and record', async (t) => {
  const { instances, fakeOf, dirOf, inventory, removedCredentials } = setup(t)

  await instances.load('alice')
  const agent = claude()

  await instances.request({ method: 'create', ...agent }, 'alice')
  mkdirSync(path.join(dirOf(agent.instanceId), 'users', 'alice'), { recursive: true })
  writeFileSync(path.join(dirOf(agent.instanceId), 'users', 'alice', 'secret'), 'x')
  await instances.request({ method: 'remove', instanceId: agent.instanceId }, 'alice')
  assert.equal(fakeOf(agent.instanceId).stopped, true)
  assert.equal(existsSync(dirOf(agent.instanceId)), false)
  assert.deepEqual(inventory(), [])
  assert.deepEqual(removedCredentials, [
    path.join(dirOf(agent.instanceId), 'users', 'alice', 'claude-home'),
  ])
  assert.equal(instances.status().length, 0)
  // Idempotent: a retried removal of a gone agent succeeds.
  assert.deepEqual(
    await instances.request({ method: 'remove', instanceId: agent.instanceId }, 'alice'),
    {},
  )
  await assert.rejects(
    instances.request({ method: 'remove', instanceId: '../escape' }, 'alice'),
    /Invalid/u,
  )
})

test('a pending sign-in left past its expiry is removed', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { instances, inventory, advance } = setup(t)

  await instances.load('alice')
  await instances.request({ method: 'create', ...claude() }, 'alice')
  advance(PENDING_TTL_MS)
  t.mock.timers.tick(PENDING_TTL_MS)
  // The expiry probes, then removes; let those promises run.
  for (let i = 0; i < 10; i++) await new Promise<void>((resolve) => setImmediate(resolve))
  assert.deepEqual(inventory(), [])
})

test('host start removes unfinished and signed-out legacy agents and keeps signed-in ones', async (t) => {
  const { root, instances, fakeOf, inventory } = setup(t)
  const pending = { ...claude(), state: 'pending' as const, createdAt: new Date().toISOString() }
  const legacyOut = claude()
  const legacyIn = claude()
  const legacyUnknown = claude()
  const ready = { ...claude(), state: 'ready' as const }
  const records: AgentInstanceRecord[] = [pending, legacyOut, legacyIn, legacyUnknown, ready]

  writeInstances(path.join(root, 'users', 'alice'), records)
  // Probe results are fixed per agent before load settles them.
  const load = instances.load('alice')

  fakeOf(legacyIn.instanceId).loggedIn = true
  fakeOf(legacyUnknown.instanceId).loggedIn = null
  fakeOf(ready.instanceId).loggedIn = false
  await load
  assert.deepEqual(
    inventory().map(({ instanceId, state }) => [instanceId, state]),
    [
      [legacyIn.instanceId, 'ready'],
      [legacyUnknown.instanceId, undefined],
      // A signed-in agent whose login expired stays: it signs in again.
      [ready.instanceId, 'ready'],
    ],
  )
})

test('a sign-in restarts only agents of its provider, so other turns keep running', async (t) => {
  const { instances, fakeOf } = setup(t)

  await instances.load('alice')
  const claudeAgent = claude()
  const codexAgent = { instanceId: randomUUID(), provider: 'codex' as const, label: 'Codex' }

  await instances.request({ method: 'create', ...claudeAgent }, 'alice')
  await instances.request({ method: 'create', ...codexAgent }, 'alice')
  fakeOf(claudeAgent.instanceId).restarts.length = 0
  fakeOf(codexAgent.instanceId).restarts.length = 0
  await instances.refresh(true, ['claude-code'])
  assert.deepEqual(fakeOf(claudeAgent.instanceId).restarts, [true])
  assert.deepEqual(fakeOf(codexAgent.instanceId).restarts, [false])
  // A bundle update names no provider and restarts every agent.
  await instances.refresh(true)
  assert.deepEqual(fakeOf(codexAgent.instanceId).restarts, [false, true])
})

test("an instance's files are read from its own workspace, never the default agent's", async (t) => {
  const { instances, dirOf } = setup(t)

  await instances.load('alice')
  const agent = claude()

  await instances.request({ method: 'create', ...agent }, 'alice')
  assert.equal(
    instances.workspace(agent.instanceId),
    path.join(dirOf(agent.instanceId), 'users', 'alice', 'workspace'),
  )
  assert.equal(instances.workspace(randomUUID()), null)
})
