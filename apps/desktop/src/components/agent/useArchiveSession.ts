import { useState } from 'react'

import { t } from '../../i18n/index.ts'
import { archiveChat } from '../../lib/archiveChat'
import { offerArchiveUndo } from '../../lib/archiveUndo'
import { announceChatArchived } from '../../lib/chatArchiveEvents'
import { toast } from '../ui/toast'

type ArchiveTarget = { sessionId: string; teamId: string; title: string }

/** Archives the open session with the history page's Undo receipt. */
export function useArchiveSession({ sessionId, teamId, title }: ArchiveTarget) {
  const [archiving, setArchiving] = useState(false)

  async function archive() {
    if (archiving) return
    setArchiving(true)
    try {
      await archiveChat(sessionId, teamId)
      announceChatArchived({ sessionId, teamId })
      offerArchiveUndo({ sessionId, teamId, title })
    } catch (err) {
      toast.apiError(t('Could not archive agent'), err)
    } finally {
      setArchiving(false)
    }
  }

  return { archiving, archive }
}
