import { Archive } from 'lucide-react'
import { useState } from 'react'

import { t } from '../../../i18n'
import { agentAvatarPick } from '../../../lib/agentAvatarChoices'
import { archiveChat } from '../../../lib/archiveChat'
import { announceChatArchived } from '../../../lib/chatArchiveEvents'
import { Button } from '../../ui/button'
import { toast } from '../../ui/toast'

import { SummarySection } from './ChatSummaryRows'

import type { AgentConversation } from '../../../api/agent-types'

export function ChatSummaryTaskActions({
  conversation,
  teamId,
}: {
  conversation: AgentConversation
  teamId: string
}) {
  const [archiving, setArchiving] = useState(false)

  if (conversation.kind === 'channel' || conversation.avatar || conversation.archivedAt) return null
  const sessionId = conversation.sessionId
  const canArchive = conversation.isOwner !== false || conversation.canManage

  async function archive() {
    setArchiving(true)
    try {
      await archiveChat(sessionId, teamId)
      announceChatArchived({ sessionId, teamId })
    } catch (error) {
      toast.apiError(
        agentAvatarPick(sessionId) ? t('Could not archive Bot') : t('Could not archive task'),
        error,
      )
    } finally {
      setArchiving(false)
    }
  }

  return (
    <SummarySection title={t('Task actions')}>
      <div className="flex flex-wrap gap-2">
        {canArchive && (
          <Button variant="secondary" size="sm" disabled={archiving} onClick={() => void archive()}>
            <Archive className="size-3.5" />
            {t('Archive')}
          </Button>
        )}
      </div>
    </SummarySection>
  )
}
