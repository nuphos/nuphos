// The Box paywall: where starting a Box is refused for the team's plan (402
// box_vcpu_limit), the plans are offered instead, and the start runs again once one is bought.
import { parseAtlasError } from '../../api/errors.ts'

import type { TeamMember } from '../../types'

export type BoxPaywallRequest = {
  id: number
  teamId: string
  message: string
  retry: () => void
  /** What happens once a plan is bought, when it is not the refused start running again. */
  afterPaid?: string
  /** The vCPU running the team needs, so plans too small are dimmed. */
  needs?: number
}

let request: BoxPaywallRequest | null = null
// The team's limit as first read after opening; a larger one later means a plan was bought.
let before: number | null | undefined
let opened = 0
const listeners = new Set<() => void>()

function set(next: BoxPaywallRequest | null): void {
  request = next
  before = undefined
  for (const listener of listeners) listener()
}

export const boxPaywall = {
  subscribe: (listener: () => void) => {
    listeners.add(listener)

    return () => {
      listeners.delete(listener)
    }
  },
  current: () => request,
  close: () => set(null),
}

/** Opens the paywall when `error` is the plan's refusal; false for any other error, which the caller reports. */
export function openBoxPaywall(teamId: string, error: unknown, retry: () => void): boolean {
  const { code, message } = parseAtlasError(error)

  if (code !== 'box_vcpu_limit') return false
  openBoxPlans(teamId, message, retry)

  return true
}

/** Opens the plans without a refusal, as for a Box size the plan cannot fit; `retry` runs once one is bought. */
export function openBoxPlans(
  teamId: string,
  message: string,
  retry: () => void,
  more: { afterPaid?: string; needs?: number } = {},
): void {
  opened += 1
  set({ id: opened, teamId, message, retry, ...more })
}

/** Each read of the team's limit while the paywall is open: once it grows, close and start again. */
export function boxPaywallLimitRead(limit: number | null): void {
  if (!request) return
  if (before === undefined) {
    before = limit

    return
  }
  if (limit === null || (before !== null && limit <= before)) return
  const { retry } = request

  set(null)
  retry()
}

/** Who may buy a plan: the team's administrators, and whether the current user is one. */
export function paywallAudience(members: TeamMember[], userId: string | undefined) {
  const admins = members.filter((member) => member.role === 'ADMINISTRATOR')

  return { isAdmin: admins.some((member) => member.id === userId), admins }
}
