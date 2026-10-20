import { faSlack } from '@fortawesome/free-brands-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'
import { ExternalLink, KeyRound, Loader2, WifiOff } from 'lucide-react'
import { useCallback, useState } from 'react'

import { api } from '../../../api'
import { RUNTIME_INSTANCES_CHANGED } from '../../../hooks/useRuntimeInstances'
import { conversationReadOnlyLabel } from '../../../lib/conversationActivityBadges'
import { Button } from '../../ui/button'
import { toast } from '../../ui/toast'

import { ASK_ADMIN_TO_RECONNECT } from './AgentSetupRequiredCard'
import { ConversationActivityBadges } from './historyRows'
import { selectedAgentReachability } from './runtimeControlSignOut'
import { slackThreadFallbackUrl } from './slackThreadUrl'

import type { RuntimeControl } from './RuntimeSelector'
import type { AgentConversation, AgentSlackThread } from '../../../api'

export function ReadOnlyConversationNotice({
  activitySource,
  slackThread,
  label,
}: {
  activitySource?: AgentConversation['activitySource']
  slackThread?: AgentSlackThread | null
  // Overrides the default read-only copy — e.g. the gated "connect an
  // integration" guidance, which would otherwise be hidden behind this notice.
  label?: string
}) {
  return (
    <div className="flex min-h-9 min-w-0 items-center gap-2">
      <ConversationActivityBadges source={activitySource} />
      <span className="min-w-0 truncate text-[13px] text-secondary">
        {label ?? conversationReadOnlyLabel(activitySource, Boolean(slackThread))}
      </span>
      {slackThread && <span className="sr-only">Use the Open thread button to reply.</span>}
    </div>
  )
}

export function OpenSlackThreadButton({ thread }: { thread: AgentSlackThread }) {
  const [opening, setOpening] = useState(false)
  const threadUrl = thread.url ?? slackThreadFallbackUrl(thread)

  const openThread = useCallback(() => {
    if (opening) return
    setOpening(true)
    api
      .appOpenExternal(threadUrl)
      .catch((err: unknown) => {
        toast.apiError('Failed to open Slack thread', err)
      })
      .finally(() => setOpening(false))
  }, [opening, threadUrl])

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={openThread}
      disabled={opening}
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium disabled:cursor-wait disabled:opacity-60"
      title="Open the linked Slack thread"
      aria-label="Open the linked Slack thread"
    >
      {opening ? (
        <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
      ) : (
        <FontAwesomeIcon icon={faSlack} className="h-3 w-3" />
      )}
      <span>Open thread</span>
      <ExternalLink className="h-3 w-3" strokeWidth={1.8} />
    </Button>
  )
}

const BANNER = {
  signIn: {
    Icon: KeyRound,
    icon: 'text-warning',
    border: 'border-warning/35',
    tint: 'bg-warning/10',
  },
  offline: { Icon: WifiOff, icon: 'text-error', border: 'border-error/35', tint: 'bg-error/10' },
} as const

function bannerCopy(
  reachability: 'signIn' | 'offline',
  { value, options, canUpdateTeamAgents: isTeamAdmin, onSettings }: RuntimeControl,
  onSwitchAgent?: () => void,
): { text: string; action: { label: string; run: () => void } | null } {
  const name = value?.label ?? 'The agent'
  // A new chat has nothing to retry or reconnect yet: it just starts on another agent.
  const switchAgent = onSwitchAgent && { label: 'Switch agent', run: onSwitchAgent }

  if (reachability === 'offline') {
    const box = options?.find((instance) => instance.id === value?.id)?.local?.deviceLabel

    return {
      text: `${box ?? 'Its Box'} is offline.`,
      action: switchAgent ?? {
        label: 'Retry',
        run: () => window.dispatchEvent(new Event(RUNTIME_INSTANCES_CHANGED)),
      },
    }
  }
  if (switchAgent) return { text: `${name} is signed out.`, action: switchAgent }
  // Only an administrator can sign a team agent back in.
  if (isTeamAdmin && onSettings)
    return {
      text: `${name} is signed out. Sign it in to send messages.`,
      action: { label: 'Agent settings', run: onSettings },
    }

  return { text: `${name} is signed out. ${ASK_ADMIN_TO_RECONNECT}`, action: null }
}

/**
 * Said before the message goes, not after it fails. A slim tab on the composer's
 * top edge: positioned out of flow, so showing or hiding it never moves the input.
 * Agent reachability owns this edge; anything else about the turn sits below.
 */
export function AgentStatusBanner({
  control,
  hero = false,
  onSwitchAgent,
}: {
  control: RuntimeControl
  /** The new-chat card: wider corners to clear. */
  hero?: boolean
  /** Set for a new chat, whose fix is picking another agent. */
  onSwitchAgent?: () => void
}) {
  const reachability = selectedAgentReachability(control)
  const blocked = reachability === 'signIn' || reachability === 'offline' ? reachability : null
  // The words stay while the banner leaves, so it closes on what it said.
  const [shown, setShown] = useState(blocked)

  if (blocked && blocked !== shown) setShown(blocked)
  const variant = shown ? BANNER[shown] : null
  const { text, action } = shown
    ? bannerCopy(shown, control, onSwitchAgent)
    : { text: '', action: null }

  return (
    <div
      role="status"
      aria-hidden={!blocked}
      // Leaving, it keeps its words for the exit animation but takes no focus or clicks.
      inert={!blocked}
      className={clsx(
        't-toast absolute bottom-full',
        hero ? 'inset-x-6' : 'inset-x-4',
        blocked ? 'is-open' : 'pointer-events-none',
      )}
    >
      {variant && (
        <div
          className={clsx(
            'relative overflow-hidden rounded-t-[10px] border border-b-0 bg-composer',
            variant.border,
          )}
        >
          <span aria-hidden className={clsx('absolute inset-0', variant.tint)} />
          <div className="relative flex h-8 min-w-0 items-center gap-2 px-3 text-[12.5px] text-secondary">
            <variant.Icon aria-hidden className={clsx('h-3.5 w-3.5 shrink-0', variant.icon)} />
            <span className="min-w-0 flex-1 truncate">{text}</span>
            {action && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-6 shrink-0 px-2 text-[12px]"
                onClick={action.run}
              >
                {action.label}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
