import { LOCAL_AGENT_PROVIDERS } from './agent-cli.ts'
import {
  freshAgent,
  HEALTHY_AFTER_MS,
  AGENT_HOME_UNAVAILABLE,
  INSTALL_HINT,
  RESTART_BACKOFF_MS,
  agentStatesOf,
  saveCli,
  tunnelStatusOf,
  userDir,
} from './controller-types.ts'
import { createUsageSampler } from './usage-sampler.ts'

import type { LocalAgentProvider } from './agent-cli.ts'
import type {
  Agent,
  LocalRuntimeControllerDeps,
  LocalRuntimeState,
  RuntimeTunnel,
} from './controller-types.ts'

/**
 * Owns this computer's agents for the signed-in user: an open tunnel, one openab per installed
 * CLI, all state keyed to that user and torn down on any change of account.
 */
export class LocalRuntimeController {
  private userId: string | null = null
  private readonly agents: Record<LocalAgentProvider, Agent> = {
    'claude-code': freshAgent(),
    codex: freshAgent(),
  }
  private tunnel: RuntimeTunnel | undefined
  private readonly usage: ReturnType<typeof createUsageSampler>
  private online = false
  private superseded = false
  private readonly deps: LocalRuntimeControllerDeps

  constructor(deps: LocalRuntimeControllerDeps) {
    this.deps = deps
    this.usage = createUsageSampler(this.agents, deps, () => this.tunnel?.sendStatus())
  }

  state(): LocalRuntimeState {
    const bundle = this.deps.bundle()
    const userId = this.userId

    return {
      agents: agentStatesOf(this.agents, {
        available: (provider) => bundle?.adapters[provider] !== undefined,
        online: this.online,
        superseded: this.superseded,
      }),
      workspace: userId ? userDir(this.deps.dataDir(), userId, 'workspace') : null,
      userId,
    }
  }

  /** Called on every auth change; null means signed out. */
  async setUser(userId: string | null): Promise<void> {
    if (userId === this.userId) return
    await this.shutdown()
    this.userId = userId
    const cached = userId ? this.deps.readCliCache(userId) : {}

    for (const provider of LOCAL_AGENT_PROVIDERS)
      this.agents[provider].cli = cached[provider] ?? null
    this.changed()
    if (!userId) return
    const launches = Promise.all(LOCAL_AGENT_PROVIDERS.map((provider) => this.launch(provider)))

    await this.deps.registerDevice().catch(() => {})
    if (userId === this.userId) this.openTunnel()
    await launches
  }

  /** Re-reads each CLI, e.g. after a terminal sign-in; `restart` relaunches running agents too. */
  async refresh(restart = false): Promise<LocalRuntimeState> {
    const env = await this.deps.userEnv()

    await Promise.all(
      LOCAL_AGENT_PROVIDERS.map(async (provider) => {
        this.agents[provider].cli = await this.deps.probeCli(provider, env)
      }),
    )
    saveCli(this.deps, this.userId, this.agents)
    this.tunnel?.sendStatus()
    this.changed()
    await Promise.all(
      LOCAL_AGENT_PROVIDERS.filter((provider) => restart || !this.agents[provider].process).map(
        (provider) => this.launch(provider),
      ),
    )
    // After the launches, never before: `launch` stops the agent first, and a
    // read in flight across that bump is thrown away as stale. An agent that
    // was just started has already sampled, and the floor skips these.
    await Promise.all(LOCAL_AGENT_PROVIDERS.map((provider) => this.usage.sample(provider, true)))

    return this.state()
  }

  /** The network may have changed under a sleeping computer: dial now rather than after backoff. */
  reconnect(): void {
    this.tunnel?.reconnectNow()
  }

  async shutdown(): Promise<void> {
    this.usage.stop()
    this.tunnel?.stop()
    this.tunnel = undefined
    this.online = false
    this.superseded = false
    await Promise.all(LOCAL_AGENT_PROVIDERS.map((provider) => this.stopAgent(provider)))
  }

  private changed(): void {
    this.deps.onChange?.()
  }

  private async stopAgent(provider: LocalAgentProvider): Promise<void> {
    const agent = this.agents[provider]

    agent.generation += 1
    clearTimeout(agent.restartTimer)
    agent.runtime = null
    agent.models = undefined
    agent.error = undefined
    const process = agent.process

    agent.process = undefined
    this.tunnel?.sendStatus()
    this.changed()
    await process?.stop()
  }

  private openTunnel(): void {
    this.tunnel ??= this.deps.createTunnel(
      (provider) => this.agents[provider].runtime,
      () => tunnelStatusOf(this.agents, this.deps.backendUrl),
      (connected, superseded) => {
        this.online = connected
        this.superseded = superseded
        this.changed()
      },
    )
    this.tunnel.start()
  }

  private async launch(provider: LocalAgentProvider): Promise<void> {
    const userId = this.userId

    if (!userId) return
    await this.stopAgent(provider)
    const agent = this.agents[provider]
    const generation = agent.generation
    const current = () => generation === agent.generation && userId === this.userId
    const adapter = this.deps.bundle()?.adapters[provider]

    if (!adapter) {
      agent.error = 'This build of Nuphos does not include this local agent for this computer.'

      return
    }
    const env = await this.deps.userEnv()

    const probedAt = Date.now()

    agent.cli = await this.deps.probeCli(provider, env)
    if (!current()) return
    this.deps.log?.('local agent: CLI checked', { provider, ms: Date.now() - probedAt })
    saveCli(this.deps, this.userId, this.agents)
    this.changed()
    if (!agent.cli.installed) {
      agent.error = INSTALL_HINT[provider]
      this.changed()

      return
    }
    const agentHome = this.deps.prepareAgentHome(
      provider,
      userDir(this.deps.dataDir(), userId),
      userDir(this.deps.dataDir(), userId, 'workspace'),
    )

    if (!agentHome) {
      agent.error = AGENT_HOME_UNAVAILABLE[provider]

      return
    }

    await this.startProcess({
      provider,
      userId,
      cliPath: agent.cli.path,
      env,
      current,
      agentHome,
    })
  }

  private async startProcess(run: {
    provider: LocalAgentProvider
    userId: string
    cliPath: string
    agentHome: string
    env: NodeJS.ProcessEnv
    current: () => boolean
  }): Promise<void> {
    const agent = this.agents[run.provider]
    const bundle = this.deps.bundle()
    const adapter = bundle?.adapters[run.provider]

    if (!bundle || !adapter) return
    const process = this.deps.createProcess()
    const workspace = userDir(this.deps.dataDir(), run.userId, 'workspace')

    agent.process = process
    let startedAt = 0
    const launchedAt = Date.now()

    try {
      agent.runtime = await process.start({
        provider: run.provider,
        bundle,
        adapter,
        nodeExecPath: this.deps.nodeExecPath,
        cliPath: run.cliPath,
        agentHome: run.agentHome,
        workspace,
        openabHome: userDir(this.deps.dataDir(), run.userId, `openab-home-${run.provider}`),
        logDir: userDir(this.deps.dataDir(), run.userId, run.provider),
        env: run.env,
      })
      startedAt = Date.now()
      this.deps.log?.('local agent: openab up', {
        provider: run.provider,
        ms: startedAt - launchedAt,
      })
    } catch (error) {
      this.deps.log?.('local agent: openab failed', {
        provider: run.provider,
        error: String(error),
      })
    }
    if (!run.current()) {
      await process.stop()

      return
    }
    if (!agent.runtime) {
      this.scheduleRestart(run)

      return
    }
    agent.error = undefined
    this.tunnel?.sendStatus()
    this.changed()
    void this.usage.sample(run.provider)
    void this.deps
      .probeModels({
        provider: run.provider,
        workspace,
        env: run.env,
        cliPath: run.cliPath,
        agentHome: run.agentHome,
      })
      .then(
        (models) => {
          if (!run.current()) return
          agent.models = models
          this.tunnel?.sendStatus()
        },
        (error: unknown) => {
          this.deps.log?.('local agent: model discovery failed', {
            provider: run.provider,
            error: String(error),
          })
        },
      )
    process.onExit((code) => {
      if (!run.current() || agent.process !== process) return
      this.deps.log?.('local agent: openab exited', { provider: run.provider, code })
      agent.runtime = null
      this.tunnel?.sendStatus()
      this.changed()
      if (Date.now() - startedAt > HEALTHY_AFTER_MS) agent.restartAttempt = 0
      this.scheduleRestart(run)
    })
  }

  private scheduleRestart(run: Parameters<LocalRuntimeController['startProcess']>[0]): void {
    const agent = this.agents[run.provider]
    const delay = RESTART_BACKOFF_MS[Math.min(agent.restartAttempt, RESTART_BACKOFF_MS.length - 1)]

    agent.restartAttempt += 1
    agent.restartTimer = setTimeout(() => {
      if (run.current()) void this.startProcess(run)
    }, delay)
  }
}
