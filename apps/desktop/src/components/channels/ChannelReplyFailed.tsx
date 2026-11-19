import { useState } from 'react'

import { api } from '../../api'
import { t } from '../../i18n'
import { formatResetsIn } from '../../lib/runtimeQuota'
import { requestAgentMenu } from '../agent/panel/agentMenuRequest'
import { FailureRow } from '../agent/panel/FailureRow'
import { toast } from '../ui/toast'

import { ChannelReplyFix } from './ChannelReplyFix'

import type { ChannelFixes } from './ChannelReplyFix'
import type { ReplyFailedCause } from './replyFix'
import type { AgentTimelineEvent } from '../../api'

/** An `agent_reply_failed` line: the agent, whether it was the cause, and when its usage returns. */
type ReplyFailedEvent = AgentTimelineEvent & {
  agentId?: string
  cause?: ReplyFailedCause
  resetsAt?: string
}

/** A web address in the server's line, such as where a provider asks the account holder to act. */
const WEB_URL = /(https:\/\/[^\s()]+[^\s().,])/u

/** The line with its web addresses as links, which open in the browser. */
function withLinks(text: string) {
  return text.split(WEB_URL).map((piece, index) =>
    index % 2 ? (
      <a key={index} href={piece} target="_blank" rel="noreferrer" className="underline">
        {piece}
      </a>
    ) : (
      piece
    ),
  )
}

/**
 * An agent could not reply: what happened and why (the server's line), when its
 * usage returns, and the fix. Only the latest line offers it; Switch runtime only
 * to the agent's owner, the one who can move it.
 */
export function ChannelReplyFailed({
  event,
  channelId,
  teamId,
  actionable,
  ownedAgents,
  onOpenSession,
  fixes = {},
}: {
  event: ReplyFailedEvent
  channelId: string
  teamId: string
  actionable: boolean
  /** The viewer's own agents: only an agent's owner can move it. */
  ownedAgents: ReadonlySet<string>
  onOpenSession: (sessionId: string) => void
  /** What the workspace lends to repair the agent, such as its runtime settings. */
  fixes?: ChannelFixes
}) {
  const [retrying, setRetrying] = useState(false)
  const agentId = event.agentId
  const resets = event.cause === 'usage_limit' ? formatResetsIn(event.resetsAt) : null
  const canSwitch =
    actionable &&
    ownedAgents.has(agentId ?? '') &&
    event.cause !== undefined &&
    event.cause !== 'other'
  const retry = () => {
    if (!agentId) return
    setRetrying(true)
    api
      .agentWakeChannelAgent(channelId, teamId, agentId)
      .catch((error: unknown) => toast.apiError(t('Could not retry'), error))
      .finally(() => setRetrying(false))
  }
  const switchAgent = () => {
    if (!agentId) return
    requestAgentMenu(agentId)
    onOpenSession(agentId)
  }

  return (
    <FailureRow
      fix={
        actionable &&
        agentId && (
          <ChannelReplyFix
            teamId={teamId}
            agentId={agentId}
            cause={event.cause}
            fixes={fixes}
            onFixed={retry}
          />
        )
      }
      onSwitchAgent={canSwitch && agentId ? switchAgent : undefined}
      onRetry={actionable && agentId ? retry : undefined}
      retrying={retrying}
    >
      {withLinks(event.text)}
      {resets && <> {t('Usage {resets}.', { resets })}</>}
    </FailureRow>
  )
}
