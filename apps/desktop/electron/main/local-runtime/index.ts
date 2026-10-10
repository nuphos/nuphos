import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { app, BrowserWindow, powerMonitor, shell } from 'electron'

import { callJson } from '../../agent/http.ts'
import { logLocalTool } from '../../agent/local-exec.ts'
import { apiUrl } from '../../api-endpoint.ts'
import { authSession } from '../../auth-session.ts'
import { unverifiedTokenSubject } from '../../auth-status.ts'
import { CLIENT_VERSION_HEADER, CLIENT_VERSION_VALUE } from '../../client-version.ts'
import { resolveShellEnv } from '../../shell-env.ts'
import { syncDeviceRegistration } from '../device-controller.ts'
import { readDeviceIdentity } from '../device-identity.ts'

import { LOCAL_AGENT_PROVIDERS, findAgentCli, probeAgentCli, readAgentUsage } from './agent-cli.ts'
import { prepareAgentHome } from './agent-home.ts'
import { ClaudeLogin } from './claude-login.ts'
import { prepareComputerUse } from './computer-use-permission.ts'
import { agentCliEnv, agentEnv, readBundle } from './config.ts'
import { LocalRuntimeController } from './controller.ts'
import { devBundleHint, watchDevBundle } from './dev-bundle.ts'
import { LocalExecStream } from './exec-stream.ts'
import { LocalFileStream } from './file-stream.ts'
import { probeLocalModels } from './model-probe.ts'
import { OpenabProcess } from './openab-process.ts'
import { RuntimeTunnelClient } from './tunnel-client.ts'

import type { AgentCliStatus, LocalAgentProvider } from './agent-cli.ts'
import type { LocalRuntimeBundle } from './config.ts'
import type { LocalRuntimeState } from './controller-types.ts'
import type { DevBundleHint } from './dev-bundle.ts'

const dataDir = () => path.join(app.getPath('userData'), 'local-runtime')
const devBuild = () => !app.isPackaged && !process.env.NUPHOS_LOCAL_RUNTIME_DIR

function bundleRoot(): string {
  if (process.env.NUPHOS_LOCAL_RUNTIME_DIR) return process.env.NUPHOS_LOCAL_RUNTIME_DIR
  if (app.isPackaged) return path.join(process.resourcesPath, 'local-runtime')

  return path.join(
    app.getAppPath(),
    'build',
    'local-runtime',
    `${process.platform}-${process.arch}`,
  )
}

function findBundle(): LocalRuntimeBundle | null {
  return readBundle(bundleRoot())
}

async function userEnv(): Promise<NodeJS.ProcessEnv> {
  return { ...process.env, ...((await resolveShellEnv()) ?? {}) }
}

function tunnelUrl(): string {
  const { deviceId } = readDeviceIdentity()

  return `${apiUrl().replace(/^http/u, 'ws')}/agent/devices/${encodeURIComponent(deviceId)}/runtime-tunnel`
}

const cliCacheFile = (userId: string) => path.join(dataDir(), 'users', userId, 'cli.json')

type CliCache = Partial<Record<LocalAgentProvider, AgentCliStatus>>

function readCliCache(userId: string): CliCache {
  try {
    return JSON.parse(readFileSync(cliCacheFile(userId), 'utf8')) as CliCache
  } catch {
    return {}
  }
}

function writeCliCache(userId: string, cli: CliCache): void {
  try {
    mkdirSync(path.dirname(cliCacheFile(userId)), { recursive: true })
    writeFileSync(cliCacheFile(userId), JSON.stringify(cli), { mode: 0o600 })
  } catch {
    // Only a head start for the next launch.
  }
}

function broadcastState(): void {
  const state = getLocalRuntimeState()

  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('localRuntime:state', state)
}

const controller: LocalRuntimeController = new LocalRuntimeController({
  bundle: findBundle,
  dataDir,
  nodeExecPath: process.execPath,
  get backendUrl() {
    return apiUrl()
  },
  userEnv,
  probeCli: probeAgentCli,
  readUsage: readAgentUsage,
  readCliCache,
  writeCliCache,
  onChange: broadcastState,
  prepareAgentHome,
  prepareComputerUse,
  registerDevice: () => syncDeviceRegistration(),
  createProcess: () => new OpenabProcess(),
  probeModels: ({ provider, workspace, env, cliPath, agentHome }) => {
    const bundle = findBundle()
    const adapter = bundle?.adapters[provider]

    if (!bundle || !adapter) return Promise.reject(new Error('The local agent is not bundled'))

    return probeLocalModels({
      nodeExecPath: process.execPath,
      adapter: adapter.entry,
      cwd: workspace,
      env: agentEnv({
        provider,
        bundle,
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
        const token = authSession.current()

        if (!token) throw new Error('Not signed in')

        return new WebSocket(tunnelUrl(), {
          headers: {
            authorization: `Bearer ${token}`,
            [CLIENT_VERSION_HEADER]: CLIENT_VERSION_VALUE,
          },
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
  log: logLocalTool,
})

const claudeLogin = new ClaudeLogin({
  changed: broadcastState,
  connected: async () => {
    const state = await controller.refresh(true, ['claude-code'])
    const cli = state.agents['claude-code'].cli

    return cli?.installed === true && cli.loggedIn === true
  },
})

let loginRequest = 0

export async function startLocalClaudeLogin() {
  const userId = controller.state().userId

  if (!userId) throw new Error('Sign in to Nuphos first.')
  const request = ++loginRequest
  const env = await userEnv()

  if (request !== loginRequest) return claudeLogin.state()
  if (controller.state().userId !== userId) throw new Error('Nuphos account changed. Try again.')
  const cliPath = findAgentCli('claude-code', env)
  const userDir = path.join(dataDir(), 'users', userId)
  const agentHome = prepareAgentHome('claude-code', userDir, path.join(userDir, 'workspace'))

  if (!cliPath || !agentHome) throw new Error('Install Claude Code on this computer first.')

  return claudeLogin.start(
    cliPath,
    agentCliEnv({ provider: 'claude-code', env, cliPath, agentHome }),
  )
}

export function cancelLocalClaudeLogin(): void {
  loginRequest += 1
  claudeLogin.cancel()
}

/** The runtime follows the signed-in account: any change of session stops it first. */
export function initLocalRuntime(): void {
  const follow = (token: string | null) => {
    const userId = token ? (unverifiedTokenSubject(token) ?? null) : null

    if (userId !== controller.state().userId) cancelLocalClaudeLogin()
    void controller.setUser(userId)
  }

  authSession.subscribe((next) => {
    follow(next)
  })
  follow(authSession.current())
  if (devBuild())
    watchDevBundle(bundleRoot(), {
      bundle: () => void controller.refresh(true),
      status: broadcastState,
    })
  powerMonitor.on('resume', () => {
    controller.reconnect()
  })
  powerMonitor.on('unlock-screen', () => {
    controller.reconnect()
  })
}

/** Resolves once openab has exited, so quitting never leaves it behind. */
export function stopLocalRuntime(): Promise<void> {
  cancelLocalClaudeLogin()

  return controller.shutdown()
}

export function getLocalRuntimeState(): LocalRuntimeState & {
  deviceId: string
  devBundle?: DevBundleHint
  claudeLogin: ReturnType<ClaudeLogin['state']>
} {
  const bundle = findBundle()
  const incomplete = LOCAL_AGENT_PROVIDERS.some((provider) => !bundle?.adapters[provider])
  const devBundle = devBuild() && incomplete ? devBundleHint(bundleRoot()) : undefined

  return {
    ...controller.state(),
    claudeLogin: claudeLogin.state(),
    deviceId: readDeviceIdentity().deviceId,
    ...(devBundle ? { devBundle } : {}),
  }
}

export async function refreshLocalRuntime(): Promise<LocalRuntimeState> {
  await controller.refresh()

  return getLocalRuntimeState()
}

export async function openLocalRuntimeWorkspace(): Promise<void> {
  const { workspace } = controller.state()

  if (!workspace) return
  mkdirSync(workspace, { recursive: true })
  await shell.openPath(workspace)
}

export function listLocalRuntimeActivity(before?: string): Promise<unknown> {
  const { deviceId } = readDeviceIdentity()
  const query = new URLSearchParams({ limit: '20' })

  if (before) query.set('before', before)

  return callJson(
    'GET',
    `/agent/devices/${encodeURIComponent(deviceId)}/runtime-activity?${query.toString()}`,
  )
}
