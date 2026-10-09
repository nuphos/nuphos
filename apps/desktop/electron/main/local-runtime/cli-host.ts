// `nuphos agent`: this computer's local agents without Electron. The CLI runs
// this bundled file on the user's own Node, next to the staged openab and
// adapters, signed in with the session the CLI and the desktop share.

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import yaml from 'js-yaml'

import { callJson } from '../../agent/http.ts'
import { apiUrl } from '../../api-endpoint.ts'
import { unverifiedTokenSubject } from '../../auth-status.ts'
import { CLI_CONFIG_PATH } from '../../cli-config-path.ts'
import { defaultDeviceLabel, parseDeviceIdentity } from '../device-identity-core.ts'

import { LOCAL_AGENT_PROVIDERS, findAgentCli, probeAgentCli, readAgentUsage } from './agent-cli.ts'
import { prepareAgentHome } from './agent-home.ts'
import { agentCliEnv, agentEnv, readBundle } from './config.ts'
import { LocalRuntimeController } from './controller.ts'
import { LocalExecStream } from './exec-stream.ts'
import { LocalFileStream } from './file-stream.ts'
import { probeLocalModels } from './model-probe.ts'
import { OpenabProcess } from './openab-process.ts'
import { RuntimeTunnelClient } from './tunnel-client.ts'

import type { DeviceIdentity } from '../device-identity-core.ts'
import type { AgentCliStatus, LocalAgentProvider } from './agent-cli.ts'

const bundleRoot = process.env.NUPHOS_LOCAL_RUNTIME_DIR ?? path.dirname(process.argv[1] ?? '.')
// Apart from the desktop's, so both can run on one computer as two devices.
const dataDir =
  process.env.NUPHOS_AGENT_HOME ?? path.join(os.homedir(), '.local', 'share', 'nuphos', 'agent')
const clientVersion = `nuphos-cli/${process.env.NUPHOS_CLI_VERSION ?? 'dev'}`
const NAMES: Record<LocalAgentProvider, string> = { 'claude-code': 'Claude Code', codex: 'Codex' }

function deviceIdentity(): DeviceIdentity {
  const file = path.join(dataDir, 'device-identity.json')

  try {
    const saved = parseDeviceIdentity(readFileSync(file, 'utf8'))

    if (saved) return saved
  } catch {
    // None yet.
  }
  const identity = {
    deviceId: randomUUID(),
    label: defaultDeviceLabel(),
    createdAt: new Date().toISOString(),
  }

  mkdirSync(dataDir, { recursive: true })
  writeFileSync(file, JSON.stringify(identity), { mode: 0o600 })

  return identity
}

const device = deviceIdentity()
const bundle = () => readBundle(bundleRoot)
const cliCacheFile = (userId: string) => path.join(dataDir, 'users', userId, 'cli.json')
const log = (message: string, data?: Record<string, unknown>) => {
  if (process.env.NUPHOS_DEBUG) console.error(`[agent] ${message}`, data ?? '')
}
let lastSummary = ''
let stopping = false

/** The session in cli.yaml now: signing out here or in the app empties it. */
function currentToken(): string | null {
  try {
    return (
      (yaml.load(readFileSync(CLI_CONFIG_PATH, 'utf8')) as { token?: string } | null)?.token ?? null
    )
  } catch {
    return null
  }
}

const token = currentToken()
const owner = token ? unverifiedTokenSubject(token) : undefined

if (!token || !owner) {
  console.error('Not signed in; run `nuphos login` first.')
  process.exit(1)
}
if (!bundle()) {
  console.error(`No local runtime bundle at ${bundleRoot}.`)
  process.exit(1)
}

const controller: LocalRuntimeController = new LocalRuntimeController({
  bundle,
  dataDir: () => dataDir,
  nodeExecPath: process.execPath,
  backendUrl: apiUrl(),
  userEnv: () => Promise.resolve(process.env),
  probeCli: probeAgentCli,
  readUsage: readAgentUsage,
  readCliCache: (userId) => {
    try {
      return JSON.parse(readFileSync(cliCacheFile(userId), 'utf8')) as Partial<
        Record<LocalAgentProvider, AgentCliStatus>
      >
    } catch {
      return {}
    }
  },
  writeCliCache: (userId, cli) => {
    try {
      mkdirSync(path.dirname(cliCacheFile(userId)), { recursive: true })
      writeFileSync(cliCacheFile(userId), JSON.stringify(cli), { mode: 0o600 })
    } catch {
      // Only a head start for the next run.
    }
  },
  onChange: report,
  prepareAgentHome,
  registerDevice: async () => {
    await callJson('PUT', '/agent/devices', {
      deviceId: device.deviceId,
      label: device.label,
      platform: process.platform,
      allowLocalExec: true,
    })
  },
  createProcess: () => new OpenabProcess(),
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
  createTunnel: (runtime, status, onChange) =>
    new RuntimeTunnelClient({
      connectBackend: () => {
        const fresh = currentToken()

        if (!fresh || unverifiedTokenSubject(fresh) !== owner) throw new Error('Signed out')
        const url = `${apiUrl().replace(/^http/u, 'ws')}/agent/devices/${encodeURIComponent(device.deviceId)}/runtime-tunnel`

        return new WebSocket(url, {
          headers: { authorization: `Bearer ${fresh}`, 'x-atlas-client': clientVersion },
        })
      },
      connectFile: () => {
        const workspace = controller.state().workspace

        return workspace ? new LocalFileStream(workspace) : null
      },
      connectExec: () => new LocalExecStream(),
      connectRuntime: (purpose, provider) => {
        const running = runtime(provider)

        if (!running) return null
        const key = purpose === 'control' ? running.controlKey : running.authKey

        return new WebSocket(`ws://127.0.0.1:${String(running.port)}/acp`, [
          `openab.bearer.${key}`,
          'acp.v1',
        ])
      },
      status,
      onChange,
    }),
  log,
})

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

/** Claude Code serves Nuphos from a home of its own, which needs its own sign-in. */
async function signInClaude(ownerId: string): Promise<void> {
  const cli = controller.state().agents['claude-code'].cli

  if (!cli?.installed || cli.loggedIn || !process.stdin.isTTY) return
  const cliPath = findAgentCli('claude-code', process.env)
  const userDir = path.join(dataDir, 'users', ownerId)
  const agentHome = prepareAgentHome('claude-code', userDir, path.join(userDir, 'workspace'))

  if (!cliPath || !agentHome) return
  console.log(
    process.platform === 'darwin'
      ? 'Sign Claude Code in for Nuphos (updates the Claude login used by your terminal):'
      : 'Sign Claude Code in for Nuphos (a separate sign-in from your own terminal):',
  )
  await new Promise((resolve) => {
    spawn(cliPath, ['auth', 'login', '--claudeai'], {
      env: agentCliEnv({ provider: 'claude-code', env: process.env, cliPath, agentHome }),
      stdio: 'inherit',
    })
      .on('exit', resolve)
      .on('error', resolve)
  })
  await controller.refresh(true, ['claude-code'])
}

function stop(message = 'Stopping the local agents…'): void {
  if (stopping) process.exit(130)
  stopping = true
  console.log(message)
  void controller.shutdown().then(() => process.exit(0))
}

// The agents follow the session, as the desktop's do: signed out here or in the
// app (the same cli.yaml), or signed in as someone else, they stop. Logging out
// does not revoke the token, so an open tunnel would otherwise keep serving.
setInterval(() => {
  const fresh = currentToken()

  if (!stopping && (!fresh || unverifiedTokenSubject(fresh) !== owner))
    stop('Signed out of Nuphos; stopping the local agents.')
}, 2_000)
// A closed terminal or a dropped SSH session stops them too.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => stop())
console.log(`Running this computer's agents for Nuphos as "${device.label}". Press Ctrl-C to stop.`)
console.log(
  'Conversations you move onto this computer can be continued by anyone in that team, and their messages run commands here.',
)
await controller.setUser(owner)
await signInClaude(owner)
