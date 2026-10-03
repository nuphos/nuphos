import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'

import { LocalRuntimeController } from './controller.ts'

import type { AgentCliStatus, LocalAgentProvider } from './agent-cli.ts'
import type { LocalRuntimeControllerDeps } from './controller-types.ts'
import type { LocalRuntimeTunnelStatus } from './tunnel-client.ts'

const adapter = (provider: string) => ({
  entry: `/b/${provider}.js`,
  bridge: '/b/bridge.mjs',
  version: `${provider}@1`,
})

function harness(
  cli: Partial<Record<LocalAgentProvider, AgentCliStatus>> = {},
  agentHome = true,
  cliCache: Record<string, Partial<Record<LocalAgentProvider, AgentCliStatus>>> = {},
  bundled = { current: true },
) {
  const events: string[] = []
  const probeHomes: (string | undefined)[] = []
  let changes = 0
  const seenCli: (AgentCliStatus | null)[] = []
  const exits: ((code: number | null) => void)[] = []
  let tunnelChange: ((connected: boolean, superseded: boolean) => void) | undefined
  let tunnelStatus: (() => LocalRuntimeTunnelStatus) | undefined
  const deps: LocalRuntimeControllerDeps = {
    bundle: () =>
      bundled.current
        ? {
            root: '/b',
            openab: '/b/openab',
            adapters: { 'claude-code': adapter('claude'), codex: adapter('codex') },
          }
        : null,
    dataDir: () => '/data',
    nodeExecPath: '/electron',
    backendUrl: 'https://api.example.com',
    userEnv: () => Promise.resolve({ PATH: '/bin' }),
    probeCli: (provider, _env, agentHome) => {
      probeHomes.push(agentHome)

      return Promise.resolve(
        cli[provider] ?? { installed: true, path: `/bin/${provider}`, loggedIn: true },
      )
    },
    readCliCache: (userId) => cliCache[userId] ?? {},
    writeCliCache: (userId, value) => {
      cliCache[userId] = value
    },
    onChange: () => {
      changes += 1
      seenCli.push(controller.state().agents['claude-code'].cli)
    },
    prepareAgentHome: (provider, userDir) =>
      agentHome ? path.join(userDir, `${provider}-home`) : undefined,
    registerDevice: () => {
      events.push('register')

      return Promise.resolve()
    },
    probeModels: () => Promise.reject(new Error('not in tests')),
    createProcess: () => ({
      start: (options) => {
        events.push(`start:${options.provider}:${options.workspace}:${options.agentHome}`)

        return Promise.resolve({ port: 1, authKey: 'k', controlKey: 'c' })
      },
      stop: () => {
        events.push('stop')

        return Promise.resolve()
      },
      onExit: (listener) => {
        exits.push(listener)

        return () => {}
      },
    }),
    createTunnel: (_runtime, status, onChange) => {
      tunnelChange = onChange
      tunnelStatus = status

      return {
        start: () => events.push('tunnel:start'),
        stop: () => {
          events.push('tunnel:stop')
          onChange(false, false)
        },
        sendStatus: () => {},
        reconnectNow: () => events.push('tunnel:reconnect'),
      }
    },
  }

  const controller = new LocalRuntimeController(deps)

  return {
    controller,
    events,
    exits,
    connect: (connected: boolean, superseded = false) => {
      tunnelChange?.(connected, superseded)
    },
    status: () => tunnelStatus?.(),
    changes: () => changes,
    seenCli,
    cliCache,
    probeHomes,
  }
}

const workspace = path.join('/data', 'users', 'alice', 'workspace')
const home = (provider: LocalAgentProvider) =>
  path.join('/data', 'users', 'alice', `${provider}-home`)

const started = (provider: LocalAgentProvider) => `start:${provider}:${workspace}:${home(provider)}`

test('signing in connects the tunnel and starts every installed agent, with no switch', async () => {
  const { controller, events, status } = harness()

  await controller.setUser('alice')

  assert.deepEqual(
    [...events].sort(),
    ['register', started('claude-code'), started('codex'), 'tunnel:start'].sort(),
  )
  assert.ok(events.indexOf('register') < events.indexOf('tunnel:start'))
  assert.deepEqual(Object.keys(status()?.agents ?? {}), ['claude-code', 'codex'])
})

test('the last known sign-in shows at once after a restart, then the fresh probe replaces it', async () => {
  const signedOut: AgentCliStatus = { installed: true, path: '/bin/claude-code', loggedIn: false }
  const cached: AgentCliStatus = { installed: true, path: '/bin/claude-code', loggedIn: true }
  const { controller, seenCli, cliCache } = harness({ 'claude-code': signedOut }, true, {
    alice: { 'claude-code': cached },
  })

  await controller.setUser('alice')

  assert.deepEqual(
    seenCli.find((cli) => cli !== null),
    cached,
  )
  assert.deepEqual(controller.state().agents['claude-code'].cli, signedOut)
  assert.deepEqual(cliCache.alice?.['claude-code'], signedOut)
})

test('the tunnel stays up with no agent installed, so the owner’s other computers can see it', async () => {
  const { controller, events, status } = harness({
    'claude-code': { installed: false },
    codex: { installed: false },
  })

  await controller.setUser('alice')

  assert.deepEqual(events, ['register', 'tunnel:start'])
  assert.deepEqual(status()?.agents, {})
})

test('online is exactly whether the tunnel is connected and that agent runs', async () => {
  const { controller, connect } = harness({ codex: { installed: false } })

  await controller.setUser('alice')
  assert.equal(controller.state().agents['claude-code'].online, false)
  connect(true)
  assert.equal(controller.state().agents['claude-code'].online, true)
  assert.equal(controller.state().agents.codex.online, false)
  connect(false)
  assert.equal(controller.state().agents['claude-code'].online, false)
})

test('installing a CLI later starts that agent on the next check', async () => {
  const cli: Partial<Record<LocalAgentProvider, AgentCliStatus>> = { codex: { installed: false } }
  const { controller, events } = harness(cli)

  await controller.setUser('alice')
  events.length = 0
  delete cli.codex
  await controller.refresh()

  assert.deepEqual(events, [started('codex')])
})

test('a bundle staged while the app runs starts the agents without a restart', async () => {
  const bundled = { current: false }
  const { controller, events } = harness({}, true, {}, bundled)

  await controller.setUser('alice')
  assert.equal(controller.state().agents.codex.available, false)
  assert.ok(!events.some((event) => event.startsWith('start:')))
  bundled.current = true
  await controller.refresh(true)

  assert.equal(controller.state().agents.codex.available, true)
  assert.deepEqual(
    events.filter((event) => event.startsWith('start:')).sort(),
    [started('claude-code'), started('codex')].sort(),
  )
})

test('an account switch stops the previous user’s agents and never inherits them', async () => {
  const { controller, events, connect } = harness()

  await controller.setUser('alice')
  connect(true)
  events.length = 0

  await controller.setUser('bob')

  assert.equal(events.filter((event) => event === 'stop').length, 2)
  assert.ok(events.includes('tunnel:stop'))
  assert.ok(controller.state().workspace?.includes(`${path.sep}bob${path.sep}`))
})

test('signing out stops everything', async () => {
  const { controller, events } = harness()

  await controller.setUser('alice')
  events.length = 0
  await controller.setUser(null)

  assert.ok(events.includes('stop'))
  assert.ok(events.includes('tunnel:stop'))
  assert.equal(controller.state().workspace, null)
})

test('a missing CLI is reported for that agent instead of starting it', async () => {
  const { controller, events } = harness({ codex: { installed: false } })

  await controller.setUser('alice')

  assert.match(controller.state().agents.codex.error ?? '', /Install Codex/u)
  assert.ok(!events.includes(started('codex')))
})

test('when openab dies the agent drops out and comes back', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { controller, events, exits, connect } = harness({ codex: { installed: false } })

  await controller.setUser('alice')
  connect(true)
  events.length = 0
  exits[0]?.(1)

  assert.equal(controller.state().agents['claude-code'].online, false)
  t.mock.timers.tick(1_000)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(events, [started('claude-code')])
})

test('waking the computer redials immediately', async () => {
  const { controller, events } = harness()

  await controller.setUser('alice')
  controller.reconnect()

  assert.equal(events.at(-1), 'tunnel:reconnect')
})

test('another app taking over is the one error that does not heal on its own', async () => {
  const { controller, connect } = harness()

  await controller.setUser('alice')
  connect(true)
  connect(false, true)

  assert.match(controller.state().agents['claude-code'].error ?? '', /took over/u)
})

test('an agent does not start at all when its isolated home cannot be prepared', async () => {
  const { controller, events } = harness({}, false)

  await controller.setUser('alice')

  assert.deepEqual(events, ['register', 'tunnel:start'])
  assert.match(controller.state().agents.codex.error ?? '', /codex login/u)
  assert.match(controller.state().agents['claude-code'].error ?? '', /separate Claude Code home/u)
})

test('startup and refresh probe the same isolated homes used by the adapters', async () => {
  const { controller, probeHomes } = harness()

  await controller.setUser('alice')
  assert.deepEqual(probeHomes, [home('claude-code'), home('codex')])
  probeHomes.length = 0
  await controller.refresh()
  assert.deepEqual(probeHomes, [home('claude-code'), home('codex')])
  await controller.setUser(null)
  probeHomes.length = 0
  await controller.refresh()
  assert.deepEqual(probeHomes, [])
})

test('reconnecting Claude after login leaves the Codex process running', async () => {
  const { controller, events } = harness()

  await controller.setUser('alice')
  events.length = 0
  await controller.refresh(true, ['claude-code'])
  assert.deepEqual(events, ['stop', started('claude-code')])
})
