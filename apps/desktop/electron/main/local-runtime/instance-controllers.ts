import { rmSync } from 'node:fs'
import path from 'node:path'

import { parseInstance, readInstances, writeInstances } from './agent-instances.ts'
import { deleteClaudeKeychainEntry } from './claude-keychain.ts'
import { removeDefaultAgent } from './default-agent.ts'
import { userDir } from './controller-types.ts'
import { instanceControllerDeps, secureStorageEnv } from './instance-deps.ts'

import type { LocalAgentProvider } from './agent-cli.ts'
import type { AgentInstanceRecord } from './agent-instances.ts'
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

/** A sign-in left unfinished this long is abandoned: its login has long expired. */
export const PENDING_TTL_MS = 20 * 60_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u

type Entry = {
  metadata: AgentInstanceRecord
  controller: Controller
  starting?: Promise<void>
  expiry?: ReturnType<typeof setTimeout>
}

export type InstanceControllersOptions = {
  now?: () => number
  /** Deletes what a removed agent stored outside its own directory. */
  removeCredential?: (env: NodeJS.ProcessEnv) => Promise<void>
  /** Restarts the computer's own agent of a provider, once its login is gone. */
  restartDefault?: (provider: LocalAgentProvider) => Promise<unknown>
}

/**
 * UUID owns the lifecycle; a provider only selects its adapter. No additional device tunnel.
 * An added agent exists once it is signed in: until then it is pending, and an abandoned
 * sign-in removes it with everything it stored.
 */
export class InstanceControllers {
  private readonly entries = new Map<string, Entry>()
  private readonly deps: LocalRuntimeControllerDeps
  private readonly create: (
    deps: LocalRuntimeControllerDeps,
    provider: LocalAgentProvider,
  ) => Controller
  private readonly changed: () => void
  private readonly now: () => number
  private readonly removeCredential: (env: NodeJS.ProcessEnv) => Promise<void>
  private readonly restartDefault?: InstanceControllersOptions['restartDefault']
  private userId: string | null = null
  constructor(
    deps: LocalRuntimeControllerDeps,
    create: InstanceControllers['create'],
    changed: () => void,
    options: InstanceControllersOptions = {},
  ) {
    this.deps = deps
    this.create = create
    this.changed = changed
    this.now = options.now ?? Date.now
    this.removeCredential = options.removeCredential ?? deleteClaudeKeychainEntry
    this.restartDefault = options.restartDefault
  }

  async load(userId: string | null): Promise<void> {
    for (const entry of this.entries.values()) clearTimeout(entry.expiry)
    this.entries.clear()
    this.userId = userId
    if (!userId) return
    for (const metadata of readInstances(userDir(this.deps.dataDir(), userId)))
      this.add(metadata, userId)
    await Promise.all(
      [...this.entries.values()].map(({ controller }) => controller.setUser(userId)),
    )
    // A restart ends any sign-in in progress; what is not signed in by now never will be.
    await Promise.all(
      [...this.entries.values()]
        .filter((entry) => entry.metadata.state !== 'ready')
        .map((entry) => this.settle(entry, true)),
    )
  }

  async shutdown(): Promise<unknown> {
    for (const entry of this.entries.values()) clearTimeout(entry.expiry)

    return Promise.all([...this.entries.values()].map(({ controller }) => controller.shutdown()))
  }

  /** Restarts only the providers' agents, so one sign-in leaves other agents' turns running. */
  async refresh(restart: boolean, providers?: readonly LocalAgentProvider[]): Promise<unknown> {
    await Promise.all(
      [...this.entries.values()].map(({ controller, metadata }) =>
        controller.refresh(restart && (!providers || providers.includes(metadata.provider))),
      ),
    )

    return Promise.all(
      [...this.entries.values()]
        .filter((entry) => entry.metadata.state !== 'ready')
        .map((entry) => this.settle(entry, false)),
    )
  }

  runtime(instanceId: string, provider: LocalAgentProvider): RunningRuntime | null {
    const entry = this.entries.get(instanceId)

    return entry?.metadata.provider === provider ? entry.controller.runtime(provider) : null
  }

  states(online: boolean) {
    return [...this.entries.values()].map(({ metadata, controller }) => ({
      ...publicMetadata(metadata),
      ...controller.state().agents[metadata.provider],
      workspace: controller.state().workspace,
      online: online && controller.runtime(metadata.provider) !== null,
    }))
  }

  status(): NonNullable<LocalRuntimeTunnelStatus['instances']> {
    return [...this.entries.values()].map(({ metadata, controller }) => {
      const cli = controller.state().agents[metadata.provider].cli

      return {
        ...publicMetadata(metadata),
        ...controller.status().agents[metadata.provider],
        cli: {
          installed: cli?.installed ?? false,
          loggedIn: cli?.installed ? cli.loggedIn : false,
        },
      }
    })
  }

  private add(metadata: AgentInstanceRecord, userId: string): Entry {
    const dir = this.instanceDir(metadata.instanceId)
    const controller = this.create(
      instanceControllerDeps(this.deps, dir, userId, this.changed),
      metadata.provider,
    )
    const entry: Entry = { metadata, controller }

    this.entries.set(metadata.instanceId, entry)
    this.expireLater(entry)

    return entry
  }

  private instanceDir(instanceId: string): string {
    return path.join(this.deps.dataDir(), 'instances', instanceId)
  }

  private persist(userId: string): void {
    writeInstances(
      userDir(this.deps.dataDir(), userId),
      [...this.entries.values()].map((entry) => entry.metadata),
    )
  }

  private expireLater(entry: Entry): void {
    if (entry.metadata.state !== 'pending') return
    const createdAt = Date.parse(entry.metadata.createdAt ?? '')
    const delay = Number.isFinite(createdAt) ? createdAt + PENDING_TTL_MS - this.now() : 0

    entry.expiry = setTimeout(
      () => {
        void entry.controller
          .refresh(false)
          .then(() => this.settle(entry, true))
          .catch(() => {
            /* Retried on the next refresh or start. */
          })
      },
      Math.max(0, delay),
    )
    entry.expiry.unref?.()
  }

  /** Signed in: the agent is kept. Otherwise a final check removes it (a legacy record
   *  whose login cannot be read is kept rather than guessed away). */
  private async settle(entry: Entry, final: boolean): Promise<boolean> {
    const userId = this.userId

    if (!userId || this.entries.get(entry.metadata.instanceId) !== entry) return false
    const cli = entry.controller.state().agents[entry.metadata.provider].cli
    const loggedIn = cli?.installed ? cli.loggedIn : undefined

    if (loggedIn === true) {
      if (entry.metadata.state !== 'ready') {
        clearTimeout(entry.expiry)
        entry.metadata = { ...publicMetadata(entry.metadata), state: 'ready' }
        this.persist(userId)
        this.changed()
      }

      return true
    }
    if (final && !(entry.metadata.state === undefined && loggedIn == null))
      await this.remove(entry.metadata.instanceId, userId)

    return false
  }

  private async remove(instanceId: string, userId: string): Promise<void> {
    const entry = this.entries.get(instanceId)

    if (!entry) return
    clearTimeout(entry.expiry)
    this.entries.delete(instanceId)
    this.persist(userId)
    this.changed()
    const dir = this.instanceDir(instanceId)

    await entry.starting?.catch(() => {})
    await entry.controller.shutdown()
    if (entry.metadata.provider === 'claude-code')
      await this.removeCredential(secureStorageEnv(dir, userId))
    rmSync(dir, { recursive: true, force: true })
  }

  async request(request: unknown, userId: string | null): Promise<unknown> {
    if (!userId) throw new Error('Sign in to Nuphos first')
    if (!request || typeof request !== 'object') throw new Error('Invalid instance request')
    const body = request as { method?: string; instanceId?: unknown; provider?: unknown }

    // The computer's own agent is named by its provider, an added one by its instance id.
    if (body.method === 'remove' && body.instanceId === undefined)
      return removeDefaultAgent(this.deps, userId, body.provider, this.restartDefault)

    if (body.method === 'list')
      return {
        instances: [...this.entries.values()].map(({ metadata }) => publicMetadata(metadata)),
      }
    if (body.method === 'remove' || body.method === 'commit') {
      if (typeof body.instanceId !== 'string' || !UUID.test(body.instanceId))
        throw new Error('Invalid agent instance')
      const entry = this.entries.get(body.instanceId)

      if (body.method === 'remove') {
        await this.remove(body.instanceId, userId)

        return {}
      }
      if (!entry) throw new Error('Agent instance not found')
      await entry.starting?.catch(() => {})
      await entry.controller.refresh(false)
      if (!(await this.settle(entry, false))) throw new Error('The agent is not signed in yet')

      return { instance: publicMetadata(entry.metadata) }
    }
    if (body.method !== 'create') throw new Error('Unsupported instance method')
    const metadata = parseInstance(request)
    const existing = this.entries.get(metadata.instanceId)

    if (existing) {
      if (
        existing.metadata.provider !== metadata.provider ||
        existing.metadata.label !== metadata.label
      )
        throw new Error('Agent instance already exists')

      return { instance: publicMetadata(existing.metadata) }
    }
    const record: AgentInstanceRecord = {
      ...metadata,
      state: 'pending',
      createdAt: new Date(this.now()).toISOString(),
    }

    writeInstances(
      userDir(this.deps.dataDir(), userId),
      [...this.entries.values()].map((entry) => entry.metadata).concat(record),
    )
    const entry = this.add(record, userId)

    // Acknowledge at once; the sign-in waits for the agent to come up, not the caller.
    entry.starting = entry.controller.setUser(userId).then(this.changed)
    entry.starting.catch(() => {
      /* The controller reports its own start failure. */
    })
    this.changed()

    return { instance: publicMetadata(record) }
  }
}

/** What the backend sees: legacy records count as signed-in agents until settled. */
function publicMetadata({ instanceId, provider, label, state }: AgentInstanceRecord) {
  return { instanceId, provider, label, state: state ?? ('ready' as const) }
}
