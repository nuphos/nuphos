// What the agent page shows of a runtime's usage, whichever provider reported it.
import type { RuntimeInstance } from './runtime-instances'
import type { OpenAbProvider } from './runtime-provider'

export type RuntimeQuotaWindow = {
  id: string
  label: string
  usedPercent: number
  resetsAt: string | null
}

/** Limit resets the account holds: how many, when the first must be used by, and
 *  whether one can be spent now rather than only at a limit. */
export type RuntimeQuotaResets = { left: number; expiresAt: string | null; usableNow: boolean }

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
  resets?: RuntimeQuotaResets
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
