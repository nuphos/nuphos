import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { prepareAgentHome } from './agent-home.ts'
import { LocalRuntimeController } from './controller.ts'

import type { LocalRuntimeControllerDeps } from './controller-types.ts'

// A Box whose default agents are signed in: Claude in its own home, Codex through the
// link to the Box user's ~/.codex/auth.json.
function box(t: { after: (fn: () => void) => void }, ownsMachine: boolean) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nuphos-default-remove-'))
  const owner = path.join(root, 'home', '.codex')
  const env = { PATH: '/mock', HOME: path.join(root, 'home') }
  const claudeLogin = path.join(root, 'users', 'alice', 'claude-home', '.credentials.json')

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
    probeModels: async () => ({ models: [], defaultModel: '', controls: {} }),
    createProcess: () => ({
      start: async () => ({ port: 1, authKey: 'mock', controlKey: 'mock' }),
      stop: async () => {},
      onExit: () => () => {},
    }),
    createTunnel: () => ({ start() {}, stop() {}, sendStatus() {}, reconnectNow() {} }),
  }
  const start = async () => {
    const controller = new LocalRuntimeController(deps)

    t.after(() => controller.shutdown())
    await controller.setUser('alice')

    return controller
  }
  const signedIn = (controller: LocalRuntimeController) =>
    Object.fromEntries(
      Object.entries(controller.state().agents).map(([provider, agent]) => [
        provider,
        agent.cli?.installed === true && agent.cli.loggedIn,
      ]),
    )

  return { start, signedIn, owner }
}

test('a Box removes its default agents for good, also across a restart', async (t) => {
  const { start, signedIn, owner } = box(t, true)
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
  const { start, signedIn, owner } = box(t, false)
  const controller = await start()

  await assert.rejects(
    controller.instanceRequest({ method: 'remove', provider: 'codex' }),
    /Only a Box/u,
  )
  assert.equal(existsSync(path.join(owner, 'auth.json')), true)
  assert.deepEqual(signedIn(controller), { 'claude-code': true, codex: true })
})

test('removing names a known provider', async (t) => {
  const { start } = box(t, true)
  const controller = await start()

  await assert.rejects(
    controller.instanceRequest({ method: 'remove', provider: '../x' }),
    /Invalid agent provider/u,
  )
})
