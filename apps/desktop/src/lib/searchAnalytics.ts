import posthog from 'posthog-js'

import { activeTeam } from './analytics'

/**
 * ⌘K's events, kept beside the shared AnalyticsEvent list: how it was opened
 * and what it led to, since autocapture never sees keyboard use.
 */
export type SearchEvent = 'search_opened' | 'search_result_opened'

/** As track(): a no-op until analytics has started, and stamped with the active team. */
export function trackSearch(event: SearchEvent, props: Record<string, unknown>): void {
  if (!posthog.__loaded) return
  const team = activeTeam()

  posthog.capture(event, team ? { team_id: team, ...props } : props)
}
