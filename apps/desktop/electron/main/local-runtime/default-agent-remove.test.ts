import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { prepareAgentHome } from './agent-home.ts'
import { LocalRuntimeController } from './controller.ts'
import { ownsMachine } from './device-credential.ts'
import { withHostProvider } from './host-provider.ts'

import type { LocalRuntimeControllerDeps } from './controller-types.ts'

// A Box whose default agents are signed in: Claude in its own home, Codex through the
// link to the Box user's ~/.codex/auth.json.
function box(
  t: { after: (fn: () => void) => void },
  ownsMachine: boolean,
  wrap = (deps: LocalRuntimeControllerDeps) => deps,
) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nuphos-default-remove-'))
  const owner = path.join(root, 'home', '.codex')
  const env = { PATH: '/mock', HOME: path.join(root, 'home') }
  const claudeLogin = path.join(root, 'users', 'alice', 'claude-home', '.credentials.json')
  let stops = 0
  // Whether Claude's login was there as each agent process started.
  const startedSignedIn: boolean[] = []
  // A stop, or a model read, waits on these while they are set.
  const hold: { stop?: Promise<void>; probe?: Promise<void> } = {}

  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(owner, { recursive: true })
  writeFileSync(path.join(owner, 'auth.json'), '{}')
  mkdirSync(path.dirname(claudeLogin), { recursive: true })
  writeFileSync(claudeLogin, '{}')
  const adapter = { entry: '/mock/adapter', bridge: '/mock/bridge', version: '1' }
  const deps: LocalRuntimeControllerDeps = {
    ownsMachine,
    bundle: () => ({
      root: '/mock',
      openab: '/mock/openab',
      adapters: { codex: adapter, 'claude-code': adapter },
    }),
    dataDir: () => root,
    nodeExecPath: '/mock/node',
    backendUrl: 'https://example.test',
    userEnv: async () => env,
    // Signed in when the CLI's login file is there (a dangling link is not).
    probeCli: async (provider, _env, home) => ({
      installed: true,
      loggedIn: Boolean(
        home &&
        existsSync(path.join(home, provider === 'codex' ? 'auth.json' : '.credentials.json')),
      ),
      path: `/mock/${provider}`,
    }),
    readUsage: async () => undefined,
    readCliCache: () => ({}),
    writeCliCache() {},
    prepareAgentHome,
    registerDevice: async () => {},
    probeModels: async ({ provider }) => {
      // A read runs the agent's CLI, which can save its refreshed login as it exits.
      if (hold.probe && provider === 'claude-code') {
        await hold.probe
        writeFileSync(claudeLogin, '{}')
      }

      return { models: [], defaultModel: '', controls: {} }
    },
    createProcess: () => ({
      start: async () => {
        startedSignedIn.push(existsSync(claudeLogin))

        return { port: 1, authKey: 'mock', controlKey: 'mock' }
      },
      stop: async () => {
        await hold.stop
        stops += 1
      },
      onExit: () => () => {},
    }),
    createTunnel: () => ({ start() {}, stop() {}, sendStatus() {}, reconnectNow() {} }),
  }
  const start = async () => {
    const controller = new LocalRuntimeController(wrap(deps))

    t.after(() => controller.shutdown())
    await controller.setUser('alice')

    return controller
  }
  // Grok Build and OpenCode, never signed in here, stay out of the comparisons.
  const signedIn = (controller: LocalRuntimeController) =>
    Object.fromEntries(
      Object.entries(controller.state().agents)
        .filter(([provider]) => provider === 'claude-code' || provider === 'codex')
        .map(([provider, agent]) => [
          provider,
          agent.cli?.installed === true && agent.cli.loggedIn,
        ]),
    )

  return {
    start,
    signedIn,
    owner,
    claudeHome: path.dirname(claudeLogin),
    claudeLogin,
    stops: () => stops,
    startedSignedIn,
    hold,
  }
}

test('a Box removes its default agents for good, also across a restart', async (t) => {
  const joined = {
    apiUrl: 'https://x',
    userId: 'alice',
    deviceId: 'b',
    credential: 'c',
    box: true as const,
  }
  const { start, signedIn, owner } = box(t, ownsMachine(joined))
  const controller = await start()

  assert.deepEqual(signedIn(controller), { 'claude-code': true, codex: true })
  for (const provider of ['claude-code', 'codex'])
    assert.deepEqual(await controller.instanceRequest({ method: 'remove', provider }), {})
  assert.deepEqual(signedIn(controller), { 'claude-code': false, codex: false })
  // The Codex login the home linked to is gone too, so the next launch cannot re-link it.
  assert.equal(existsSync(path.join(owner, 'auth.json')), false)
  await controller.shutdown()
  assert.deepEqual(signedIn(await start()), { 'claude-code': false, codex: false })
})

test('a person’s computer never removes a default agent or touches its login', async (t) => {
  // Joined with a token of its own, it holds a credential, but the backend never said Box.
  const joined = {
    apiUrl: 'https://example.test',
    userId: 'alice',
    deviceId: 'mac',
    credential: 'nbx_x',
  }
  const { start, signedIn, owner } = box(t, ownsMachine(joined))
  const controller = await start()

  await assert.rejects(
    controller.instanceRequest({ method: 'remove', provider: 'codex' }),
    /Only a computer from Nuphos/u,
  )
  assert.equal(existsSync(path.join(owner, 'auth.json')), true)
  assert.deepEqual(signedIn(controller), { 'claude-code': true, codex: true })
})

test('a finished sign-in of a default agent is checked at once, not at the next poll', async (t) => {
  const { start, signedIn, owner } = box(t, false)

  rmSync(path.join(owner, 'auth.json'))
  const controller = await start()

  assert.equal(signedIn(controller).codex, false)
  // The sign-in writes the login; the host only learns of it from the commit.
  writeFileSync(path.join(owner, 'auth.json'), '{}')
  assert.deepEqual(await controller.instanceRequest({ method: 'commit', provider: 'codex' }), {})
  assert.equal(signedIn(controller).codex, true)
  await assert.rejects(
    controller.instanceRequest({ method: 'commit', provider: '../x' }),
    /Invalid runtime provider/u,
  )
})

test('removing names a known provider', async (t) => {
  const { start } = box(t, true)
  const controller = await start()

  await assert.rejects(
    controller.instanceRequest({ method: 'remove', provider: '../x' }),
    /Invalid runtime provider/u,
  )
})

test('AGY removal cannot pretend deleting its home signs out the native keyring', async () => {
  const { removeDefaultAgent } = await import('./default-agent.ts')
  let touched = false

  await assert.rejects(
    removeDefaultAgent(
      {
        ownsMachine: true,
        userEnv: async () => {
          touched = true

          return {}
        },
      } as never,
      'alice',
      'antigravity',
      async () => {
        touched = true
      },
    ),
    /official Antigravity CLI/,
  )
  assert.equal(touched, false)
})

test('a Box resets a default agent: it is stopped and its logins go, its sessions stay', async (t) => {
  const { start, signedIn, owner, claudeHome, stops } = box(t, true)
  const session = path.join(claudeHome, 'projects', 'work', 'session.jsonl')
  const controller = await start()

  mkdirSync(path.dirname(session), { recursive: true })
  writeFileSync(session, '{}\n')
  writeFileSync(path.join(owner, 'config.toml'), '')
  const before = stops()

  for (const provider of ['claude-code', 'codex'])
    assert.deepEqual(await controller.instanceRequest({ method: 'reset', provider }), {})
  assert.equal(stops() - before, 2)
  assert.deepEqual(signedIn(controller), { 'claude-code': false, codex: false })
  assert.equal(existsSync(path.join(owner, 'auth.json')), false)
  assert.equal(existsSync(path.join(owner, 'config.toml')), true)
  assert.equal(existsSync(session), true)
  assert.equal(existsSync(path.join(claudeHome, 'settings.json')), true)
  await controller.shutdown()
  const restarted = await start()

  assert.deepEqual(signedIn(restarted), { 'claude-code': false, codex: false })
  await assert.rejects(
    restarted.instanceRequest({ method: 'reset', provider: 'antigravity' }),
    /official Antigravity CLI/u,
  )
})

test('a person’s computer never resets a default agent or touches its login', async (t) => {
  const { start, signedIn, owner, stops } = box(t, false)
  const controller = await start()
  const before = stops()

  await assert.rejects(
    controller.instanceRequest({ method: 'reset', provider: 'claude-code' }),
    /Only a computer from Nuphos/u,
  )
  assert.equal(stops(), before)
  assert.equal(existsSync(path.join(owner, 'auth.json')), true)
  assert.deepEqual(signedIn(controller), { 'claude-code': true, codex: true })
})

/** A promise and the function that settles it. */
function gate() {
  let open = () => {}
  const until = new Promise<void>((resolve) => {
    open = resolve
  })

  return { until, open }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 10))

test('a default agent shut down during its reset stays stopped', async (t) => {
  const { start, startedSignedIn, hold } = box(t, true)
  const controller = await start()
  const stop = gate()

  hold.stop = stop.until
  const reset = controller.instanceRequest({ method: 'reset', provider: 'claude-code' })

  await tick()
  const shutdown = controller.shutdown()

  startedSignedIn.length = 0
  hold.stop = undefined
  stop.open()
  await Promise.all([reset, shutdown])
  await tick()
  assert.deepEqual(startedSignedIn, [])
})

test('a refresh during a reset starts the agent only once its login is gone', async (t) => {
  const { start, signedIn, startedSignedIn, hold } = box(t, true)
  const controller = await start()
  const stop = gate()

  hold.stop = stop.until
  startedSignedIn.length = 0
  const reset = controller.instanceRequest({ method: 'reset', provider: 'claude-code' })

  await tick()
  const refreshed = controller.refresh()

  await tick()
  hold.stop = undefined
  stop.open()
  assert.deepEqual(await reset, {})
  await refreshed
  assert.equal(startedSignedIn.includes(true), false)
  assert.equal(signedIn(controller)['claude-code'], false)
})

test('a reset waits for a running model read, which can save the login again', async (t) => {
  const { hold, start, claudeLogin } = box(t, true)
  const probe = gate()

  hold.probe = probe.until
  const controller = await start()
  const reset = controller.instanceRequest({ method: 'reset', provider: 'claude-code' })

  await tick()
  probe.open()
  assert.deepEqual(await reset, {})
  await tick()
  assert.equal(existsSync(claudeLogin), false)
})

test('a reset fails while a key from the computer keeps the agent signed in', async (t) => {
  const { start, claudeLogin } = box(t, true, (deps) =>
    withHostProvider({ ANTHROPIC_API_KEY: 'k' }, deps, () => {}),
  )
  const controller = await start()

  await assert.rejects(
    controller.instanceRequest({ method: 'reset', provider: 'claude-code' }),
    /still signed in/u,
  )
  // Its own login goes all the same.
  assert.equal(existsSync(claudeLogin), false)
})
