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
