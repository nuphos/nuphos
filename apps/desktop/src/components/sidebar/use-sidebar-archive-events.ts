import { useCallback, useEffect, useRef } from 'react'

import { t } from '../../i18n'
import { offerArchiveUndo } from '../../lib/archiveUndo'
import { onChatArchived, onChatUnarchived } from '../../lib/chatArchiveEvents'

import { withRestoredChats } from './local-archive-guard'

import type { LocalRestoreGuard } from './local-archive-guard'
import type { AgentConversation } from '../../api'
import type { Dispatch, RefObject, SetStateAction } from 'react'

export function useSidebarArchiveEvents({
  teamId,
  sessions,
  locallyArchivedRef,
  locallyRestoredRef,
  refreshSeqRef,
  setSessions,
  refresh,
  onArchived,
}: {
  teamId: string
  sessions: AgentConversation[]
  locallyArchivedRef: RefObject<Map<string, number>>
  locallyRestoredRef: RefObject<LocalRestoreGuard<AgentConversation>>
  refreshSeqRef: RefObject<number>
  setSessions: Dispatch<SetStateAction<AgentConversation[]>>
  refresh: () => Promise<void>
  onArchived?: (sessionId: string) => void
}) {
  useEffect(
    () =>
      onChatArchived((change) => {
        if (change.teamId !== teamId) return
        locallyRestoredRef.current.delete(change.sessionId)
        locallyArchivedRef.current.set(change.sessionId, refreshSeqRef.current)
        setSessions((previous) => previous.filter((row) => row.sessionId !== change.sessionId))
        onArchived?.(change.sessionId)
        void refresh()
      }),
    [
      teamId,
      locallyArchivedRef,
      locallyRestoredRef,
      refreshSeqRef,
      setSessions,
      refresh,
      onArchived,
    ],
  )
  useEffect(
    () =>
      onChatUnarchived((sessionId) => {
        locallyArchivedRef.current.delete(sessionId)
        void refresh()
      }),
    [locallyArchivedRef, refresh],
  )

  // Undo needs the row as it was last listed: the archive (or a poll during
  // its collapse) has already taken it out of state by the time Undo runs.
  const listedRowsRef = useRef(new Map<string, AgentConversation>())
  const teamIdRef = useRef(teamId)

  useEffect(() => {
    if (teamIdRef.current !== teamId) listedRowsRef.current.clear()
    teamIdRef.current = teamId
    for (const row of sessions) listedRowsRef.current.set(row.sessionId, row)
  }, [sessions, teamId])

  /** Shows the archive receipt; Undo lists the chat again at once. */
  const offerUndo = useCallback(
    (sessionId: string) => {
      const row = listedRowsRef.current.get(sessionId)

      offerArchiveUndo({
        sessionId,
        teamId,
        title: [row?.title, row?.firstMessage].find(Boolean) ?? t('Untitled agent'),
        onRestored: () => {
          if (!row || teamIdRef.current !== teamId) return
          locallyArchivedRef.current.delete(sessionId)
          locallyRestoredRef.current.set(sessionId, { row, settledSeq: refreshSeqRef.current })
          setSessions((previous) =>
            withRestoredChats(previous, locallyRestoredRef.current, refreshSeqRef.current),
          )
        },
      })
    },
    [teamId, locallyArchivedRef, locallyRestoredRef, refreshSeqRef, setSessions],
  )

  return { offerUndo }
}
