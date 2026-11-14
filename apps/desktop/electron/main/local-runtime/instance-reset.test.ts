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
}

// An added agent whose login is the file its CLI reads; the controller is a fake that
// records being stopped and started.
function setup(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nuphos-instance-reset-'))

  t.after(() => rmSync(root, { recursive: true, force: true }))
  const events: string[] = []
  const removedCredentials: string[] = []
  const deps = {
    dataDir: () => root,
    userEnv: async () => ({}),
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

      return {
        setUser: async () => {
          events.push('start')
        },
        shutdown: async () => {
          events.push('stop')
        },
        refresh: async () => ({}) as never,
        state: () =>
          ({
            agents: {
              [provider]: {
                cli: { installed: true, loggedIn: existsSync(login) },
              },
            },
          }) as never,
        runtime: () => null,
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

  return { root, instances, events, removedCredentials, dirOf, write }
}

/** Created and signed in, as the backend leaves an added agent once its sign-in finished. */
async function signedIn(setupOf: ReturnType<typeof setup>, provider: 'claude-code' | 'codex') {
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
