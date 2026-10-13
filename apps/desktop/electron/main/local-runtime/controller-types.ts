import path from 'node:path'

import { LOCAL_AGENT_PROVIDERS } from './agent-cli.ts'

import type { AgentCliStatus, LocalAgentProvider } from './agent-cli.ts'
import type { LocalRuntimeBundle } from './config.ts'
import type { LocalModelCatalog } from './model-probe.ts'
import type { OpenabProcessOptions, RunningRuntime } from './openab-process.ts'
import type { LocalRuntimeTunnelStatus } from './tunnel-client.ts'

export type LocalAgentState = {
  /** This build ships the agent for this platform. */
  available: boolean
  /** Its owner can use it from Nuphos right now. */
  online: boolean
  /** Why it cannot come online on its own; absent while it is on its way. */
  error?: string
  cli: AgentCliStatus | null
}

export type LocalRuntimeState = {
  agents: Record<LocalAgentProvider, LocalAgentState>
  workspace: string | null
  /** Who this computer's agents belong to right now. */
  userId: string | null
}

export type RuntimeProcess = {
  start(options: OpenabProcessOptions): Promise<RunningRuntime>
  stop(): Promise<void>
  onExit(listener: (code: number | null) => void): () => void
}

export type RuntimeTunnel = {
  start(): void
  stop(): void
  sendStatus(): void
  reconnectNow(): void
}

export type ProbeModelsRun = {
  provider: LocalAgentProvider
  workspace: string
  env: NodeJS.ProcessEnv
  cliPath: string
  agentHome: string
}

export type LocalRuntimeControllerDeps = {
  bundle: () => LocalRuntimeBundle | null
  dataDir: () => string
  nodeExecPath: string
  /** Where this app reaches Nuphos; the agents on this computer use the same address. */
  backendUrl: string
  userEnv: () => Promise<NodeJS.ProcessEnv>
  probeCli: (
    provider: LocalAgentProvider,
    env: NodeJS.ProcessEnv,
    agentHome: string | undefined,
  ) => Promise<AgentCliStatus>
  /** Asks the provider what is left of this computer's account; undefined when
   *  it cannot say, which leaves the last reading in place. */
  readUsage: (provider: LocalAgentProvider, env: NodeJS.ProcessEnv) => Promise<unknown>
  /** The last probe per provider, so a restart shows the agents before the CLIs answer again. */
  readCliCache: (userId: string) => Partial<Record<LocalAgentProvider, AgentCliStatus>>
  writeCliCache: (userId: string, cli: Partial<Record<LocalAgentProvider, AgentCliStatus>>) => void
  /** Anything in `state()` changed. */
  onChange?: () => void
  /** A home holding only the user's login; undefined when it cannot be made. */
  prepareAgentHome: (
    provider: LocalAgentProvider,
    userDir: string,
    workspace: string,
    env: NodeJS.ProcessEnv,
  ) => string | undefined
  /** Makes sure the backend knows this device before its tunnel connects. */
  registerDevice: () => Promise<void>
  createProcess: () => RuntimeProcess
  /** Asks an adapter which models it offers, without starting a conversation. */
  probeModels: (run: ProbeModelsRun) => Promise<LocalModelCatalog>
  createTunnel: (
    runtime: (provider: LocalAgentProvider) => RunningRuntime | null,
    status: () => LocalRuntimeTunnelStatus,
    onChange: (connected: boolean, superseded: boolean) => void,
  ) => RuntimeTunnel
  log?: (message: string, data?: Record<string, unknown>) => void
}

export type Agent = {
  process?: RuntimeProcess
  runtime: RunningRuntime | null
  cli: AgentCliStatus | null
  /** The provider's own usage body, kept across a refusal until a newer one
   *  arrives, with the instant this computer read it. */
  usage?: unknown
  usageAt?: string
  models?: LocalModelCatalog
  error?: string
  restartAttempt: number
  restartTimer?: ReturnType<typeof setTimeout>
  generation: number
}

/** Everything a user's local agents keep lives under their own directory. */
export function userDir(dataDir: string, userId: string, ...parts: string[]): string {
  return path.join(dataDir, 'users', userId, ...parts)
}

/** The CLI facts worth keeping for the next launch, under the owner's id. */
export function saveCli(
  deps: Pick<LocalRuntimeControllerDeps, 'writeCliCache'>,
  userId: string | null,
  agents: Record<LocalAgentProvider, Agent>,
): void {
  if (userId) deps.writeCliCache(userId, knownCli(agents))
}

export const RESTART_BACKOFF_MS = [1_000, 2_000, 5_000, 15_000, 30_000]
/** Matches the hold Nuphos keeps on a provider's answer: sampling faster would
 *  spend this person's rate limit on numbers that have not moved. */
export const USAGE_SAMPLE_MS = 600_000
/** A sign-in is worth reading again for; mashing Check is not. */
export const USAGE_SIGN_IN_FLOOR_MS = 30_000
export const HEALTHY_AFTER_MS = 60_000
/** An agent never serves Nuphos from the owner's own home, where their personal config lives. */
export const AGENT_HOME_UNAVAILABLE: Record<LocalAgentProvider, string> = {
  'claude-code': 'Nuphos could not prepare a separate Claude Code home on this computer.',
  codex: 'Sign in to Codex on this computer with `codex login`, then check again.',
}

export const INSTALL_HINT: Record<LocalAgentProvider, string> = {
  'claude-code': 'Install Claude Code on this computer to run it as a local agent.',
  codex: 'Install Codex on this computer to run it as a local agent.',
}

export function freshAgent(): Agent {
  return { runtime: null, cli: null, restartAttempt: 0, generation: 0 }
}

/** What the backend should see: only the agents running right now. */
export function tunnelStatusOf(
  running: Record<LocalAgentProvider, Agent>,
  backendUrl: string,
): LocalRuntimeTunnelStatus {
  const agents: LocalRuntimeTunnelStatus['agents'] = {}

  for (const provider of LOCAL_AGENT_PROVIDERS) {
    const agent = running[provider]

    if (!agent.runtime || !agent.cli?.installed) continue
    agents[provider] = {
      cli: { installed: true, loggedIn: agent.cli.loggedIn },
      ...(agent.usage !== undefined && agent.usageAt
        ? { usage: agent.usage, usageAt: agent.usageAt }
        : {}),
      ...(agent.cli.version ? { version: `${provider} ${agent.cli.version}` } : {}),
      ...(agent.models ? { models: agent.models } : {}),
    }
  }

  return { agents, backendUrl }
}

export function agentStatesOf(
  agents: Record<LocalAgentProvider, Agent>,
  context: {
    available: (provider: LocalAgentProvider) => boolean
    online: boolean
    superseded: boolean
  },
): Record<LocalAgentProvider, LocalAgentState> {
  const entries = LOCAL_AGENT_PROVIDERS.map((provider): [LocalAgentProvider, LocalAgentState] => {
    const agent = agents[provider]
    const error = context.superseded
      ? 'Another Nuphos app on this computer took over the local agent.'
      : agent.error

    return [
      provider,
      {
        available: context.available(provider),
        online: context.online && agent.runtime !== null,
        ...(error ? { error } : {}),
        cli: agent.cli,
      },
    ]
  })

  return Object.fromEntries(entries) as Record<LocalAgentProvider, LocalAgentState>
}

export function knownCli(
  agents: Record<LocalAgentProvider, Agent>,
): Partial<Record<LocalAgentProvider, AgentCliStatus>> {
  return Object.fromEntries(
    LOCAL_AGENT_PROVIDERS.flatMap((provider) => {
      const cli = agents[provider].cli

      return cli ? [[provider, cli]] : []
    }),
  )
}

export type LocalAgentRun = Omit<ProbeModelsRun, 'workspace'> & {
  userId: string
  current: () => boolean
}
