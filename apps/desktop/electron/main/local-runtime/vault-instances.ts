import { vaultInstance } from './vault-token.ts'

import type { AgentInstanceRecord } from './agent-instances.ts'
import type { CliInstall } from './instance-deps.ts'
import type { Entry } from './instance-entries.ts'
import type { VaultToken } from './vault-token.ts'

type Instances = {
  entries: Map<string, Entry>
  add(
    metadata: AgentInstanceRecord,
    userId: string,
    install?: CliInstall,
    vault?: VaultToken,
  ): Entry
  remove(instanceId: string, userId: string): Promise<void>
  start(entry: Entry, userId: string): void
}

/**
 * Keeps one added agent per token shared with this computer: a new share adds one, an unshare
 * removes it with everything it stored. A listing that failed changes nothing. `start`: the
 * new ones start now, rather than with every other agent.
 */
export async function syncVaultAgents(
  instances: Instances,
  list: (() => Promise<VaultToken[] | null>) | undefined,
  userId: string,
  start = false,
): Promise<void> {
  const tokens = await list?.().catch(() => null)

  if (!tokens) return
  const shared = new Map(tokens.map((token) => [vaultInstance(token).instanceId, token]))

  for (const [instanceId, entry] of instances.entries)
    if (entry.vault && !shared.has(instanceId)) await instances.remove(instanceId, userId)

  for (const [instanceId, token] of shared) {
    if (instances.entries.has(instanceId)) continue
    const entry = instances.add(vaultInstance(token), userId, undefined, token)

    if (start) instances.start(entry, userId)
  }
}

/** How often a running host asks again, so a share or unshare reaches it without a restart. */
const VAULT_POLL_MS = 60_000

/** Syncs once, then keeps syncing until the returned timer is cleared. */
export async function watchVaultAgents(
  instances: Instances,
  list: (() => Promise<VaultToken[] | null>) | undefined,
  userId: string,
): Promise<NodeJS.Timeout | undefined> {
  await syncVaultAgents(instances, list, userId)
  if (!list) return undefined
  const timer = setInterval(
    () => void syncVaultAgents(instances, list, userId, true),
    VAULT_POLL_MS,
  )

  timer.unref()

  return timer
}
