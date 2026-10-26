import { createHmac } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { envValue } from './agent-cli-apps.ts'
import { LOCAL_AGENT_PROVIDERS, shimEnv } from './providers.ts'

import type { LocalAgentProvider } from './providers.ts'

export type LocalAgentAdapter = {
  /** The adapter's ACP entry point, run on Electron's own Node. */
  entry: string
  /** nuphos-runtime's stdio bridge to the Nuphos MCP endpoints. */
  bridge: string
  version: string
}

export type LocalRuntimeBundle = {
  root: string
  openab: string
  adapters: Partial<Record<LocalAgentProvider, LocalAgentAdapter>>
  openabCommit?: string
}

export type LocalRuntimeLaunch = {
  provider: LocalAgentProvider
  bundle: LocalRuntimeBundle
  adapter: LocalAgentAdapter
  /** The Electron binary; runs the adapter and the MCP bridge as Node. */
  nodeExecPath: string
  /** The user's own `claude` or `codex`. */
  cliPath: string
  /** A home of Nuphos's own that keeps only the user's login, so their personal config stays out. */
  agentHome: string
  workspace: string
  openabHome: string
  port: number
  authKey: string
  /** The user's own login environment, filtered to what a coding agent needs. */
  env: NodeJS.ProcessEnv
  /** A machine Nuphos made (a Box, a managed runtime's pod), never a person's computer. */
  ownsMachine?: boolean
}

const AGENT_ENV_PASSTHROUGH = [
  'HOME',
  'PATH',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LC_ALL',
  'TMPDIR',
  'TERM',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  'https_proxy',
  'http_proxy',
  'no_proxy',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'SystemRoot',
  'ComSpec',
  'PATHEXT',
  // A Linux Box with a desktop pool: the adapter adds a per-session nuphos-desktop server.
  'NUPHOS_DESKTOP_SESSION',
  'NUPHOS_DESKTOP_POOL',
  'NUPHOS_DESKTOP_POOL_SIZE',
]

/** Must match `deriveRuntimeControlKey` in the backend and `nuphos-runtime-start`. */
export function deriveControlKey(authKey: string): string {
  return createHmac('sha256', authKey).update('nuphos-runtime-control-v1').digest('hex')
}

function tomlString(value: string): string {
  return JSON.stringify(value)
}

type AgentCliLaunch = Pick<LocalRuntimeLaunch, 'provider' | 'cliPath' | 'agentHome' | 'env'>

/** Nuphos sessions run as the team's agent, never with the owner's personal config or connectors. */
function providerEnv(launch: AgentCliLaunch): Record<string, string> {
  if (launch.provider === 'codex')
    return { CODEX_PATH: launch.cliPath, CODEX_HOME: launch.agentHome }
  if (launch.provider === 'grok' || launch.provider === 'opencode')
    return shimEnv(launch.cliPath, launch.agentHome)

  return {
    CLAUDE_CODE_EXECUTABLE: launch.cliPath,
    CLAUDE_CONFIG_DIR: launch.agentHome,
    // On macOS reuse the terminal's Keychain entry, without loading its settings.
    // Claude uses the unsuffixed default entry when this value is empty.
    CLAUDE_SECURESTORAGE_CONFIG_DIR:
      process.platform === 'darwin'
        ? (launch.env.CLAUDE_SECURESTORAGE_CONFIG_DIR ?? launch.env.CLAUDE_CONFIG_DIR ?? '')
        : launch.agentHome,
    ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
  }
}

/** The same filtered login environment for status probes and the running adapter. */
export function agentCliEnv(launch: AgentCliLaunch): Record<string, string> {
  const passthrough = Object.fromEntries(
    AGENT_ENV_PASSTHROUGH.flatMap((key) => {
      // A copied Windows environment keeps its own casing, such as Path.
      const value = envValue(launch.env, key)

      return value ? [[key, value]] : []
    }),
  )

  return {
    ...passthrough,
    ...providerEnv(launch),
    ELECTRON_RUN_AS_NODE: '1',
  }
}

export function agentEnv(launch: LocalRuntimeLaunch): Record<string, string> {
  return {
    ...agentCliEnv(launch),
    MCP_TOOL_TIMEOUT: '1800000',
    MCP_TIMEOUT: '30000',
    NUPHOS_MCP_BRIDGE: launch.adapter.bridge,
    NUPHOS_CUA_PERMISSION_CLIENT: path.join(launch.bundle.root, 'cua-permission'),
    NUPHOS_RUNTIME_WORKSPACE: launch.workspace,
  }
}

export function openabConfigToml(launch: LocalRuntimeLaunch): string {
  return [
    '[agent]',
    `command = ${tomlString(launch.nodeExecPath)}`,
    `args = [${tomlString(launch.adapter.entry)}]`,
    `working_dir = ${tomlString(launch.workspace)}`,
    '',
    '[agent.env]',
    ...Object.entries(agentEnv(launch)).map(([key, value]) => `${key} = ${tomlString(value)}`),
    '',
    // Each idle agent holds about 200–300 MB, so it exits after an hour instead of
    // openab's default four; its next prompt cold-starts it with session/load.
    '[pool]',
    'session_ttl_hours = 1',
    '',
  ].join('\n')
}

/**
 * The agent's own sign-in, run by openab when Nuphos asks (the same dialog as a
 * cloud agent). openab's child inherits openab's env, so this carries only the
 * command and the provider's config-dir variables, so the login lands in the
 * runtime's own login. `OPENAB_RUNTIME_LOGIN_COMMAND` is whitespace-split argv, so
 * a CLI path with a space cannot be expressed; such a computer keeps signing in
 * from its own UI.
 */
export function agentLoginEnv(launch: LocalRuntimeLaunch): Record<string, string> {
  const name = launch.provider === 'claude-code' ? 'claude' : launch.provider
  const wrapper = path.join(launch.bundle.root, `${name}-login.mjs`)
  const cliEnv = agentCliEnv(launch)

  if (!existsSync(wrapper) || /\s/u.test(launch.nodeExecPath + wrapper)) return {}
  // openab's own HOME is isolated; a macOS login still needs the user's Keychain.
  const home = launch.env.HOME ?? ''

  if (process.platform === 'darwin' && (!home || /\s/u.test(home))) return {}
  const prefix =
    process.platform === 'darwin' ? ['/usr/bin/env', `HOME=${home}`, `USERPROFILE=${home}`] : []

  return {
    ...cliEnv,
    ...(launch.provider === 'codex'
      ? { CODEX_EXECUTABLE: launch.cliPath, NUPHOS_CODEX_AUTH_DIRECTORY: launch.agentHome }
      : {}),
    OPENAB_RUNTIME_LOGIN_COMMAND: [
      ...prefix,
      launch.nodeExecPath,
      wrapper,
      ...(launch.provider === 'codex' ? ['--install'] : []),
    ].join(' '),
  }
}

/** The agent's own sign-in command: Claude's browser flow, Codex's device flow. */
export function agentSignInArgs(provider: 'claude-code' | 'codex'): string[] {
  return provider === 'codex'
    ? ['-c', 'cli_auth_credentials_store="file"', 'login', '--device-auth']
    : ['auth', 'login', '--claudeai']
}

/** openab listens on loopback only; the backend reaches it through the desktop's tunnel. */
export function openabEnv(launch: LocalRuntimeLaunch): Record<string, string> {
  return {
    ...agentLoginEnv(launch),
    PATH: launch.env.PATH ?? process.env.PATH ?? '',
    ...(launch.env.USER ? { USER: launch.env.USER } : {}),
    ...(launch.env.SystemRoot ? { SystemRoot: launch.env.SystemRoot } : {}),
    // openab keeps its thread map under $HOME/.openab. The adapter starts with
    // the real HOME for agent login, then isolates each session's tool HOME.
    HOME: launch.openabHome,
    USERPROFILE: launch.openabHome,
    RUST_LOG: 'info',
    GATEWAY_LISTEN: `127.0.0.1:${String(launch.port)}`,
    GATEWAY_ALLOWED_USERS: 'acp_client',
    OPENAB_ACP_ENABLED: 'true',
    OPENAB_RUNTIME_TERMINAL_CWD: launch.workspace,
    OPENAB_RUNTIME_TERMINAL_HOME: launch.agentHome,
    OPENAB_ACP_MCP_SERVERS: 'true',
    OPENAB_ACP_STREAMING: 'true',
    OPENAB_ACP_AUTH_KEY: launch.authKey,
    OPENAB_ACP_CONTROL_KEY: deriveControlKey(launch.authKey),
    OPENAB_ADAPTER_VERSION: launch.adapter.version,
    OPENAB_RUNTIME_LABEL: 'Nuphos Desktop',
    ...(launch.bundle.openabCommit ? { OPENAB_BUILD_SHA: launch.bundle.openabCommit } : {}),
    ...runtimeJobs(launch),
  }
}

/**
 * The jobs this runtime offers. Everywhere: the backend's fixed attachment program, bundled,
 * so a turn's files arrive as a list of signed URLs and no program text crosses the wire. On a
 * machine Nuphos made, also `panel`, which runs the script the backend sends, as the runtime
 * image does; never on a person's computer. openab clears a job's environment and splits its
 * command on whitespace, so Electron's run-as-Node switch rides in through `env`. A job that
 * cannot run that way is left out, and the backend reports the runtime as unable to do it.
 */
function runtimeJobs(launch: LocalRuntimeLaunch): Record<string, string> {
  const program = (file: string) => path.join(launch.bundle.root, file)
  const job = (name: string, ...args: string[]) => ({
    name,
    argv: ['/usr/bin/env', 'ELECTRON_RUN_AS_NODE=1', launch.nodeExecPath, ...args],
    program: args.at(-1) ?? '',
  })
  const jobs = [
    job('attachments', program('attachment-job.mjs')),
    ...(launch.ownsMachine
      ? [job('panel', '--max-old-space-size=512', program('panel-job.mjs'))]
      : []),
  ].filter(({ argv, program }) => !argv.some((arg) => /\s/.test(arg)) && existsSync(program))

  if (process.platform === 'win32' || jobs.length === 0) return {}

  return {
    OPENAB_RUNTIME_JOBS: jobs.map(({ name, argv }) => `${name}=${argv.join(' ')}`).join(';'),
    // The dashboard panel execution budget, as in the runtime image.
    ...(jobs.some(({ name }) => name === 'panel')
      ? { OPENAB_RUNTIME_JOB_MAX_TIMEOUT_MS: '300000' }
      : {}),
  }
}

type Manifest = {
  openab?: unknown
  openabCommit?: unknown
  adapters?: Record<string, { entry?: unknown; version?: unknown } | undefined>
}

export function bundleFromManifest(root: string, manifest: Manifest): LocalRuntimeBundle | null {
  if (typeof manifest.openab !== 'string') return null
  const adapters: LocalRuntimeBundle['adapters'] = {}

  for (const provider of LOCAL_AGENT_PROVIDERS) {
    const adapter = manifest.adapters?.[provider]

    if (typeof adapter?.entry !== 'string' || typeof adapter.version !== 'string') continue
    const dir = path.join(root, 'adapters', provider)

    adapters[provider] = {
      entry: path.join(dir, adapter.entry),
      bridge: path.join(dir, 'mcp-http-bridge.mjs'),
      version: adapter.version,
    }
  }

  return {
    root,
    openab: path.join(root, manifest.openab),
    adapters,
    ...(typeof manifest.openabCommit === 'string' ? { openabCommit: manifest.openabCommit } : {}),
  }
}

/** The bundle staged at `root`, less any adapter whose files are missing; null without openab. */
export function readBundle(root: string): LocalRuntimeBundle | null {
  try {
    const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8')) as Manifest
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
