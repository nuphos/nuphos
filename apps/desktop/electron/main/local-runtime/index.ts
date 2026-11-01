import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { app, BrowserWindow, powerMonitor, shell } from 'electron'

import { createDockTerminalStream } from '../../agent/dock-terminal.ts'
import { callJson } from '../../agent/http.ts'
import { logLocalTool } from '../../agent/local-exec.ts'
import { apiUrl, deviceRegistrationAllowed } from '../../api-endpoint.ts'
import { authSession } from '../../auth-session.ts'
import { CLIENT_VERSION_HEADER, CLIENT_VERSION_VALUE } from '../../client-version.ts'
import { resolveShellEnv } from '../../shell-env.ts'
import { syncDeviceRegistration } from '../device-controller.ts'
import { readDeviceIdentity } from '../device-identity.ts'
import { readDeviceMetrics } from '../device-metrics.ts'
import { isDev } from '../env.ts'

import { LOCAL_AGENT_PROVIDERS, findAgentCli, probeAgentCli, readAgentUsage } from './agent-cli.ts'
import { prepareAgentHome } from './agent-home.ts'
import { LocalAgentLogin } from './agent-login.ts'
import { localFileConnectors } from './attachment-stream.ts'
import { browserStreams } from './browser-streams.ts'
import { readCliCache, writeCliCache } from './cli-cache.ts'
import { agentCliEnv, agentEnv, readBundle } from './config.ts'
import { LocalRuntimeController } from './controller.ts'
import { localToolStreams } from './cua-stream.ts'
import { devBundleHint, watchDevBundle } from './dev-bundle.ts'
import { tunnelUrlFor } from './device-credential.ts'
import { macScreenApp } from './mac-screen-app.ts'
import { probeLocalModels } from './model-probe.ts'
import { OpenabProcess } from './openab-process.ts'
import * as sleep from './sleep-prevention-electron.ts'
import { RuntimeTunnelClient } from './tunnel-client.ts'

import type { AccountContext } from '../../auth-session.ts'
import type { LocalRuntimeBundle } from './config.ts'
import type { LocalRuntimeState, LocalRuntimeViewState } from './controller-types.ts'

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

const findBundle = (): LocalRuntimeBundle | null => readBundle(bundleRoot())

export async function userEnv(): Promise<NodeJS.ProcessEnv> {
  return { ...process.env, ...((await resolveShellEnv()) ?? {}) }
}

function broadcastState(): void {
  const state = getLocalRuntimeState()

  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('localRuntime:state', state)
}

// On a Mac, its owner can watch the Mac's own screen (mac-screen.ts).
const macScreen = macScreenApp(dataDir(), bundleRoot, () => tunnel?.sendStatus())
let tunnel: RuntimeTunnelClient | undefined

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
  readCliCache: (userId) => readCliCache(dataDir(), userId),
  writeCliCache: (userId, cli) => writeCliCache(dataDir(), userId, cli),
  onChange: broadcastState,
  prepareAgentHome,
  registerDevice: () => syncDeviceRegistration(),
  createProcess: () => new OpenabProcess(),
  probeModels: ({ provider, workspace, env, cliPath, agentHome }) => {
    const bundle = findBundle()
    const adapter = bundle?.adapters[provider]

    if (!bundle || !adapter) return Promise.reject(new Error('The local runtime is not bundled'))

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
  createTunnel: (runtime, status, onChange, instances) => {
    tunnel = new RuntimeTunnelClient({
      instances,
      sampleMetrics: readDeviceMetrics,
      activity: sleep.taskActivity,
      connectBackend: (reclaim) => {
        if (!deviceRegistrationAllowed(isDev))
          throw new Error('Development builds do not register computers with Nuphos Cloud')
        const { api, token } = authSession.context()

        if (!token) throw new Error('Not signed in')

        const url = tunnelUrlFor(api, readDeviceIdentity().deviceId, reclaim)

        return new WebSocket(url.replace(/^http/u, 'ws'), {
          headers: {
            authorization: `Bearer ${token}`,
            [CLIENT_VERSION_HEADER]: CLIENT_VERSION_VALUE,
          },
        })
      },
      ...localFileConnectors(() => controller.state(), bundleRoot()),
      ...localToolStreams,
      ...browserStreams,
      connectTerminal: createDockTerminalStream,
      connectRuntime: (purpose, provider, instanceId) => {
        const running = runtime(provider, instanceId)

        if (!running) return null
        const key = purpose === 'control' ? running.controlKey : running.authKey

        return new WebSocket(`ws://127.0.0.1:${String(running.port)}/acp`, [
          `openab.bearer.${key}`,
          'acp.v1',
        ])
      },
      status,
      onChange,
      ...macScreen.deps(status, () => controller.state().userId, instances),
    })

    return tunnel
  },
  log: logLocalTool,
})

/** This app's own sign-in, for the agents it can run a CLI login for; others sign in from Nuphos. */
type CliLoginProvider = 'claude-code' | 'codex'

const logins = Object.fromEntries(
  (['claude-code', 'codex'] as const).map((provider) => [
    provider,
    new LocalAgentLogin({
      provider,
      changed: broadcastState,
      connected: async () => {
        const state = await controller.refresh(true, [provider])
        const cli = state.agents[provider].cli

        return cli?.installed === true && cli.loggedIn === true
      },
    }),
  ]),
) as Record<CliLoginProvider, LocalAgentLogin>

let loginRequest = 0

async function startLocalLogin(provider: CliLoginProvider) {
  const userId = controller.state().userId

  if (!userId) throw new Error('Sign in to Nuphos first.')
  const request = ++loginRequest
  const env = await userEnv()
  const login = logins[provider]

  if (request !== loginRequest) return login.state()
  if (controller.state().userId !== userId) throw new Error('Nuphos account changed. Try again.')
  const cliPath = findAgentCli(provider, env)
  const userDir = path.join(dataDir(), 'users', userId)
  const agentHome =
    provider === 'codex'
      ? (env.CODEX_HOME ?? path.join(env.HOME ?? app.getPath('home'), '.codex'))
      : prepareAgentHome(provider, userDir, path.join(userDir, 'workspace'))

  if (!cliPath || !agentHome) throw new Error('Install the runtime on this computer first.')

  mkdirSync(agentHome, { recursive: true, mode: 0o700 })

  return login.start(cliPath, agentCliEnv({ provider, env, cliPath, agentHome }))
}

export const submitLocalClaudeLoginCode = (code: unknown) => logins['claude-code'].submitCode(code)

export const startLocalClaudeLogin = () => startLocalLogin('claude-code')
export const startLocalCodexLogin = () => startLocalLogin('codex')

export function cancelLocalClaudeLogin(): void {
  loginRequest += 1
  logins['claude-code'].cancel()
}

export function cancelLocalCodexLogin(): void {
  loginRequest += 1
  logins.codex.cancel()
}

/** The runtime follows the signed-in account: any change of session stops it first. */
export function initLocalRuntime(): void {
  sleep.initSleepPrevention(broadcastState)
  // A new backend always comes with a new session, so this one subscription
  // also follows the endpoint.
  const follow = (account: Pick<AccountContext, 'token' | 'userId'>) => {
    const userId = account.token && deviceRegistrationAllowed(isDev) ? account.userId : null

    if (userId !== controller.state().userId) {
      cancelLocalClaudeLogin()
      cancelLocalCodexLogin()
    }
    void controller.setUser(userId)
  }

  authSession.subscribe(follow)
  follow(authSession.context())
  if (devBuild())
    watchDevBundle(bundleRoot(), {
      bundle: () => void controller.refresh(true),
      status: broadcastState,
    })
  powerMonitor.on('resume', () => {
    broadcastState()
    controller.reconnect()
  })
  powerMonitor.on('unlock-screen', () => {
    controller.reconnect()
  })
}

export function stopLocalRuntime(): Promise<void> {
  sleep.stopSleepPrevention()
  cancelLocalClaudeLogin()
  cancelLocalCodexLogin()

  return controller.shutdown()
}

export function getLocalRuntimeState(): LocalRuntimeViewState {
  const bundle = findBundle()
  const incomplete = LOCAL_AGENT_PROVIDERS.some((provider) => !bundle?.adapters[provider])
  const devBundle = devBuild() && incomplete ? devBundleHint(bundleRoot()) : undefined

  return {
    ...controller.state(),
    sleepPrevention: sleep.sleepState(),
    claudeLogin: logins['claude-code'].state(),
    codexLogin: logins.codex.state(),
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
