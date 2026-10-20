import { LOCAL_AGENT_PROVIDERS } from './agent-cli.ts'
import { discoverModels } from './agent-models.ts'
import {
  freshAgent,
  HEALTHY_AFTER_MS,
  AGENT_HOME_UNAVAILABLE,
  INSTALL_HINT,
  prepareHomeFor,
  scheduleAgentRestart,
  stopAgentProcess,
  runtimeStateOf,
  saveCli,
  tunnelStatusOf,
  userDir,
} from './controller-types.ts'
import { InstanceControllers } from './instance-controllers.ts'
import { createUsageSampler } from './usage-sampler.ts'

import type { LocalAgentProvider } from './agent-cli.ts'
import type {
  Agent,
  LocalAgentRun,
  LocalRuntimeControllerDeps,
  LocalRuntimeState,
  RuntimeTunnel,
} from './controller-types.ts'

export class LocalRuntimeController {
  private readonly instances?: InstanceControllers
  private userId: string | null = null
  private endpoint: string | undefined
  private switching: Promise<unknown> = Promise.resolve()
  private readonly agents: Record<LocalAgentProvider, Agent> = {
    'claude-code': freshAgent(),
    codex: freshAgent(),
  }
  private tunnel: RuntimeTunnel | undefined
  private readonly usage: ReturnType<typeof createUsageSampler>
  private online = false
  private superseded = false
  private readonly deps: LocalRuntimeControllerDeps
  private readonly providers: readonly LocalAgentProvider[]
  constructor(
    deps: LocalRuntimeControllerDeps,
    providers: readonly LocalAgentProvider[] = LOCAL_AGENT_PROVIDERS,
    isolated = false,
  ) {
    this.providers = providers
    if (!isolated)
      this.instances = new InstanceControllers(
        deps,
        (childDeps, provider) => new LocalRuntimeController(childDeps, [provider], true),
        () => {
          this.changed()
          this.tunnel?.sendStatus()
        },
        { restartDefault: (provider) => this.refresh(true, [provider]) },
      )
    this.deps = deps
    this.usage = createUsageSampler(
      this.agents,
      {
        ...deps,
        agentHome: (provider, env) =>
          this.userId ? prepareHomeFor(this.deps, provider, this.userId, env) : undefined,
      },
      () => this.tunnel?.sendStatus(),
    )
  }
  state(): LocalRuntimeState {
    return runtimeStateOf(
      this.deps,
      this.agents,
      this.online,
      this.superseded,
      this.userId,
      this.instances?.states(this.online),
    )
  }
  /** Follows the (backend, account) pair; switches run in order, so one session is down before the next registers. */
  async setUser(userId: string | null): Promise<void> {
    const switched = this.switching.then(() => this.switchTo(userId))

    this.switching = switched.catch(() => {})
    await Promise.all(await switched)
  }
  private async switchTo(userId: string | null): Promise<Promise<unknown>[]> {
    if (userId === this.userId && this.deps.backendUrl === this.endpoint) return []
    await this.shutdown()
    this.userId = userId
    this.endpoint = this.deps.backendUrl
    const cached = userId ? this.deps.readCliCache(userId) : {}

    for (const provider of LOCAL_AGENT_PROVIDERS)
      this.agents[provider].cli = cached[provider] ?? null
    this.changed()
    await this.instances?.load(userId)
    if (!userId) return []
    const launches = Promise.all(this.providers.map((provider) => this.launch(provider)))

    await this.deps.registerDevice().catch(() => {})
    this.openTunnel()

    return [launches]
  }
  async refresh(
    restart = false,
    providers: readonly LocalAgentProvider[] = this.providers,
  ): Promise<LocalRuntimeState> {
    const userId = this.userId

    if (!userId) return this.state()
    const env = await this.deps.userEnv()

    await Promise.all(
      providers.map(async (provider) => {
        const agentHome = prepareHomeFor(this.deps, provider, userId, env)
        const cli = await this.deps.probeCli(provider, env, agentHome)

        if (userId === this.userId) this.agents[provider].cli = cli
      }),
    )
    if (userId !== this.userId) return this.state()
    saveCli(this.deps, this.userId, this.agents)
    this.tunnel?.sendStatus()
    this.changed()
    await Promise.all(
      providers
        .filter((provider) => restart || !this.agents[provider].process)
        .map((provider) => this.launch(provider)),
    )
    await Promise.all(this.providers.map((provider) => this.usage.sample(provider)))
    await this.instances?.refresh(restart, providers)

    return this.state()
  }
  reconnect(): void {
    this.tunnel?.reconnectNow()
  }
  async shutdown(): Promise<void> {
    this.usage.stop()
    this.tunnel?.stop()
    this.tunnel = undefined
    this.online = false
    this.superseded = false
    await Promise.all(this.providers.map((provider) => this.stopAgent(provider)))
    await this.instances?.shutdown()
  }
  private changed(): void {
    this.deps.onChange?.()
  }
  private stopAgent(provider: LocalAgentProvider): Promise<void> {
    return stopAgentProcess(this.agents[provider], () => {
      this.tunnel?.sendStatus()
      this.changed()
    })
  }
  private openTunnel(): void {
    this.tunnel ??= this.deps.createTunnel(
      (provider, instanceId) =>
        instanceId !== undefined
          ? (this.instances?.runtime(instanceId, provider) ?? null)
          : this.agents[provider].runtime,
      () => ({
        ...this.status(),
        ...(this.instances ? { instances: this.instances.status() } : {}),
      }),
      (connected, superseded) => {
        this.online = connected
        this.superseded = superseded
        this.changed()
      },
      (request) => this.instanceRequest(request),
    )
    this.tunnel.start()
  }

  runtime(provider: LocalAgentProvider) {
    return this.agents[provider].runtime
  }
  status() {
    return tunnelStatusOf(this.agents, this.deps.backendUrl)
  }
  instanceRequest(request: unknown): Promise<unknown> {
    if (!this.instances) return Promise.reject(new Error('Instance management unavailable'))

    return this.instances.request(request, this.userId)
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

    if (!current()) return
    const agentHome = prepareHomeFor(this.deps, provider, userId, env)
    const cli = await this.deps.probeCli(provider, env, agentHome)

    if (!current()) return
    agent.cli = cli
    this.deps.log?.('local agent: CLI checked', { provider, ms: Date.now() - probedAt })
    saveCli(this.deps, this.userId, this.agents)
    this.changed()
    if (!agent.cli.installed) {
      agent.error = INSTALL_HINT[provider]
      this.changed()

      return
    }
    if (!agentHome) {
      agent.error = AGENT_HOME_UNAVAILABLE[provider]

      return
    }

    await this.startProcess({ provider, userId, cliPath: agent.cli.path, env, current, agentHome })
  }
  private async startProcess(run: LocalAgentRun): Promise<void> {
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
      scheduleAgentRestart(agent, run, () => this.startProcess(run))

      return
    }
    agent.error = undefined
    this.tunnel?.sendStatus()
    this.changed()
    void this.usage.sample(run.provider)
    discoverModels(this.deps, run, agent, workspace, () => this.tunnel?.sendStatus())
    process.onExit((code) => {
      if (!run.current() || agent.process !== process) return
      this.deps.log?.('local agent: openab exited', { provider: run.provider, code })
      agent.runtime = null
      this.tunnel?.sendStatus()
      this.changed()
      if (Date.now() - startedAt > HEALTHY_AFTER_MS) agent.restartAttempt = 0
      scheduleAgentRestart(agent, run, () => this.startProcess(run))
    })
  }
}
