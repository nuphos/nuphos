import { readFileSync } from 'node:fs'

import { logEvent } from '@/lib/observability'

/** The panel job's runner text; a computer runs the same file as its `session-homes` job. */
export const RECLAIM_SESSION_HOME_PROGRAM = readFileSync(
  new URL('./session-home-reclaim-job.mjs', import.meta.url),
  'utf8',
)

/** Reads the program's report: false keeps the home for a later sweep. */
export function reclaimed(stdout: string, sessionId: string): boolean {
  const outcome = JSON.parse(stdout) as { result?: string; unreadable?: string }

  // Kept because a process could not be inspected; a host where this repeats
  // never reclaims anything.
  if (outcome.unreadable)
    logEvent('warn', 'agent.session_home_reclaim.unreadable_process', {
      session_id: sessionId,
      process: outcome.unreadable,
    })

  return outcome.result !== 'in_use'
}
