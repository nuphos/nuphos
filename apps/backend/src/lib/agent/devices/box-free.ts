// A free Box: on a deployment that sets BOX_DEFAULT_MONTHLY_HOURS, a team without its own
// `boxVcpuLimit` has one Box and may run its Boxes at the default limit that many hours a
// calendar month (UTC). Use is read from the usage samples box-usage-history records, so
// nothing new is metered. Nuphos pauses such a Box once nobody uses it (box-free-sweep);
// instabox's own idle pause stays off, as it would pause a Box whose agent waits on its model.

import { config } from '@/config'
import { db } from '@/lib/db'
import { AppError } from '@/lib/errors'
import { logEvent } from '@/lib/observability'

import type { Collection } from 'mongodb'

/** A free Box nobody used this long is paused. */
export const IDLE_PAUSE_MS = 30 * 60_000

type Sample = { usedVcpus: number; at: Date }

const samples = (): Collection<Sample & { _id: string; teamId: string }> =>
  db().collection('box_usage_samples')

/** The free allowance, when the deployment gives one to teams without a plan. */
export function freeAllowance(): { hours: number; vcpuHours: number } | null {
  const { defaultMonthlyHours: hours, defaultVcpuLimit: vcpus } = config.box

  return hours !== undefined && vcpus ? { hours, vcpuHours: hours * vcpus } : null
}

export function monthStart(nowMs: number): number {
  const now = new Date(nowMs)

  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
}

/** vCPU-hours of the step series over [from, to]: `prior` holds at `from`, each row until the next. */
export function vcpuHours(prior: Sample | null, rows: Sample[], from: number, to: number): number {
  let at = from
  let used = prior?.usedVcpus ?? 0
  let total = 0

  for (const row of rows) {
    total += used * (row.at.getTime() - at)
    at = row.at.getTime()
    used = row.usedVcpus
  }

  return (total + used * (to - at)) / 3_600_000
}

/** The vCPU-hours the team's Boxes ran this month. */
export async function monthVcpuHours(teamId: string, nowMs = Date.now()): Promise<number> {
  const from = monthStart(nowMs)
  const [prior, rows] = await Promise.all([
    samples()
      .find({ teamId, at: { $lt: new Date(from) } })
      .sort({ at: -1 })
      .limit(1)
      .next(),
    samples()
      .find({ teamId, at: { $gte: new Date(from), $lte: new Date(nowMs) } })
      .sort({ at: 1 })
      .toArray(),
  ])

  return vcpuHours(prior, rows, from, nowMs)
}

function refuse(teamId: string, reason: string, message: string): never {
  logEvent('warn', 'agent.box.free_allowance_refused', { team_id: teamId, reason })
  // The vCPU limit's code: clients already offer the plans for it.
  throw new AppError(402, 'box_vcpu_limit', message)
}

/**
 * Refuses, for a team without its own plan, a second Box or a start once the month's hours
 * are used. `boxes` is how many the team has; `creating` whether this start makes a new one.
 */
export async function assertFreeAllowance(
  teamId: string,
  boxes: number,
  creating: boolean,
  nowMs = Date.now(),
  used = monthVcpuHours,
): Promise<void> {
  const allowance = freeAllowance()

  if (!allowance) return
  if (creating && boxes > 0)
    refuse(
      teamId,
      'box_count',
      "Your team's free plan includes one cloud computer. Choose a computer plan for more.",
    )
  if ((await used(teamId, nowMs)) < allowance.vcpuHours) return
  const now = new Date(nowMs)
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))

  refuse(
    teamId,
    'hours',
    `Your team's free cloud computer has used its ${String(allowance.hours)} hours this month. Choose a computer plan to keep using it, or wait until ${reset.toISOString().slice(0, 10)}.`,
  )
}
