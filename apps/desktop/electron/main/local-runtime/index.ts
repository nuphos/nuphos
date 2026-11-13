import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { app, BrowserWindow, powerMonitor, shell } from 'electron'

import { createDockTerminalStream } from '../../agent/dock-terminal.ts'
import { callJson } from '../../agent/http.ts'
import { logLocalTool } from '../../agent/local-exec.ts'
import { apiUrl, deviceRegistrationAllowed } from '../../api-endpoint.ts'
import { authSession } from '../../auth-session.ts'
import { keychainFor } from '../../auth/token-store.ts'
import { dialBackend } from '../../backend-socket.ts'
import { CLIENT_VERSION_HEADER, CLIENT_VERSION_VALUE } from '../../client-version.ts'
import { resolveShellEnv } from '../../shell-env.ts'
import { leftAloneDir } from '../app-paths.ts'
import { syncDeviceRegistration } from '../device-controller.ts'
import { readDeviceIdentity } from '../device-identity.ts'
import { readDeviceMetrics } from '../device-metrics.ts'
import { isDev } from '../env.ts'

import { LOCAL_AGENT_PROVIDERS, probeAgentCli } from './agent-cli.ts'
import { readAgentUsage } from './agent-cli-usage.ts'
import { prepareAgentHome } from './agent-home.ts'
import { localFileConnectors } from './attachment-stream.ts'
import { browserStreams } from './browser-streams.ts'
import { readCliCache, writeCliCache } from './cli-cache.ts'
import { readBundle } from './config.ts'
import {
  PROVIDER_KEYCHAIN_SERVICE,
  readCustomProviders,
  saveCustomProvider,
  withProviderKey,
  withProviderStatus,
} from './custom-provider.ts'
import { LocalRuntimeController } from './controller.ts'
import { localToolStreams } from './cua-stream.ts'
import { devBundleHint, watchDevBundle } from './dev-bundle.ts'
import { tunnelUrlFor } from './device-credential.ts'
import { startDiskMaintenance } from './disk-usage.ts'
import { localLogins } from './local-logins.ts'
import { macScreenApp } from './mac-screen-app.ts'
import { bundledModelProbe } from './model-probe.ts'
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
const providerKeys = keychainFor(PROVIDER_KEYCHAIN_SERVICE)
const ownDir = (userId: string) => path.join(dataDir(), 'users', userId)

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
  probeCli: withProviderStatus(probeAgentCli, providerKeys),
  readUsage: readAgentUsage,
  readCliCache: (userId) => readCliCache(dataDir(), userId),
  writeCliCache: (userId, cli) => writeCliCache(dataDir(), userId, cli),
  onChange: broadcastState,
  prepareAgentHome,
  registerDevice: () => syncDeviceRegistration(),
  createProcess: () => withProviderKey(new OpenabProcess(), providerKeys),
  probeModels: bundledModelProbe(findBundle, providerKeys),
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

        return dialBackend(tunnelUrlFor(api, readDeviceIdentity().deviceId, reclaim), {
          authorization: `Bearer ${token}`,
          [CLIENT_VERSION_HEADER]: CLIENT_VERSION_VALUE,
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

const logins = localLogins({
  changed: broadcastState,
  refresh: (provider) => controller.refresh(true, [provider]),
  userId: () => controller.state().userId,
  userEnv,
  userDir: (userId) => path.join(dataDir(), 'users', userId),
  ownerHome: () => app.getPath('home'),
  bundleRoot,
})

export const submitLocalClaudeLoginCode = (code: unknown) => logins.submitClaudeCode(code)
export const applyLocalApiKey = (provider: unknown, key: unknown) =>
  logins.applyApiKey(provider, key)
export const startLocalClaudeLogin = () => logins.start('claude-code')
export const startLocalCodexLogin = () => logins.start('codex')
export const cancelLocalClaudeLogin = () => logins.cancel('claude-code')
export const cancelLocalCodexLogin = () => logins.cancel('codex')

/** The runtime follows the signed-in account: any change of session stops it first. */
export function initLocalRuntime(): void {
  sleep.initSleepPrevention(broadcastState)
  // One pass on its own, well after launch: a finished session's workspace and the size
  // of what is left are worth knowing, and neither is worth slowing a start for.
  startDiskMaintenance({
    workspaces: () => {
      const state = controller.state()

      return [
        ...(state.workspace ? [state.workspace] : []),
        ...(state.instances ?? []).flatMap((instance) =>
          instance.workspace ? [instance.workspace] : [],
        ),
      ]
    },
    // This computer's agents share a workspace, so while any of them is up, a workspace
    // may be the one a live session is in, and it is kept. Only the backend can name a
    // live session exactly; until then this is the safe side of that answer.
    inUse: () => Object.values(controller.state().agents).some((agent) => agent.online),
    leftAlone: leftAloneDir,
    log: logLocalTool,
  })
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
  const state = controller.state()

  return {
    ...state,
    detectionDisabled: !deviceRegistrationAllowed(isDev),
    sleepPrevention: sleep.sleepState(),
    claudeLogin: logins.state('claude-code'),
    codexLogin: logins.state('codex'),
    deviceId: readDeviceIdentity().deviceId,
    ...(devBundle ? { devBundle } : {}),
    ...(state.userId ? { customProviders: readCustomProviders(ownDir(state.userId)) } : {}),
  }
}

/** Saves this account's provider for one agent, or with null removes it, then restarts it. */
export async function setLocalCustomProvider(
  provider: unknown,
  value: unknown,
): Promise<LocalRuntimeState> {
  const { userId } = controller.state()

  if (!userId) throw new Error('Sign in to Nuphos first.')
  await saveCustomProvider(providerKeys, ownDir(userId), userId, provider, value)
  await controller.refresh(true, [provider === 'codex' ? 'codex' : 'claude-code'])

  return getLocalRuntimeState()
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
