import { Archive, Loader2 } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { archiveChat } from '../../lib/archiveChat'
import { announceChatArchived, announceChatUnarchived } from '../../lib/chatArchiveEvents'
import { toast } from '../ui/toast'
import { Tooltip } from '../ui/tooltip'

/** Titlebar action beside Share: archive the open session. */
export function SessionArchiveButton({
  sessionId,
  teamId,
  title,
}: {
  sessionId: string
  teamId: string
  title: string
}) {
  const [archiving, setArchiving] = useState(false)
  const label = archiving ? 'Archiving…' : 'Archive chat'

  async function archive() {
    if (archiving) return
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
    } catch (err) {
      toast.apiError('Could not archive chat', err)
    } finally {
      setArchiving(false)
    }
  }

  return (
    <Tooltip content={label} side="bottom">
      <button
        type="button"
        disabled={archiving}
        aria-busy={archiving}
        aria-label={label}
        onClick={() => void archive()}
        className="titlebar-no-drag ml-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-secondary transition-colors hover:bg-zGray-800/60 hover:text-main disabled:opacity-60 motion-reduce:transition-none"
      >
        {archiving ? (
          <Loader2
            className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
        ) : (
          <Archive className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
        )}
      </button>
    </Tooltip>
  )
}
