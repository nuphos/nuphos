import { api } from '../api.ts'

type ArchiveRequest = ReturnType<typeof api.agentSetConversationArchived>

const inFlight = new Map<string, ArchiveRequest>()

/** Share the sidebar's archive request across every surface and split pane. */
export function archiveChat(sessionId: string, teamId: string): ArchiveRequest {
  const key = JSON.stringify([teamId, sessionId])
  const pending = inFlight.get(key)

  if (pending) return pending
  const request = api.agentSetConversationArchived(sessionId, true, teamId).finally(() => {
    inFlight.delete(key)
  })

  inFlight.set(key, request)

  return request
}
