import { t } from '../../../i18n'
import { AgentAvatar } from '../AgentAvatar'
import { ChatLink } from '../MessageResponse'

import type { AgentInputRequest } from '../../../api/agent-types'

/** The server has already checked which recipients this viewer may see. */
export function DecisionConversations({
  conversations,
  teamId,
}: {
  conversations: AgentInputRequest['aboutConversations']
  teamId?: string
}) {
  if (!conversations?.length || !teamId) return null

  return (
    <div
      data-decision-conversations
      className="flex flex-wrap items-center gap-1.5 text-[12px] text-secondary"
    >
      <span>{t('Acted on by')}</span>
      {conversations.map(({ sessionId, title }) => (
        <ChatLink
          key={sessionId}
          link={`/teams/${teamId}/agent/${sessionId}`}
          className="inline-flex max-w-full items-center gap-1 rounded-md border border-line-control px-1.5 py-1 text-main"
        >
          <AgentAvatar agentId={sessionId} size={16} showBadge={false} />
          <span className="max-w-[32ch] truncate">{title || t('Conversation')}</span>
        </ChatLink>
      ))}
    </div>
  )
}
