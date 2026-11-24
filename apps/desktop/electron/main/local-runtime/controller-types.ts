import path from 'node:path'

import { LOCAL_AGENT_PROVIDERS } from './agent-cli.ts'

import type { AgentCliStatus, LocalAgentProvider } from './agent-cli.ts'
import type { AgentInstance } from './agent-instances.ts'
import type { LocalAgentLogin } from './agent-login.ts'
import type { LocalRuntimeBundle } from './config.ts'
import type { CustomProvider, CustomProviderAgent } from './custom-provider.ts'
import type { DevBundleHint } from './dev-bundle.ts'
import type { LocalModelCatalog } from './model-probe.ts'
import type { OpenabProcessOptions, RunningRuntime } from './openab-process.ts'
import type { SleepState } from './sleep-prevention.ts'
import type { LocalRuntimeTunnelStatus } from './tunnel-protocol.ts'
import type { LocalConnection } from './tunnel-streams.ts'

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
  instances?: (AgentInstance & LocalAgentState & { workspace: string | null })[]
  agents: Record<LocalAgentProvider, LocalAgentState>
  workspace: string | null
  /** Who this computer's agents belong to right now. */
  userId: string | null
  /** This computer's own connection to Nuphos, while someone is signed in. */
  connection?: LocalConnection
}

/** Desktop IPC contract, including account login and device-local sleep state. */
export type LocalRuntimeViewState = LocalRuntimeState & {
  detectionDisabled?: boolean
  deviceId: string
  sleepPrevention: SleepState
  devBundle?: DevBundleHint
  /** This account's own model providers; the keys stay in the credential store. */
  customProviders?: Partial<Record<CustomProviderAgent, CustomProvider>>
  claudeLogin: ReturnType<LocalAgentLogin['state']>
  codexLogin: ReturnType<LocalAgentLogin['state']>
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
  /** `fresh` reads the shell again instead of reusing what it said when the app started. */
  userEnv: (fresh?: boolean) => Promise<NodeJS.ProcessEnv>
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
    runtime: (provider: LocalAgentProvider, instanceId?: string) => RunningRuntime | null,
    status: () => LocalRuntimeTunnelStatus,
    onChange: (connected: boolean, superseded: boolean, revoked?: boolean) => void,
    instances?: (request: unknown) => Promise<unknown>,
  ) => RuntimeTunnel
  log?: (message: string, data?: Record<string, unknown>) => void
  /** The vendor's installer an added agent missing its CLI runs once; `installAgentCli` unless replaced. */
  installCli?: (provider: LocalAgentProvider, env: NodeJS.ProcessEnv) => Promise<void>
  /** A Box: Nuphos owns the whole computer, so its default agents' logins are Nuphos's
   *  to delete. A person's computer never removes them; their CLIs keep their logins. */
  ownsMachine?: boolean
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
  /** The look for a CLI that was missing, while it runs. */
  recheck?: Promise<void>
  /** A reset holding the agent stopped: nothing starts it before this settles. */
  paused?: Promise<unknown>
  /** The last model read, which runs the agent's CLI on its home. */
  probing?: Promise<unknown>
}

export function userDir(dataDir: string, userId: string, ...parts: string[]): string {
  return path.join(dataDir, 'users', userId, ...parts)
}

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
export const USAGE_SIGN_IN_FLOOR_MS = 30_000
export const HEALTHY_AFTER_MS = 60_000
export function freshAgent(): Agent {
  return { runtime: null, cli: null, restartAttempt: 0, generation: 0 }
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

export function prepareHomeFor(
  deps: LocalRuntimeControllerDeps,
  provider: LocalAgentProvider,
  id: string,
  env: NodeJS.ProcessEnv,
) {
  return deps.prepareAgentHome(
    provider,
    userDir(deps.dataDir(), id),
    userDir(deps.dataDir(), id, 'workspace'),
    env,
  )
}

export function scheduleAgentRestart(
  agent: Agent,
  run: LocalAgentRun,
  start: () => Promise<void>,
): void {
  const delay = RESTART_BACKOFF_MS[Math.min(agent.restartAttempt, RESTART_BACKOFF_MS.length - 1)]

  agent.restartAttempt += 1
  agent.restartTimer = setTimeout(() => {
    if (run.current()) void start()
  }, delay)
}

/**
 * Stops the agent, then runs `work` with it stopped and its CLI no longer running a model read,
 * which could save a login again. Each waits for the one before, so a launch that stops the
 * agent first starts nothing before `work` is done. It stays stopped until the next launch.
 */
export function pauseAgent<T>(
  agent: Agent,
  changed: () => void,
  work?: () => Promise<T> | T,
): Promise<T | undefined> {
  const done = (agent.paused ?? Promise.resolve()).then(async () => {
    await stopAgentProcess(agent, changed)
    if (!work) return undefined
    await agent.probing?.catch(() => {})

    return work()
  })

  agent.paused = done.catch(() => {})

  return done
}

export async function stopAgentProcess(agent: Agent, changed: () => void): Promise<void> {
  agent.generation += 1
  clearTimeout(agent.restartTimer)
  agent.runtime = null
  agent.models = undefined
  agent.error = undefined
  const process = agent.process

  agent.process = undefined
  changed()
  await process?.stop()
}
