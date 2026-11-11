import { MessageSquare } from 'lucide-react'

import { t } from '../../../i18n'
import { Button } from '../../ui/button'

import { useOpenTriggerConversation } from './triggerLinks'

import type { AgentTrigger } from '../../../api/agent-trigger-types'

/** From the Triggers page straight to the conversation a Trigger delivers into. */
export function OpenBoundConversationButton({
  trigger,
  teamId = trigger?.teamId,
  onOpened,
  className,
}: {
  trigger: AgentTrigger | undefined
  teamId?: string
  onOpened?: () => void
  className?: string
}) {
  const open = useOpenTriggerConversation()
  const sessionId = trigger?.targetSessionId

  if (!sessionId || !teamId) return null

  return (
    <Button
      variant="secondary"
      size="sm"
      className={className}
      onClick={() => {
        onOpened?.()
        open(sessionId, teamId)
      }}
    >
      <MessageSquare aria-hidden className="h-3.5 w-3.5" strokeWidth={1.8} />
      {t('Open conversation')}
    </Button>
  )
}
