import { createContext, useContext } from 'react'

import { openInApp } from '../../../app/workspace/openInApp'
import { emptyNavigation, pageLocationForNavigation } from '../../../lib/appRoutes'

export type TriggerDetailRef = { triggerId: string; triggerName: string }

// Settings mounts fresh on every deep entry, so the Trigger to open is left
// here for its Triggers section to take when it mounts.
let pendingDetail: TriggerDetailRef | null = null

/** "Open in Triggers": Settings › Triggers, on this Trigger's detail. */
export function openTriggerInSettings(teamId: string, detail: TriggerDetailRef) {
  pendingDetail = detail
  openInApp(
    pageLocationForNavigation(emptyNavigation({ kind: 'team', teamId }, 'team.triggers')).href,
  )
}

/**
 * The Trigger an "Open in Triggers" asked for, once: a later visit lands on the
 * list. Cleared after this render, so a double-invoked initializer reads it too.
 */
export function takePendingTriggerDetail(): TriggerDetailRef | null {
  const detail = pendingDetail

  if (detail) {
    queueMicrotask(() => {
      if (pendingDetail === detail) pendingDetail = null
    })
  }

  return detail
}

function openConversationInPane(teamId: string, sessionId: string) {
  openInApp(
    pageLocationForNavigation(
      emptyNavigation({ kind: 'team', teamId }, 'team.agent', { agentSessionId: sessionId }),
    ).href,
  )
}

/**
 * How the Triggers page opens a Trigger's conversation. Settings provides one
 * that closes itself first; elsewhere the link opens in the focused pane.
 */
export const TriggerConversationOpener = createContext<((sessionId: string) => void) | null>(null)

export function useOpenTriggerConversation(): (sessionId: string, teamId?: string) => void {
  const open = useContext(TriggerConversationOpener)

  return (sessionId, teamId) => {
    if (open) open(sessionId)
    else if (teamId) openConversationInPane(teamId, sessionId)
  }
}
