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
): { text: string; action: { label: string; run: () => void } | null } {
  const name = value?.label ?? 'The agent'

  if (reachability === 'offline') {
    const box = options?.find((instance) => instance.id === value?.id)?.local?.deviceLabel

    return {
      text: `${box ?? 'Its Box'} is offline, so ${name} cannot take messages.`,
      action: {
        label: 'Retry',
        run: () => window.dispatchEvent(new Event(RUNTIME_INSTANCES_CHANGED)),
      },
    }
  }
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
export function AgentStatusBanner({ control }: { control: RuntimeControl }) {
  const reachability = selectedAgentReachability(control)
  const blocked = reachability === 'signIn' || reachability === 'offline' ? reachability : null
  // The words stay while the banner leaves, so it closes on what it said.
  const [shown, setShown] = useState(blocked)

  if (blocked && blocked !== shown) setShown(blocked)
  const variant = shown ? BANNER[shown] : null
  const { text, action } = shown ? bannerCopy(shown, control) : { text: '', action: null }

  return (
    <div
      role="status"
      aria-hidden={!blocked}
      // Leaving, it keeps its words for the exit animation but takes no focus or clicks.
      inert={!blocked}
      className={clsx(
        't-toast absolute inset-x-4 bottom-full',
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
