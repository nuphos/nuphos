// What the agent page shows of a runtime's usage, whichever provider reported it.
import type { RuntimeInstance } from './runtime-instances'
import type { OpenAbProvider } from './runtime-provider'

export type RuntimeQuotaWindow = {
  id: string
  label: string
  usedPercent: number
  resetsAt: string | null
}

export type RuntimeQuota = {
  runtimeId: string
  provider: OpenAbProvider
  fetchedAt: string
  available: boolean
  reason?: string
  /** The agent could not be reached to ask; the Agents page shows it offline. */
  offline?: true
  plan?: string
  windows: RuntimeQuotaWindow[]
  /** Which account's quota this is, hashed by the computer that holds it. */
  accountKey?: string
  /** The other agents on that account: they run out together. */
  sharesQuotaWith?: { runtimeId: string; label: string }[]
}

/** 16-hex keys came from computers that named the person, not the quota, so they are dropped. */
export const ACCOUNT_KEY = /^[0-9a-f]{20}$/u

/** Names, on each quota, the other listed agents signed in to the same account.
 *  An agent on a computer reports its account with its presence, not its reading. */
export function withSharedQuota(
  quotas: RuntimeQuota[],
  instances: Pick<RuntimeInstance, 'id' | 'label' | 'local'>[],
): RuntimeQuota[] {
  const keyed = quotas.map((quota, i) => ({
    quota,
    key: quota.accountKey ?? instances[i]?.local?.accountKey,
    label: instances[i]?.label ?? quota.runtimeId,
  }))

  return keyed.map(({ quota, key }) => {
    const peers = keyed.filter((other) => key && other.key === key && other.quota !== quota)

    return peers.length
      ? {
          ...quota,
          accountKey: key,
          sharesQuotaWith: peers.map((peer) => ({
            runtimeId: peer.quota.runtimeId,
            label: peer.label,
          })),
        }
      : quota
  })
}

/** A Codex window by its width, which Codex reports in seconds. */
export function codexWindowLabel(seconds: number | undefined, fallback: string): string {
  if (!seconds) return fallback
  const hours = seconds / 3600

  if (hours >= 24 * 6) return 'Weekly'
  if (hours >= 24) return `${String(Math.round(hours / 24))}-day`

  return `${String(Math.round(hours))}-hour`
}

export function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value * 10) / 10))
}

export function unavailable(
  instance: RuntimeInstance,
  fetchedAt: string,
  reason: string,
): RuntimeQuota {
  return {
    runtimeId: instance.id,
    provider: instance.provider,
    fetchedAt,
    available: false,
    reason,
    windows: [],
  }
}

/** Whether an agent's usage is used up, and when the latest used-up window resets. */
export function usedUp(quota: RuntimeQuota | undefined): { resetsAt?: string } | undefined {
  const spent = (quota?.windows ?? []).filter((window) => window.usedPercent >= 100)

  if (spent.length === 0) return undefined
  const latest = Math.max(
    ...spent
      .flatMap((window) => (window.resetsAt ? [Date.parse(window.resetsAt)] : []))
      .filter(Number.isFinite),
  )

  return Number.isFinite(latest) ? { resetsAt: new Date(latest).toISOString() } : {}
}
