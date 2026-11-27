import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { readInstances } from './agent-instances.ts'
import { InstanceControllers } from './instance-controllers.ts'

import type { LocalRuntimeControllerDeps } from './controller-types.ts'

const LOGIN = {
  'claude-code': 'claude-home/.credentials.json',
  codex: 'codex-home/auth.json',
  opencode: 'opencode-home/.local/share/opencode/auth.json',
}

// An added agent whose login is the file its CLI reads; the controller is a fake that
// records being stopped and started.
function setup(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nuphos-instance-reset-'))

  t.after(() => rmSync(root, { recursive: true, force: true }))
  const events: string[] = []
  const removedCredentials: string[] = []
  // An OpenCode 2.x whose `auth list` answers what `connections` holds, and a stop that waits
  // when held.
  const bin = path.join(root, 'bin')
  const connections = path.join(root, 'connections')
  let held: Promise<void> | undefined

  mkdirSync(bin)
  writeFileSync(connections, '[]')
  writeFileSync(
    path.join(bin, 'opencode'),
    `#!/bin/sh\nif [ "$1 $2" = "auth list" ]; then cat '${connections}'; exit 0; fi\nexit 1\n`,
    { mode: 0o700 },
  )
  const deps = {
    dataDir: () => root,
    userEnv: async () => ({ PATH: `${bin}:/usr/bin:/bin`, HOME: root }),
    // OpenCode always reports itself signed in; any other agent while its login file is there.
    probeCli: async (provider: keyof typeof LOGIN, _env: unknown, home: string) => ({
      installed: true,
      version: '2.3.0',
      loggedIn:
        provider === 'opencode' ||
        existsSync(path.join(home, LOGIN[provider].split('/').slice(1).join('/'))),
    }),
  } as unknown as LocalRuntimeControllerDeps
  const instances = new InstanceControllers(
    deps,
    (childDeps, provider) => {
      const login = path.join(
        childDeps.dataDir(),
        'users',
        'alice',
        LOGIN[provider as keyof typeof LOGIN],
      )

      // Like the real controller: shut down, it starts nothing until it is given a user again.
      let user: string | null = null

      return {
        setUser: async (userId) => {
          user = userId
          events.push('start')
        },
        shutdown: async () => {
          user = null
          await held
          events.push('stop')
        },
        whileStopped: async (_provider, work) => {
          await held
          events.push('stop')

          return work()
        },
        refresh: async () => {
          if (user) events.push('start')

          return {} as never
        },
        signedIn: async () => {},
        state: () =>
          ({
            agents: {
              [provider]: {
                cli: { installed: true, loggedIn: existsSync(login) },
              },
            },
          }) as never,
        runtime: () => null,
        runtimeForStream: () => null,
        status: () => ({ agents: {} }),
      }
    },
    () => {},
    {
      removeCredential: async (env) => {
        events.push('keychain')
        removedCredentials.push(env.CLAUDE_SECURESTORAGE_CONFIG_DIR ?? '')
      },
    },
  )
  const dirOf = (id: string) => path.join(root, 'instances', id, 'users', 'alice')
  const write = (file: string) => {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, '{}')
  }

  const hold = (until: Promise<void>) => {
    held = until
  }

  return { root, instances, events, removedCredentials, dirOf, write, connections, hold }
}

/** Created and signed in, as the backend leaves an added agent once its sign-in finished. */
async function signedIn(setupOf: ReturnType<typeof setup>, provider: keyof typeof LOGIN) {
  const agent = { instanceId: randomUUID(), provider, label: 'Work' }

  await setupOf.instances.request({ method: 'create', ...agent }, 'alice')
  setupOf.write(path.join(setupOf.dirOf(agent.instanceId), LOGIN[provider]))
  await setupOf.instances.request({ method: 'commit', instanceId: agent.instanceId }, 'alice')
  setupOf.events.splice(0)

  return agent
}

test('reset stops an added Claude, deletes its logins and Keychain entry, and keeps it', async (t) => {
  const context = setup(t)
  const { instances, events, removedCredentials, dirOf, write, root } = context

  await instances.load('alice')
  const agent = await signedIn(context, 'claude-code')
  const home = path.join(dirOf(agent.instanceId), 'claude-home')

  write(path.join(home, '.nuphos-oauth-token.json'))
  write(path.join(home, 'projects', 'session.jsonl'))
  write(path.join(dirOf(agent.instanceId), 'workspace', 'notes.md'))
  const reply = await instances.request({ method: 'reset', instanceId: agent.instanceId }, 'alice')

  assert.deepEqual(reply, { instance: { ...agent, state: 'ready' } })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(events, ['stop', 'keychain', 'start'])
  assert.deepEqual(removedCredentials, [home])
  assert.equal(existsSync(path.join(home, '.credentials.json')), false)
  assert.equal(existsSync(path.join(home, '.nuphos-oauth-token.json')), false)
  assert.equal(existsSync(path.join(home, 'projects', 'session.jsonl')), true)
  assert.equal(existsSync(path.join(dirOf(agent.instanceId), 'workspace', 'notes.md')), true)
  // The record stays, so the agent is listed signed out until it signs in again.
  assert.deepEqual(readInstances(path.join(root, 'users', 'alice')), [{ ...agent, state: 'ready' }])
  assert.equal(instances.status()[0]?.state, 'ready')
  await instances.refresh(false)
  assert.equal(instances.status().length, 1)
})

test('reset of an added Codex deletes its login and never touches the Keychain', async (t) => {
  const context = setup(t)
  const { instances, events, dirOf, write } = context

  await instances.load('alice')
  const agent = await signedIn(context, 'codex')
  const home = path.join(dirOf(agent.instanceId), 'codex-home')

  write(path.join(home, 'config.toml'))
  await instances.request({ method: 'reset', instanceId: agent.instanceId }, 'alice')
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(events, ['stop', 'start'])
  assert.equal(existsSync(path.join(home, 'auth.json')), false)
  assert.equal(existsSync(path.join(home, 'config.toml')), true)
  assert.equal(instances.status()[0]?.cli?.loggedIn, false)
})

test('reset refuses an unknown or invalid agent', async (t) => {
  const { instances } = setup(t)

  await instances.load('alice')
  await assert.rejects(
    instances.request({ method: 'reset', instanceId: randomUUID() }, 'alice'),
    /not found/u,
  )
  await assert.rejects(
    instances.request({ method: 'reset', instanceId: '../escape' }, 'alice'),
    /Invalid/u,
  )
})

test(
  'an OpenCode that still reports a provider fails the reset, and runs again',
  { skip: process.platform === 'win32' },
  async (t) => {
    const context = setup(t)
    const { instances, events, dirOf, connections } = context

    await instances.load('alice')
    const agent = await signedIn(context, 'opencode')

    // OpenCode 2.x keeps provider credentials in its database, which no file deletion reaches.
    writeFileSync(connections, JSON.stringify([{ id: 'openai', connections: [{ type: 'env' }] }]))
    await assert.rejects(
      instances.request({ method: 'reset', instanceId: agent.instanceId }, 'alice'),
      /OpenCode still holds provider credentials/,
    )
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(events, ['stop', 'start'])
    assert.equal(existsSync(path.join(dirOf(agent.instanceId), LOGIN.opencode)), false)
  },
)

test('an agent removed while its reset stops it is not started again', async (t) => {
  const context = setup(t)
  const { instances, events, dirOf, hold } = context

  await instances.load('alice')
  const agent = await signedIn(context, 'codex')
  let resolveStop = () => {}

  hold(
    new Promise<void>((resolve) => {
      resolveStop = resolve
    }),
  )
  const reset = instances.request({ method: 'reset', instanceId: agent.instanceId }, 'alice')
  const removed = instances.request({ method: 'remove', instanceId: agent.instanceId }, 'alice')

  resolveStop()
  await removed
  await assert.rejects(reset, /Runtime instance not found/)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(events.includes('start'), false)
  assert.equal(existsSync(dirOf(agent.instanceId)), false)
  assert.equal(instances.status().length, 0)
})

test('an added agent shut down during its reset stays stopped', async (t) => {
  const context = setup(t)
  const { instances, events, hold } = context

  await instances.load('alice')
  const agent = await signedIn(context, 'codex')
  let resolveStop = () => {}

  hold(
    new Promise<void>((resolve) => {
      resolveStop = resolve
    }),
  )
  const reset = instances.request({ method: 'reset', instanceId: agent.instanceId }, 'alice')
  const shutdown = instances.shutdown()

  resolveStop()
  await Promise.all([reset, shutdown])
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(events.includes('start'), false)
})
