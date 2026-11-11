import { api } from '../api.ts'

import { announceChatArchived } from './chatArchiveEvents.ts'

type ArchiveRequest = ReturnType<typeof api.agentSetConversationArchived>

const inFlight = new Map<string, ArchiveRequest>()

/** Share the sidebar's archive request across every surface and split pane. */
export function archiveChat(sessionId: string, teamId: string): ArchiveRequest {
  const key = JSON.stringify([teamId, sessionId])
  const pending = inFlight.get(key)

  if (pending) return pending
  const request = api
    .agentSetConversationArchived(sessionId, true, teamId)
    .then((moved) => {
      // The server may archive more with it (a Bot and its chat): each closes and hides too.
      for (const id of moved.sessionIds ?? [])
        if (id !== sessionId) announceChatArchived({ sessionId: id, teamId })

      return moved
    })
    .finally(() => {
      inFlight.delete(key)
    })

  inFlight.set(key, request)

  return request
}
