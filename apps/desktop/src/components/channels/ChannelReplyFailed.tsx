import { CircleAlert } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { t } from '../../i18n'
import { formatResetsAt } from '../../lib/runtimeQuota'
import { requestAgentMenu } from '../agent/panel/agentMenuRequest'
import { Button } from '../ui/button'
import { toast } from '../ui/toast'

import type { AgentTimelineEvent } from '../../api'

/** An `agent_reply_failed` line: the agent, whether it was the cause, and when its usage returns. */
type ReplyFailedEvent = AgentTimelineEvent & {
  agentId?: string
  cause?: 'usage_limit' | 'auth' | 'offline' | 'other'
  resetsAt?: string
}

/**
 * An agent could not reply: what happened and why (the server's line), when its
 * usage returns, and the fix. Only the latest line offers it; Switch agent only
 * to the agent's owner, the one who can move it.
 */
export function ChannelReplyFailed({
  event,
  channelId,
  teamId,
  actionable,
  ownedAgents,
  onOpenSession,
}: {
  event: ReplyFailedEvent
  channelId: string
  teamId: string
  actionable: boolean
  /** The viewer's own agents: only an agent's owner can move it. */
  ownedAgents: ReadonlySet<string>
  onOpenSession: (sessionId: string) => void
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
    <div className="flex justify-center py-1">
      <div className="flex max-w-[560px] items-start gap-2 rounded-xl border border-line-control/60 bg-main px-3 py-2 text-[12.5px] text-secondary">
        <CircleAlert className="mt-[2px] h-3.5 w-3.5 shrink-0 text-warning" strokeWidth={2.5} />
        <div className="flex min-w-0 flex-col gap-1.5">
          <span>
            {event.text}
            {resets && <> {t('Usage {resets}.', { resets })}</>}
          </span>
          {actionable && agentId && (
            <div className="flex gap-1.5">
              {canSwitch && (
                <Button size="sm" variant="secondary" onClick={switchAgent}>
                  {t('Switch agent')}
                </Button>
              )}
              <Button size="sm" variant="ghost" disabled={retrying} onClick={retry}>
                {t('Retry')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
