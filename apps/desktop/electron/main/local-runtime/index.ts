import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { app, BrowserWindow, powerMonitor, shell } from 'electron'

import { ATLAS_URL, callJson } from '../../agent/http.ts'
import { logLocalTool } from '../../agent/local-exec.ts'
import { authSession } from '../../auth-session.ts'
import { unverifiedTokenSubject } from '../../auth-status.ts'
import { CLIENT_VERSION_HEADER, CLIENT_VERSION_VALUE } from '../../client-version.ts'
import { resolveShellEnv } from '../../shell-env.ts'
import { syncDeviceRegistration } from '../device-controller.ts'
import { readDeviceIdentity } from '../device-identity.ts'

import { LOCAL_AGENT_PROVIDERS, probeAgentCli } from './agent-cli.ts'
import { prepareAgentHome } from './agent-home.ts'
import { agentEnv, bundleFromManifest } from './config.ts'
import { LocalRuntimeController } from './controller.ts'
import { devBundleHint, watchDevBundle } from './dev-bundle.ts'
import { LocalExecStream } from './exec-stream.ts'
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
  const root = bundleRoot()

  try {
    const manifest = JSON.parse(
      readFileSync(path.join(root, 'manifest.json'), 'utf8'),
    ) as Parameters<typeof bundleFromManifest>[1]
    const bundle = bundleFromManifest(root, manifest)

    if (!bundle || !existsSync(bundle.openab)) return null
    for (const provider of LOCAL_AGENT_PROVIDERS) {
      const adapter = bundle.adapters[provider]

      if (adapter && !existsSync(adapter.entry)) delete bundle.adapters[provider]
    }

    return bundle
  } catch {
    return null
  }
}

async function userEnv(): Promise<NodeJS.ProcessEnv> {
  return { ...process.env, ...((await resolveShellEnv()) ?? {}) }
}

function tunnelUrl(): string {
  const { deviceId } = readDeviceIdentity()

  return `${ATLAS_URL.replace(/^http/u, 'ws')}/agent/devices/${encodeURIComponent(deviceId)}/runtime-tunnel`
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

const controller = new LocalRuntimeController({
  bundle: findBundle,
  dataDir,
  nodeExecPath: process.execPath,
  backendUrl: ATLAS_URL,
  userEnv,
  probeCli: probeAgentCli,
  readCliCache,
  writeCliCache,
  onChange: broadcastState,
  prepareAgentHome,
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

/** The runtime follows the signed-in account: any change of session stops it first. */
export function initLocalRuntime(): void {
  const follow = (token: string | null) =>
    void controller.setUser(token ? (unverifiedTokenSubject(token) ?? null) : null)

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
  return controller.shutdown()
}

export function getLocalRuntimeState(): LocalRuntimeState & {
  deviceId: string
  devBundle?: DevBundleHint
} {
  const bundle = findBundle()
  const incomplete = LOCAL_AGENT_PROVIDERS.some((provider) => !bundle?.adapters[provider])
  const devBundle = devBuild() && incomplete ? devBundleHint(bundleRoot()) : undefined

  return {
    ...controller.state(),
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
