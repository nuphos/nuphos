import { useSilentTick } from './useSilentRefresh'
import { useWorkspaceTab } from './useWorkspaceTab'

// The workspace heartbeat ticks every 5 s; rate-limited third-party APIs refresh every 30 s.
export const SLOW_POLL_EVERY_TICKS = 6

export function useSlowPollTick(): number {
  return Math.floor(useWorkspaceTab().pollTick / SLOW_POLL_EVERY_TICKS)
}

export function useSlowPoll(fn: () => void): void {
  useSilentTick(fn, useSlowPollTick())
}
