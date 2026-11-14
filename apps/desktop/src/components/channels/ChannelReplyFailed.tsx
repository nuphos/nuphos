import { useState } from 'react'

import { api } from '../../api'
import { t } from '../../i18n'
import { formatResetsAt } from '../../lib/runtimeQuota'
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
  const resets =
    event.cause === 'usage_limit' ? formatResetsAt(event.resetsAt ?? null, new Date()) : null
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
      {event.text}
      {resets && <> {t('Usage {resets}.', { resets })}</>}
    </FailureRow>
  )
}
