import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { LocalRuntimeController } from './controller.ts'

import type { LocalRuntimeControllerDeps } from './controller-types.ts'

// A CLI that lists models signed out, as OpenCode lists its free ones, never looks signed
// out: only the sign-in's commit tells the host to read the provider just signed in to.
test('a finished sign-in reads the models of the agent it signed in, own or added', async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nuphos-models-sign-in-'))

  t.after(() => rmSync(root, { recursive: true, force: true }))
  // Each read: the agent home it read and whether that home held the sign-in by then.
  const reads: { home: string; signedIn: boolean }[] = []
  const adapter = { entry: '/mock/adapter', bridge: '/mock/bridge', version: '1' }
  const deps: LocalRuntimeControllerDeps = {
    bundle: () => ({ root: '/mock', openab: '/mock/openab', adapters: { codex: adapter } }),
    dataDir: () => root,
    nodeExecPath: '/mock/node',
    backendUrl: 'https://example.test',
    userEnv: async () => ({ PATH: '/mock', HOME: '/host', CODEX_HOME: '/host/.codex' }),
    probeCli: async () => ({ installed: true, loggedIn: true, path: process.execPath }),
    readUsage: async () => ({}),
    readCliCache: () => ({}),
    writeCliCache() {},
    prepareAgentHome: (_provider, dir) => dir,
    registerDevice: async () => {},
    probeModels: async ({ agentHome = '' }) => {
      const signedIn = existsSync(path.join(agentHome, 'signed-in'))

      reads.push({ home: agentHome, signedIn })

      return { models: [{ id: signedIn ? 'azure/gpt' : 'free/model' }], defaultModel: '', controls: {} }
    },
    createProcess: () => ({
      start: async () => ({ port: 1, authKey: 'mock', controlKey: 'mock' }),
      stop: async () => {},
      onExit: () => () => {},
    }),
    createTunnel: () => ({ start() {}, stop() {}, sendStatus() {}, reconnectNow() {} }),
  }
  const controller = new LocalRuntimeController(deps, ['codex'])

  t.after(() => controller.shutdown())
  await controller.setUser('alice')
  const signIn = async (home: string, commit: Record<string, string>) => {
    mkdirSync(home, { recursive: true })
    writeFileSync(path.join(home, 'signed-in'), '')
    await controller.instanceRequest({ method: 'commit', ...commit })

    return reads.some((read) => read.home === home && read.signedIn)
  }
  const readOf = async (match: (home: string) => boolean) => {
    for (let tries = 0; tries < 100 && !reads.some(({ home }) => match(home)); tries++)
      await new Promise((resolve) => setTimeout(resolve, 10))

    return reads.find(({ home }) => match(home))
  }

  assert.ok(await readOf(() => true), 'the computer’s own agent read its models when it started')
  assert.equal(await signIn(reads[0].home, { provider: 'codex' }), true, 'the own agent')

  const instanceId = randomUUID()

  await controller.instanceRequest({ method: 'create', instanceId, provider: 'codex', label: 'A' })
  await controller.instanceRequest({ method: 'commit', instanceId })
  const added = await readOf((home) => home.includes(instanceId))

  assert.ok(added, 'the added agent read its models when it started')
  assert.equal(added.signedIn, false)
  assert.equal(await signIn(added.home, { instanceId }), true, 'the added agent')
})
