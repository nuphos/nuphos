import { useState } from 'react'

import { archiveChat } from '../../lib/archiveChat'
import { archiveWithThreads } from '../../lib/archiveWithThreads'
import { announceChatArchived } from '../../lib/chatArchiveEvents'

type ArchiveTarget = { sessionId: string; teamId: string; title: string }

/** Archives the open session, and any threads chosen with it, behind one Undo receipt. */
export function useArchiveSession({ sessionId, teamId, title }: ArchiveTarget) {
  const [archiving, setArchiving] = useState(false)

  /** Resolves true once the chat is archived. */
  async function archive(threadIds: string[] = []): Promise<boolean> {
    if (archiving) return false
    setArchiving(true)
    try {
      return await archiveWithThreads({
        sessionId,
        threadIds,
        title,
        teamId,
        archiveOne: (id) =>
          archiveChat(id, teamId).then(
            () => {
              announceChatArchived({ sessionId: id, teamId })

              return true
            },
            () => false,
          ),
      })
    } finally {
      setArchiving(false)
    }
  }

  return { archiving, archive }
}
