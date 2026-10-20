// `nuphos agent`: local agents on Node beside the staged openab, without Electron.

import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import yaml from 'js-yaml'

import { callJson, setTokenSource } from '../../agent/http.ts'
import { apiUrl } from '../../api-endpoint.ts'
import { unverifiedTokenSubject } from '../../auth-status.ts'
import { CLI_CONFIG_PATH } from '../../cli-config-path.ts'
import {
  defaultDeviceLabel,
  parseDeviceIdentity,
  readMachineKey,
  stableDeviceId,
} from '../device-identity-core.ts'
import { readDeviceMetrics } from '../device-metrics.ts'

import { LOCAL_AGENT_PROVIDERS, probeAgentCli, readAgentUsage } from './agent-cli.ts'
import { podOwnerAgentHome } from './agent-home.ts'
import { agentEnv, readBundle } from './config.ts'
import { readCliCache, writeCliCache } from './cli-cache.ts'
import { LocalRuntimeController } from './controller.ts'
import { signInClaude } from './cli-sign-in.ts'
import {
  enableDesktopPool,
  desktopStatus,
  openDesktop,
  watchDesktops,
  withDesktopRequests,
} from './desktop-pool.ts'
import { deviceCredentialFor, exitRevoked, ownsMachine, tunnelUrlFor } from './device-credential.ts'
import { LocalExecStream } from './exec-stream.ts'
import { LocalFileStream } from './file-stream.ts'
import { probeLocalModels } from './model-probe.ts'
import { OpenabProcess } from './openab-process.ts'
import { RuntimeTunnelClient } from './tunnel-client.ts'
import { VncStream } from './vnc-stream.ts'

import type { DeviceIdentity } from '../device-identity-core.ts'
import type { LocalAgentProvider } from './agent-cli.ts'

const bundleRoot = process.env.NUPHOS_LOCAL_RUNTIME_DIR ?? path.dirname(process.argv[1] ?? '.')
const dataDir = process.env.NUPHOS_AGENT_HOME ?? ''

if (!dataDir) {
  console.error('NUPHOS_AGENT_HOME is not set; run this through `nuphos agent`.')
  process.exit(1)
}
const clientVersion = `nuphos-cli/${process.env.NUPHOS_CLI_VERSION ?? 'dev'}`
const NAMES: Record<LocalAgentProvider, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  grok: 'Grok Build',
  opencode: 'OpenCode',
}

function deviceIdentity(): DeviceIdentity {
  const file = path.join(dataDir, 'device-identity.json')

  try {
    const saved = parseDeviceIdentity(readFileSync(file, 'utf8'))

    if (saved) return saved
  } catch {
    // None yet.
  }
  const key = readMachineKey()
  const identity = {
    deviceId: key ? stableDeviceId(key, 'cli') : randomUUID(),
    label: defaultDeviceLabel(),
    createdAt: new Date().toISOString(),
  }

  mkdirSync(dataDir, { recursive: true })
  writeFileSync(file, JSON.stringify(identity), { mode: 0o600 })

  return identity
}

const device = deviceIdentity()
const bundle = () => readBundle(bundleRoot)
const log = (message: string, data?: Record<string, unknown>) => {
  if (process.env.NUPHOS_DEBUG) console.error(`[agent] ${message}`, data ?? '')
}
let lastSummary = ''
let stopping = false

// From `nuphos agent` (the keychain trusts the CLI, not node); kept from the agents.
const launchToken = process.env.NUPHOS_SESSION_TOKEN || null

delete process.env.NUPHOS_SESSION_TOKEN

/** The CLI's session: in cli.yaml, or the launch token while cli.yaml names its user. */
function currentToken(): string | null {
  let cfg: { token?: string; keychainAccount?: string } | null

  try {
    cfg = yaml.load(readFileSync(CLI_CONFIG_PATH, 'utf8')) as typeof cfg
  } catch {
    return null
  }
  if (cfg?.token) return cfg.token
  if (!launchToken || !cfg?.keychainAccount) return null

  return cfg.keychainAccount.startsWith(`${unverifiedTokenSubject(launchToken) ?? ''}@`)
    ? launchToken
    : null
}

// API calls go out with the session, read as above.
setTokenSource(() => Promise.resolve(currentToken()))

// A Linux Box with Xvnc gives every session its own desktop (see desktop-session.mjs).
const desktopPool = enableDesktopPool(bundleRoot, dataDir)
const desktopWrapper = path.join(bundleRoot, 'desktop-session.mjs')

if (desktopPool) console.log('Each session gets its own desktop on this computer.')
const deviceCredential = await deviceCredentialFor({
  dataDir,
  apiUrl: apiUrl(),
  label: device.label,
  joinToken: process.env.NUPHOS_JOIN_TOKEN?.trim() || undefined,
  headers: { 'x-atlas-client': clientVersion },
})
const deviceId = deviceCredential?.deviceId ?? device.deviceId
const token = deviceCredential ? null : currentToken()
const owner = deviceCredential?.userId ?? (token ? unverifiedTokenSubject(token) : undefined)

if (!owner) {
  console.error('Not signed in; run `nuphos login`, or join with `nuphos agent --join <token>`.')
  process.exit(1)
}
if (!bundle()) {
  console.error(`No local runtime bundle at ${bundleRoot}.`)
  process.exit(1)
}

const prepareAgentHome = podOwnerAgentHome(owner, dataDir)
const controller: LocalRuntimeController = new LocalRuntimeController({
  bundle,
  ownsMachine: ownsMachine(deviceCredential),
  dataDir: () => dataDir,
  nodeExecPath: process.execPath,
  backendUrl: apiUrl(),
  userEnv: () => Promise.resolve(process.env),
  probeCli: probeAgentCli,
  readUsage: readAgentUsage,
  readCliCache: (userId) => readCliCache(dataDir, userId),
  writeCliCache: (userId, cli) => writeCliCache(dataDir, userId, cli),
  onChange: report,
  prepareAgentHome,
  registerDevice: async () => {
    if (deviceCredential) return
    await callJson('PUT', '/agent/devices', {
      deviceId: device.deviceId,
      label: device.label,
      platform: process.platform,
      allowLocalExec: true,
    })
  },
  createProcess: () => new OpenabProcess({ ownsMachine: ownsMachine(deviceCredential) }),
  probeModels: ({ provider, workspace, env, cliPath, agentHome }) => {
    const staged = bundle()
    const adapter = staged?.adapters[provider]

    if (!staged || !adapter) return Promise.reject(new Error('The local agent is not bundled'))

    return probeLocalModels({
      nodeExecPath: process.execPath,
      adapter: adapter.entry,
      cwd: workspace,
      env: agentEnv({
        provider,
        bundle: staged,
        adapter,
        nodeExecPath: process.execPath,
        cliPath,
        agentHome,
        workspace,
        openabHome: workspace,
        port: 0,
        authKey: '',
        env,
      }),
    })
  },
  createTunnel: (runtime, status, onChange, instances) => {
    tunnel = new RuntimeTunnelClient({
      instances: desktopPool
        ? withDesktopRequests(
            (sessionId) => openDesktop(desktopWrapper, desktopPool, sessionId),
            instances,
          )
        : instances,
      sampleMetrics: readDeviceMetrics,
      connectBackend: () => {
        const fresh = deviceCredential?.credential ?? currentToken()

        if (!fresh || (!deviceCredential && unverifiedTokenSubject(fresh) !== owner))
          throw new Error('Signed out')

        return new WebSocket(tunnelUrlFor(apiUrl(), deviceId).replace(/^http/u, 'ws'), {
          headers: { authorization: `Bearer ${fresh}`, 'x-atlas-client': clientVersion },
        })
      },
      onRevoked: () => {
        void controller.shutdown().then(exitRevoked)
      },
      connectFile: (instanceId) => LocalFileStream.open(controller.state(), instanceId),
      connectExec: () => new LocalExecStream(),
      connectVnc: desktopPool ? () => new VncStream(desktopPool) : undefined,
      connectRuntime: (purpose, provider, instanceId) => {
        const running = runtime(provider, instanceId)

        if (!running) return null
        const key = purpose === 'control' ? running.controlKey : running.authKey

        return new WebSocket(`ws://127.0.0.1:${String(running.port)}/acp`, [
          `openab.bearer.${key}`,
          'acp.v1',
        ])
      },
      // Which sessions hold a desktop here rides along with the agents' status.
      status: () => ({
        ...status(),
        ...(desktopPool ? desktopStatus(desktopWrapper, desktopPool) : {}),
      }),
      onChange: (connected, superseded) => {
        onChange(connected, superseded)
        if (superseded) stop('Another Nuphos app on this computer took over the local agent.')
      },
    })

    return tunnel
  },
  log,
})

let tunnel: RuntimeTunnelClient | undefined

// A desktop appearing or going changes the status; the pool directory says when.
if (desktopPool) watchDesktops(desktopPool, () => tunnel?.sendStatus())

/** One line per agent whenever what the user would see changes. */
function report(): void {
  if (stopping) return
  const { agents } = controller.state()
  const lines = LOCAL_AGENT_PROVIDERS.map((provider) => {
    const agent = agents[provider]
    let detail = 'starting…'

    if (agent.online && agent.cli?.installed && !agent.cli.loggedIn)
      detail = 'not signed in; run `nuphos agent` in a terminal to sign in'
    else if (agent.online) detail = 'online'
    else if (agent.error) detail = agent.error
    else if (!agent.available) detail = 'not bundled for this computer'

    return `  ${NAMES[provider]}: ${detail}`
  })
  const summary = lines.join('\n')

  if (summary === lastSummary) return
  lastSummary = summary
  console.log(`${new Date().toLocaleTimeString()} ${device.label}\n${summary}`)
}

function stop(message = 'Stopping the local agents…'): void {
  if (stopping) process.exit(130)
  stopping = true
  console.log(message)
  void controller.shutdown().then(() => process.exit(0))
}

// With a session the agents follow it (signed out or switched user: stop); a Box stops on revocation.
if (!deviceCredential)
  setInterval(() => {
    const fresh = currentToken()

    if (!stopping && (!fresh || unverifiedTokenSubject(fresh) !== owner))
      stop('Signed out of Nuphos; stopping the local agents.')
  }, 2_000)
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => stop())
console.log(`Running this computer's agents for Nuphos as "${device.label}". Press Ctrl-C to stop.`)
console.log(
  'Conversations you move onto this computer can be continued by anyone in that team, and their messages run commands here.',
)
await controller.setUser(owner)
setInterval(() => {
  const { agents, instances = [] } = controller.state()
  const signedOut = LOCAL_AGENT_PROVIDERS.filter((p) => {
    const { online, cli } = agents[p]

    return online && cli?.installed === true && !cli.loggedIn
  })

  // Added agents follow their own provider's refresh, which also probes every instance.
  const instanceSignedOut = instances.some(({ cli }) => cli?.installed === true && !cli.loggedIn)

  if (!stopping && (signedOut.length || instanceSignedOut))
    void controller.refresh(false, signedOut)
}, 30_000)
await signInClaude(controller, dataDir, owner, prepareAgentHome)
