import { useEffect } from 'react'

import { onChatArchived } from '../../lib/chatArchiveEvents'

import type { AgentConversation } from '../../api'
import type { Dispatch, RefObject, SetStateAction } from 'react'

export function useSidebarArchiveEvents({
  teamId,
  locallyArchivedRef,
  refreshSeqRef,
  setSessions,
  refresh,
  onArchived,
}: {
  teamId: string
  locallyArchivedRef: RefObject<Map<string, number>>
  refreshSeqRef: RefObject<number>
  setSessions: Dispatch<SetStateAction<AgentConversation[]>>
  refresh: () => Promise<void>
  onArchived?: (sessionId: string) => void
}) {
  useEffect(
    () =>
      onChatArchived((change) => {
        if (change.teamId !== teamId) return
        locallyArchivedRef.current.set(change.sessionId, refreshSeqRef.current)
        setSessions((previous) => previous.filter((row) => row.sessionId !== change.sessionId))
        onArchived?.(change.sessionId)
        void refresh()
      }),
    [teamId, locallyArchivedRef, refreshSeqRef, setSessions, refresh, onArchived],
  )
}
