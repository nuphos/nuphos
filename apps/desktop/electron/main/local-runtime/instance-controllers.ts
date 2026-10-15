import path from 'node:path'

import { prepareIsolatedAgentHome } from './agent-home.ts'
import { parseInstance, readInstances, writeInstances } from './agent-instances.ts'
import { userDir } from './controller-types.ts'

import type { LocalAgentProvider } from './agent-cli.ts'
import type { AgentInstance } from './agent-instances.ts'
import type { LocalRuntimeControllerDeps, LocalRuntimeState } from './controller-types.ts'
import type { RunningRuntime } from './openab-process.ts'
import type { LocalRuntimeTunnelStatus } from './tunnel-protocol.ts'

type Controller = {
  setUser(userId: string | null): Promise<void>
  shutdown(): Promise<void>
  refresh(restart: boolean): Promise<LocalRuntimeState>
  state(): LocalRuntimeState
  runtime(provider: LocalAgentProvider): RunningRuntime | null
  status(): LocalRuntimeTunnelStatus
}

/** UUID owns the lifecycle; a provider only selects its adapter. No additional device tunnel. */
export class InstanceControllers {
  private readonly entries = new Map<string, { metadata: AgentInstance; controller: Controller }>()
  private readonly deps: LocalRuntimeControllerDeps
  private readonly create: (
    deps: LocalRuntimeControllerDeps,
    provider: LocalAgentProvider,
  ) => Controller
  private readonly changed: () => void
  constructor(
    deps: LocalRuntimeControllerDeps,
    create: InstanceControllers['create'],
    changed: () => void,
  ) {
    this.deps = deps
    this.create = create
    this.changed = changed
  }

  async load(userId: string | null): Promise<void> {
    this.entries.clear()
    if (!userId) return
    for (const metadata of readInstances(userDir(this.deps.dataDir(), userId)))
      this.add(metadata, userId)
    await Promise.all(
      [...this.entries.values()].map(({ controller }) => controller.setUser(userId)),
    )
  }

  shutdown(): Promise<unknown> {
    return Promise.all([...this.entries.values()].map(({ controller }) => controller.shutdown()))
  }

  refresh(restart: boolean): Promise<unknown> {
    return Promise.all(
      [...this.entries.values()].map(({ controller }) => controller.refresh(restart)),
    )
  }

  runtime(instanceId: string, provider: LocalAgentProvider): RunningRuntime | null {
    const entry = this.entries.get(instanceId)

    return entry?.metadata.provider === provider ? entry.controller.runtime(provider) : null
  }

  states(online: boolean) {
    return [...this.entries.values()].map(({ metadata, controller }) => ({
      ...metadata,
      ...controller.state().agents[metadata.provider],
      online: online && controller.runtime(metadata.provider) !== null,
    }))
  }

  status(): NonNullable<LocalRuntimeTunnelStatus['instances']> {
    return [...this.entries.values()].map(({ metadata, controller }) => {
      const cli = controller.state().agents[metadata.provider].cli

      return {
        ...metadata,
        ...controller.status().agents[metadata.provider],
        cli: {
          installed: cli?.installed ?? false,
          loggedIn: cli?.installed ? cli.loggedIn : false,
        },
      }
    })
  }

  private add(metadata: AgentInstance, userId: string): Controller {
    const dir = path.join(this.deps.dataDir(), 'instances', metadata.instanceId)
    const controller = this.create(
      {
        ...this.deps,
        dataDir: () => dir,
        userEnv: async () => ({
          ...(await this.deps.userEnv()),
          CLAUDE_SECURESTORAGE_CONFIG_DIR: userDir(dir, userId, 'claude-home'),
        }),
        prepareAgentHome: prepareIsolatedAgentHome,
        readCliCache: () => ({}),
        writeCliCache: () => {
          /* Each instance probes its own login. */
        },
        registerDevice: async () => {
          /* One parent device owns every instance. */
        },
        createTunnel: () => ({
          start() {
            /* Parent owns tunnel. */
          },
          stop() {
            /* Parent owns tunnel. */
          },
          sendStatus: this.changed,
          reconnectNow() {
            /* Parent owns tunnel. */
          },
        }),
        onChange: this.changed,
      },
      metadata.provider,
    )

    this.entries.set(metadata.instanceId, { metadata, controller })

    return controller
  }

  async request(request: unknown, userId: string | null): Promise<unknown> {
    if (!userId) throw new Error('Sign in to Nuphos first')
    if (!request || typeof request !== 'object') throw new Error('Invalid instance request')
    const body = request as { method?: string }

    if (body.method === 'list')
      return { instances: [...this.entries.values()].map(({ metadata }) => metadata) }
    if (body.method !== 'create') throw new Error('Unsupported instance method')
    const metadata = parseInstance(request)
    const existing = this.entries.get(metadata.instanceId)

    if (existing) {
      if (
        existing.metadata.provider !== metadata.provider ||
        existing.metadata.label !== metadata.label
      )
        throw new Error('Agent instance already exists')

      return { instance: existing.metadata }
    }
    writeInstances(
      userDir(this.deps.dataDir(), userId),
      [...this.entries.values()].map((entry) => entry.metadata).concat(metadata),
    )
    const controller = this.add(metadata, userId)

    await controller.setUser(userId)
    this.changed()

    return { instance: metadata }
  }
}
