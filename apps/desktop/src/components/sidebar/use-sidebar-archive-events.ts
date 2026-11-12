import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef } from 'react'

import { t } from '../../i18n'
import { offerArchiveUndo } from '../../lib/archiveUndo'
import { onChatArchived, onChatUnarchived } from '../../lib/chatArchiveEvents'
import { queryKeys } from '../../lib/query/keys'

import { removeChat, restoreChat } from './agentSessions'

import type { AgentConversation } from '../../api'

export function useSidebarArchiveEvents({
  teamId,
  sessions,
  onArchived,
}: {
  teamId: string
  sessions: AgentConversation[]
  onArchived?: (sessionId: string) => void
}) {
  const client = useQueryClient()

  useEffect(
    () =>
      onChatArchived((change) => {
        if (change.teamId !== teamId) return
        void removeChat(client, teamId, change.sessionId)
        onArchived?.(change.sessionId)
      }),
    [client, teamId, onArchived],
  )
  useEffect(
    () =>
      onChatUnarchived(
        () => void client.invalidateQueries({ queryKey: queryKeys.agentSessions(teamId) }),
      ),
    [client, teamId],
  )

  // Undo needs the row as it was last listed: the archive has already taken it
  // out of the list by the time Undo runs.
  const listedRowsRef = useRef(new Map<string, AgentConversation>())
  const teamIdRef = useRef(teamId)

  useEffect(() => {
    if (teamIdRef.current !== teamId) listedRowsRef.current.clear()
    teamIdRef.current = teamId
    for (const row of sessions) listedRowsRef.current.set(row.sessionId, row)
  }, [sessions, teamId])

  /** Shows the archive receipt; Undo lists the chat again at once. */
  const offerUndo = useCallback(
    (sessionId: string, botSessionId?: string) => {
      const row = listedRowsRef.current.get(sessionId)

      offerArchiveUndo({
        sessionId,
        teamId,
        title: [row?.title, row?.firstMessage].find(Boolean) ?? t('Untitled agent'),
        ...(botSessionId ? { noun: 'bot' } : row?.kind === 'channel' ? { noun: 'chat' } : {}),
        onRestored: () => {
          if (row && teamIdRef.current === teamId) void restoreChat(client, teamId, row)
        },
      })
    },
    [client, teamId],
  )

  return { offerUndo }
}
