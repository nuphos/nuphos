import type { BoxUsage } from '../../api/device-types'

/** The name the backend gives an unnamed Box: "Box N", after the highest the caller has. */
export function nextBoxName(labels: string[]): string {
  const taken = labels
    .map((label) => /^Box (\d+)$/u.exec(label)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number)

  return `Box ${String(Math.max(0, ...taken) + 1)}`
}

/**
 * The plan's running vCPU and what is left of it; null when the team has no limit.
 * `used` and `left` are null when the backend could not read the Boxes' use.
 */
export function boxQuota(usage: Pick<BoxUsage, 'limitVcpus' | 'usedVcpus'>) {
  if (usage.limitVcpus === null) return null
  const used = usage.usedVcpus

  return {
    limit: usage.limitVcpus,
    used,
    left: used === null ? null : Math.max(0, usage.limitVcpus - used),
  }
}

export type QuotaCell = 'used' | 'adding' | 'over' | 'free'

/** One cell per vCPU of the plan: in use, taken by the Box being made (over when it does not fit), or free. */
export function quotaCells(limit: number, used: number, adding: number): QuotaCell[] {
  const fits = used + adding <= limit

  return Array.from({ length: limit }, (_, index) => {
    if (index < used) return 'used'
    if (index < used + adding) return fits ? 'adding' : 'over'

    return 'free'
  })
}
