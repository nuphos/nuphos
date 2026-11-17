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
