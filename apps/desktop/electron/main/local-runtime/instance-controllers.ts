import { rmSync } from 'node:fs'
import path from 'node:path'

import { parseInstance, readInstances, writeInstances } from './agent-instances.ts'
import { deleteClaudeKeychainEntry } from './claude-keychain.ts'
import { defaultAgentRequest } from './default-agent.ts'
import { userDir } from './controller-types.ts'
import { deleteInstanceSecrets, instanceControllerDeps, signOutInstance } from './instance-deps.ts'
import { instanceStates, instanceStatus, publicMetadata } from './instance-entries.ts'
import { watchVaultAgents } from './vault-instances.ts'

import type { LocalAgentProvider } from './agent-cli.ts'
import type { AgentInstanceRecord } from './agent-instances.ts'
import type { LocalRuntimeControllerDeps } from './controller-types.ts'
import type { DefaultAgentControl } from './default-agent.ts'
import type { CliInstall } from './instance-deps.ts'
import type { Controller, Entry } from './instance-entries.ts'
import type { RunningRuntime } from './openab-process.ts'
import type { VaultToken } from './vault-token.ts'

/** A sign-in left unfinished this long is abandoned: its login has long expired. */
export const PENDING_TTL_MS = 20 * 60_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u

export type InstanceControllersOptions = DefaultAgentControl & {
  now?: () => number
  /** Deletes what a removed agent stored outside its own directory. */
  removeCredential?: (env: NodeJS.ProcessEnv) => Promise<void>
}

/**
 * UUID owns the lifecycle; a provider only selects its adapter. No additional device tunnel.
 * An added agent exists once it is signed in: until then it is pending, and an abandoned
 * sign-in removes it with everything it stored.
 */
export class InstanceControllers {
  readonly entries = new Map<string, Entry>()
  private readonly deps: LocalRuntimeControllerDeps
  private readonly create: (
    deps: LocalRuntimeControllerDeps,
    provider: LocalAgentProvider,
  ) => Controller
  private readonly changed: () => void
  private readonly now: () => number
  private readonly removeCredential: (env: NodeJS.ProcessEnv) => Promise<void>
  private readonly defaults: DefaultAgentControl
  private userId: string | null = null
  private watch?: NodeJS.Timeout
  private readonly instanceDir = (id: string) => path.join(this.deps.dataDir(), 'instances', id)
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
    this.defaults = options
  }

  async load(userId: string | null): Promise<void> {
    clearInterval(this.watch)
    for (const entry of this.entries.values()) clearTimeout(entry.expiry)
    this.entries.clear()
    this.userId = userId
    if (!userId) return
    for (const metadata of readInstances(userDir(this.deps.dataDir(), userId)))
      this.add(metadata, userId)
    this.watch = await watchVaultAgents(this, this.deps.vaultTokens, userId)
    await Promise.all(
      [...this.entries.values()].map(({ controller }) => controller.setUser(userId)),
    )
    await Promise.all(
      [...this.entries.values()]
        .filter((entry) => entry.metadata.state !== 'ready')
        .map((entry) => this.settle(entry, true)),
    )
  }

  async shutdown(): Promise<unknown> {
    clearInterval(this.watch)
    for (const entry of this.entries.values()) clearTimeout(entry.expiry)

    return Promise.all([...this.entries.values()].map(({ controller }) => controller.shutdown()))
  }

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

  /** The added agent a stream asks for. */
  runtime(instanceId: string, provider: LocalAgentProvider): RunningRuntime | null {
    const entry = this.entries.get(instanceId)

    return entry?.metadata.provider === provider
      ? entry.controller.runtimeForStream(provider)
      : null
  }

  states(online: boolean) {
    return instanceStates(this.entries.values(), online)
  }

  status() {
    return instanceStatus(this.entries.values())
  }

  /** `install`: set for an agent being added, whose missing CLI this computer installs. */
  add(metadata: AgentInstanceRecord, userId: string, install?: CliInstall, vault?: VaultToken) {
    const dir = this.instanceDir(metadata.instanceId)
    const controller = this.create(
      instanceControllerDeps(this.deps, dir, userId, this.changed, { install, vault }),
      metadata.provider,
    )
    const entry: Entry = { metadata, controller, install, vault }

    this.entries.set(metadata.instanceId, entry)
    this.expireLater(entry)

    return entry
  }

  /** A shared token's agent is not stored: what is shared now decides it on each start. */
  private persist(userId: string, added: AgentInstanceRecord[] = []): void {
    writeInstances(
      userDir(this.deps.dataDir(), userId),
      [...this.entries.values()].flatMap((e) => (e.vault ? [] : [e.metadata])).concat(added),
    )
  }

  start(entry: Entry, userId: string): void {
    entry.starting = entry.controller.setUser(userId).then(this.changed)
    entry.starting.catch(() => {}) // The controller reports its own start failure.
    this.changed()
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
      await this.remove(entry.metadata.instanceId, userId).catch((error: unknown) => {
        // The agent is gone either way; only a Keychain entry may be left behind.
        console.warn('[local-runtime] removing an unfinished agent', error)
      })

    return false
  }

  async remove(instanceId: string, userId: string): Promise<void> {
    const entry = this.entries.get(instanceId)

    if (!entry) return
    clearTimeout(entry.expiry)
    this.entries.delete(instanceId)
    this.persist(userId)
    this.changed()
    const dir = this.instanceDir(instanceId)

    await entry.starting?.catch(() => {})
    await entry.controller.shutdown()
    try {
      const { provider } = entry.metadata

      await deleteInstanceSecrets(this.deps, dir, userId, provider, this.removeCredential)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  /** Signs an added agent out but keeps it: its record, settings, sessions and workspace stay. */
  private async reset(entry: Entry, userId: string): Promise<unknown> {
    const { instanceId, provider } = entry.metadata
    const dir = this.instanceDir(instanceId)

    await entry.starting?.catch(() => {})
    const left = await entry.controller.whileStopped(provider, () =>
      signOutInstance(this.deps, dir, userId, provider, this.removeCredential),
    )

    // Removed meanwhile: starting it again would bring back an agent no one lists.
    if (this.entries.get(instanceId) !== entry) throw new Error('Runtime instance not found')
    entry.starting = entry.controller.refresh(false).then(this.changed)
    entry.starting.catch(() => {}) // The controller reports its own start failure.
    this.changed()
    if (left) throw left

    return { instance: publicMetadata(entry.metadata) }
  }

  /** A request about an added agent, which names it by its instance id. */
  private async instanceRequest(
    method: 'remove' | 'commit' | 'reset' | 'restart',
    instanceId: unknown,
    userId: string,
  ): Promise<unknown> {
    if (typeof instanceId !== 'string' || !UUID.test(instanceId))
      throw new Error('Invalid runtime instance')
    if (method === 'remove') return this.remove(instanceId, userId).then(() => ({}))
    const entry = this.entries.get(instanceId)

    if (!entry) throw new Error('Runtime instance not found')
    if (method === 'reset') return this.reset(entry, userId)
    await entry.starting?.catch(() => {})
    await entry.controller.refresh(method === 'restart', undefined, method === 'commit')
    if (!(await this.settle(entry, false))) throw new Error('The runtime is not signed in yet')

    return { instance: publicMetadata(entry.metadata) }
  }

  async request(request: unknown, userId: string | null): Promise<unknown> {
    if (!userId) throw new Error('Sign in to Nuphos first')
    if (!request || typeof request !== 'object') throw new Error('Invalid instance request')
    const body = request as { method?: string; instanceId?: unknown; provider?: unknown }
    const { method } = body
    const named = method === 'remove' || method === 'commit' || method === 'reset'

    // The computer's own agent is named by its provider, an added one by its instance id.
    if (named && body.instanceId === undefined)
      return defaultAgentRequest(this.deps, userId, method, body.provider, this.defaults)
    if (named || method === 'restart') return this.instanceRequest(method, body.instanceId, userId)
    if (method === 'list')
      return {
        instances: [...this.entries.values()].map(({ metadata }) => publicMetadata(metadata)),
      }
    if (method !== 'create') throw new Error('Unsupported instance method')
    const metadata = parseInstance(request)

    if (metadata.provider === 'antigravity')
      throw new Error('Antigravity uses shared OS sign-in; use the computer’s default runtime')
    const existing = this.entries.get(metadata.instanceId)

    if (existing) {
      if (
        existing.metadata.provider !== metadata.provider ||
        existing.metadata.label !== metadata.label
      )
        throw new Error('Runtime instance already exists')

      return { instance: publicMetadata(existing.metadata) }
    }
    const record: AgentInstanceRecord = {
      ...metadata,
      state: 'pending',
      createdAt: new Date(this.now()).toISOString(),
    }

    this.persist(userId, [record])
    this.start(this.add(record, userId, {}), userId)

    return { instance: publicMetadata(record) }
  }
}
