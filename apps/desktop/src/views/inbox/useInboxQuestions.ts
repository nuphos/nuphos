import { useAgentSessions } from '../../components/sidebar/agentSessions.ts'
import { isBotRow, useAgentAvatarPicks } from '../../lib/agentAvatarChoices.ts'

import { botAbove, inboxQuestions } from './inboxItems.ts'
import { useAnsweredOnDevice, useInboxListing } from './useInbox.ts'

import type { InboxQuestion } from './inboxItems.ts'

/**
 * The Inbox's rows, as the sidebar's list and the Inbox page both show them; null while loading.
 * With `snoozed`, the questions set aside instead, which the sidebar lists below them.
 */
export function useInboxQuestions(
  teamId: string,
  reloadKey?: unknown,
  snoozed = false,
): InboxQuestion[] | null {
  const listing = useInboxListing(teamId, reloadKey).data
  const onDevice = useAnsweredOnDevice()
  // The sidebar's chats hold the parents a waiting task hangs under, up to its Bot.
  const chats = useAgentSessions(teamId).data ?? []
  const picks = useAgentAvatarPicks()

  if (!listing) return null
  const byId = new Map([...chats, ...listing].map((row) => [row.sessionId, row]))

  return inboxQuestions(
    listing,
    onDevice,
    (conversation) =>
      botAbove(conversation, byId, (row) => isBotRow(row, picks.get(row.sessionId))),
    { snoozed },
  )
}
