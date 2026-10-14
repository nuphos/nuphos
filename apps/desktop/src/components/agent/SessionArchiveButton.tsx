import { Archive, Loader2 } from 'lucide-react'
import { useState } from 'react'

import { archiveChat } from '../../lib/archiveChat'
import { announceChatArchived } from '../../lib/chatArchiveEvents'
import { toast } from '../ui/toast'
import { Tooltip } from '../ui/tooltip'

/** Titlebar action beside Share: archive the open session. */
export function SessionArchiveButton({ sessionId, teamId }: { sessionId: string; teamId: string }) {
  const [archiving, setArchiving] = useState(false)
  const label = archiving ? 'Archiving…' : 'Archive chat'

  async function archive() {
    if (archiving) return
    setArchiving(true)
    try {
      await archiveChat(sessionId, teamId)
      announceChatArchived({ sessionId, teamId })
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
