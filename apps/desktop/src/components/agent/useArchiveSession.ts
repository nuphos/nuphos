import { useState } from 'react'

import { api } from '../../api'
import { archiveChat } from '../../lib/archiveChat'
import { announceChatArchived, announceChatUnarchived } from '../../lib/chatArchiveEvents'
import { toast } from '../ui/toast'

type ArchiveTarget = { sessionId: string; teamId: string; title: string }

/** Archives the open session with the history page's Undo receipt. */
export function useArchiveSession({ sessionId, teamId, title }: ArchiveTarget) {
  const [archiving, setArchiving] = useState(false)

  /** Resolves true once the chat is archived. */
  async function archive(): Promise<boolean> {
    if (archiving) return false
    setArchiving(true)
    try {
      await archiveChat(sessionId, teamId)
      announceChatArchived({ sessionId, teamId })
      // Same receipt as the history page: one stray click must be one click to undo.
      toast.success('Chat archived', `"${title}" is still available in the Agent history.`, {
        action: {
          label: 'Undo',
          onClick: () => {
            void api
              .agentSetConversationArchived(sessionId, false, teamId)
              .then(() => announceChatUnarchived(sessionId))
              .catch((err: unknown) => toast.apiError('Could not restore chat', err))
          },
        },
      })

      return true
    } catch (err) {
      toast.apiError('Could not archive chat', err)

      return false
    } finally {
      setArchiving(false)
    }
  }

  return { archiving, archive }
}
