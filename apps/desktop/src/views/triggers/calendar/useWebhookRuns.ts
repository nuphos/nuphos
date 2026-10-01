import { useEffect, useMemo, useState } from 'react'

import { api } from '../../../api'
import { useResetOnKey } from '../../useResetOnKey'

import { buildWebhookRunEvents } from './occurrences'

import type { ScheduleEvent } from './model'
import type { AgentConversation, AgentTrigger } from '../../../api'

/**
 * The schedule's received-webhook overlay: the conversations the team's
 * webhook triggers fired, as ScheduleEvents at their arrival times. The list
 * endpoint caps at 100, newest first — older runs age off the grid, which
 * suits a schedule view's recency bias.
 */
export function useWebhookRuns(
  teamId: string,
  triggers: AgentTrigger[],
  refreshKey?: number,
): ScheduleEvent[] {
  const webhookIdsKey = useMemo(
    () =>
      triggers
        .filter((trigger) => trigger.triggerType === 'webhook')
        .map((trigger) => trigger.id)
        .sort((a, b) => a.localeCompare(b))
        .join(','),
    [triggers],
  )
  // Cleared during render when the team or trigger set changes; the fetch
  // below repopulates.
  const [conversations, setConversations] = useState<AgentConversation[]>([])

  useResetOnKey(`${teamId}|${webhookIdsKey}`, () => setConversations([]))

  useEffect(() => {
    if (!webhookIdsKey) return
    let alive = true

    api
      .agentListConversations(teamId, {
        triggerIds: webhookIdsKey.split(','),
        scope: 'team',
        limit: 100,
      })
      .then((page) => {
        if (alive) setConversations(page.conversations)
      })
      .catch(() => {
        // Webhook history is an overlay — a failed load just leaves the cron
        // schedule standing, no toast needed.
        if (alive) setConversations([])
      })

    return () => {
      alive = false
    }
  }, [teamId, webhookIdsKey, refreshKey])

  return useMemo(() => buildWebhookRunEvents(triggers, conversations), [triggers, conversations])
}
