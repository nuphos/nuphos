import { logError } from '@/lib/observability'
import { getSlackIncidentPostingRate } from '@/lib/slack/incident-notifications'
import { listIncidentOccurrences, recordIncidentFiring } from '@/lib/slack/incident-occurrences'

export function resolveMessageTemplate(template: string, payload: unknown): string {
  if (!payload || typeof payload !== 'object') return template

  return template.replace(/\{\{(?=([^}]+))\1\}\}/g, (match, path: string) => {
    const keys = path.trim().split('.')
    let value: unknown = payload

    for (const key of keys) {
      if (value == null || typeof value !== 'object') return match
      value = (value as Record<string, unknown>)[key]
    }
    if (value == null) return match
    if (typeof value === 'object') return JSON.stringify(value)
    if (typeof value === 'string') return value
    if (typeof value === 'symbol' || typeof value === 'function') return value.toString()
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      return String(value)
    }

    return match
  })
}

/** The provider's own words for the alert state, passed through unclassified. */
export function readReportedStatus(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const root = payload as Record<string, unknown>
  const nested = [root.incident, root.data, (root.data as Record<string, unknown>)?.attributes]

  for (const source of [root, ...nested]) {
    if (!source || typeof source !== 'object') continue
    for (const field of ['status', 'state', 'severity', 'alertState']) {
      const value = (source as Record<string, unknown>)[field]

      if (typeof value === 'string' && value.trim()) return value.trim()
    }
  }

  return undefined
}

/**
 * Record that the alert went off, and gather the two facts the agent cannot
 * look up for itself: whether it has any history at all, and how loud it has
 * already been in the past hour. Never blocks the run — an alert must reach
 * someone even when its bookkeeping fails.
 */
export async function prepareIncidentContext(input: {
  teamId: string
  triggerId: string
  incidentScope: string
  sessionId: string
  reportedStatus?: string
}): Promise<{ hasPriorOccurrences: boolean; postsInLastHour: number }> {
  const now = new Date()

  // That the alert fired is a fact, and the append-only record of it must not
  // depend on two best-effort reads succeeding. Written first, on its own.
  await recordIncidentFiring({
    teamId: input.teamId,
    triggerId: input.triggerId,
    incidentScope: input.incidentScope,
    sessionId: input.sessionId,
    firedAt: now,
    ...(input.reportedStatus ? { reportedStatus: input.reportedStatus } : {}),
  }).catch((err: unknown) => {
    logError('trigger.incident_firing_record_failed', err, { trigger_id: input.triggerId })
  })
  try {
    const [prior, rate] = await Promise.all([
      listIncidentOccurrences({
        teamId: input.teamId,
        triggerId: input.triggerId,
        incidentScope: input.incidentScope,
        limit: 2,
      }),
      getSlackIncidentPostingRate(input.teamId, input.triggerId, input.incidentScope, now),
    ])
    // This run's own firing is already recorded, so it is not prior history.
    const earlier = prior.filter((occurrence) => occurrence.sessionId !== input.sessionId)

    return { hasPriorOccurrences: earlier.length > 0, postsInLastHour: rate.postsInLastHour }
  } catch (err) {
    logError('trigger.incident_context_failed', err, { trigger_id: input.triggerId })

    return { hasPriorOccurrences: false, postsInLastHour: 0 }
  }
}
