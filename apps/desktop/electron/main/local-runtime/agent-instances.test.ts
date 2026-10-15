import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { parseInstance, readInstances } from './agent-instances.ts'
import { agentCliEnv } from './config.ts'
import { LocalRuntimeController } from './controller.ts'

import type { LocalRuntimeControllerDeps } from './controller-types.ts'
import type { OpenabProcessOptions } from './openab-process.ts'

test('same-provider instances persist and isolate homes, processes, usage and routing', async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nuphos-instances-'))

  t.after(() => rmSync(root, { recursive: true, force: true }))
  const starts: OpenabProcessOptions[] = []
  const usageHomes: string[] = []
  let tunnels = 0
  let resolveRuntime: Parameters<LocalRuntimeControllerDeps['createTunnel']>[0]
  const adapter = { entry: '/mock/adapter', bridge: '/mock/bridge', version: '1' }
  const deps: LocalRuntimeControllerDeps = {
    bundle: () => ({
      root: '/mock',
      openab: '/mock/openab',
      adapters: { codex: adapter, 'claude-code': adapter },
    }),
    dataDir: () => root,
    nodeExecPath: '/mock/node',
    backendUrl: 'https://example.test',
    userEnv: async () => ({ PATH: '/mock', HOME: '/host', CODEX_HOME: '/host/.codex' }),
    probeCli: async (provider) => ({ installed: true, loggedIn: true, path: `/mock/${provider}` }),
    readUsage: async (_provider, env) => {
      usageHomes.push(env.CODEX_HOME ?? env.CLAUDE_CONFIG_DIR ?? '')

      return { home: env.CODEX_HOME ?? env.CLAUDE_CONFIG_DIR }
    },
    readCliCache: () => ({}),
    writeCliCache() {},
    prepareAgentHome: (_provider, dir) => dir,
    registerDevice: async () => {},
    probeModels: async () => ({ models: [], defaultModel: '', controls: {} }),
    createProcess: () => ({
      start: async (options) => {
        starts.push(options)

        return { port: starts.length, authKey: 'mock', controlKey: 'mock' }
      },
      stop: async () => {},
      onExit: () => () => {},
    }),
    createTunnel: (runtime) => {
      resolveRuntime = runtime
      tunnels++

      return { start() {}, stop() {}, sendStatus() {}, reconnectNow() {} }
    },
  }
  const controller = new LocalRuntimeController(deps)

  t.after(() => controller.shutdown())
  await controller.setUser('alice')
  const first = { instanceId: randomUUID(), provider: 'codex', label: 'Work' }
  const second = { instanceId: randomUUID(), provider: 'codex', label: 'Personal' }

  await controller.instanceRequest({ method: 'create', ...first })
  await controller.instanceRequest({ method: 'create', ...second })
  const runs = starts.slice(-2)

  assert.notEqual(runs[0].agentHome, runs[1].agentHome)
  assert.notEqual(runs[0].openabHome, runs[1].openabHome)
  assert.notEqual(runs[0].workspace, runs[1].workspace)
  for (const run of runs) {
    const config = path.join(run.agentHome, 'config.toml')

    assert.equal(lstatSync(run.agentHome).isSymbolicLink(), false)
    assert.equal(lstatSync(config).isSymbolicLink(), false)
    assert.equal(readFileSync(config, 'utf8'), 'cli_auth_credentials_store = "file"\n')
    assert.equal(agentCliEnv(run).CODEX_HOME, run.agentHome)
  }
  assert.equal(existsSync(path.join(runs[0].agentHome, 'auth.json')), false)
  writeFileSync(path.join(runs[0].agentHome, 'auth.json'), '{"mock":true}')
  assert.equal(lstatSync(path.join(runs[0].agentHome, 'auth.json')).isSymbolicLink(), false)
  assert.equal(existsSync(path.join(runs[1].agentHome, 'auth.json')), false)
  assert.ok(usageHomes.includes(runs[0].agentHome))
  assert.ok(usageHomes.includes(runs[1].agentHome))
  assert.equal(tunnels, 1)
  assert.notEqual(
    resolveRuntime!('codex', first.instanceId)?.port,
    resolveRuntime!('codex', second.instanceId)?.port,
  )
  assert.equal(resolveRuntime!('codex', randomUUID()), null)
  assert.equal(resolveRuntime!('claude-code', first.instanceId), null)
  assert.deepEqual(readInstances(path.join(root, 'users', 'alice')), [first, second])
  const claude = { instanceId: randomUUID(), provider: 'claude-code', label: 'Claude work' }

  await controller.instanceRequest({ method: 'create', ...claude })
  const claudeRun = starts.at(-1)!

  assert.ok(claudeRun.agentHome.includes(claude.instanceId))
  const cliEnv = agentCliEnv(claudeRun)

  assert.equal(cliEnv.CLAUDE_CONFIG_DIR, claudeRun.agentHome)
  assert.equal(cliEnv.CLAUDE_SECURESTORAGE_CONFIG_DIR, claudeRun.agentHome)
  assert.equal(existsSync(path.join(claudeRun.agentHome, '.credentials.json')), false)
  const claudeB = { instanceId: randomUUID(), provider: 'claude-code', label: 'Claude personal' }

  await controller.instanceRequest({ method: 'create', ...claudeB })
  const claudeBRun = starts.at(-1)!
  const cliEnvB = agentCliEnv(claudeBRun)

  assert.ok(claudeBRun.agentHome.includes(claudeB.instanceId))
  assert.notEqual(cliEnvB.CLAUDE_CONFIG_DIR, cliEnv.CLAUDE_CONFIG_DIR)
  assert.notEqual(cliEnvB.CLAUDE_SECURESTORAGE_CONFIG_DIR, cliEnv.CLAUDE_SECURESTORAGE_CONFIG_DIR)
  assert.equal(cliEnvB.CLAUDE_SECURESTORAGE_CONFIG_DIR, claudeBRun.agentHome)
  assert.equal(tunnels, 1)
  assert.notEqual(
    resolveRuntime!('claude-code', claude.instanceId)?.port,
    resolveRuntime!('claude-code', claudeB.instanceId)?.port,
  )
  writeFileSync(path.join(claudeRun.agentHome, '.credentials.json'), '{"mock":true}')
  assert.equal(existsSync(path.join(claudeBRun.agentHome, '.credentials.json')), false)
  const count = starts.length

  await controller.instanceRequest({ method: 'create', ...first })
  assert.equal(starts.length, count)
  await assert.rejects(
    controller.instanceRequest({ method: 'create', ...first, provider: 'claude-code' }),
  )
  await controller.setUser('bob')
  assert.equal(controller.state().instances?.length, 0)
  await controller.setUser('alice')
  assert.equal(controller.state().instances?.length, 4)
  assert.deepEqual(readInstances(path.join(root, 'users', 'alice')), [
    first,
    second,
    claude,
    claudeB,
  ])
  assert.equal(readFileSync(path.join(runs[0].agentHome, 'auth.json'), 'utf8'), '{"mock":true}')
})

test('inventory rejects traversal, unsupported providers and empty labels', () => {
  assert.throws(() => parseInstance({ instanceId: '../host', provider: 'codex', label: 'X' }))
  assert.throws(() => parseInstance({ instanceId: randomUUID(), provider: 'other', label: 'X' }))
  assert.throws(() => parseInstance({ instanceId: randomUUID(), provider: 'codex', label: ' ' }))
})
