import { faSlack } from '@fortawesome/free-brands-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'
import { Ban, ExternalLink, Hourglass, KeyRound, Loader2, WifiOff } from 'lucide-react'
import { useCallback, useState } from 'react'

import { api } from '../../../api'
import { t } from '../../../i18n'
import { conversationReadOnlyLabel } from '../../../lib/conversationActivityBadges'
import { Button } from '../../ui/button'
import { toast } from '../../ui/toast'

import { reachabilityCopy } from './agentBannerCopy'
import { agentProblem } from './agentRowFix'
import { ConversationActivityBadges } from './historyRows'
import { sharedComputerLabel, shareApprovalText } from './queuedShareApproval'
import { selectedAgentReachability } from './runtimeControlSignOut'
import { slackThreadFallbackUrl } from './slackThreadUrl'
import { usePickerFixes } from './usePickerFixes'
import { useShareApprovalWait } from './useShareApprovalWait'

import type { BannerCopy } from './agentBannerCopy'
import type { AgentFix } from './agentRowFix'
import type { RuntimeControl } from './RuntimeSelector'
import type { ViewOnlyNotice } from './viewOnlyNotice'
import type { AgentConversation, AgentSlackThread } from '../../../api'

export function ReadOnlyConversationNotice({
  activitySource,
  slackThread,
  label,
  action,
  secondary,
}: {
  activitySource?: AgentConversation['activitySource']
  slackThread?: AgentSlackThread | null
  // Overrides the default read-only copy — e.g. the gated "connect an
  // integration" guidance, which would otherwise be hidden behind this notice.
  label?: string
  /** What the viewer can do instead, beside the reason. */
  action?: ViewOnlyNotice['action']
  secondary?: ViewOnlyNotice['secondary']
}) {
  return (
    <div className="flex min-h-9 min-w-0 items-center gap-2">
      <ConversationActivityBadges source={activitySource} />
      <span
        className={clsx(
          'min-w-0 flex-1 text-[13px] text-secondary',
          // Beside an action the reason wraps rather than hide its end.
          action ? 'leading-snug' : 'truncate',
        )}
      >
        {label ?? conversationReadOnlyLabel(activitySource, Boolean(slackThread))}
      </span>
      {secondary && (
        <Button type="button" variant="ghost" size="sm" onClick={secondary.onSelect}>
          {secondary.label}
        </Button>
      )}
      {action && (
        <Button type="button" size="sm" onClick={action.onSelect}>
          {action.label}
        </Button>
      )}
      {slackThread && <span className="sr-only">{t('Use the Open thread button to reply.')}</span>}
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
        toast.apiError(t('Failed to open Slack thread'), err)
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
      title={t('Open the linked Slack thread')}
      aria-label={t('Open the linked Slack thread')}
    >
      {opening ? (
        <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
      ) : (
        <FontAwesomeIcon icon={faSlack} className="h-3 w-3" />
      )}
      <span>{t('Open thread')}</span>
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
  waiting: {
    Icon: Hourglass,
    icon: 'text-warning',
    border: 'border-warning/35',
    tint: 'bg-warning/10',
  },
  declined: { Icon: Ban, icon: 'text-error', border: 'border-error/35', tint: 'bg-error/10' },
} as const

type BannerKind = keyof typeof BANNER

function bannerCopy(
  reachability: BannerKind,
  control: RuntimeControl,
  fix: AgentFix | undefined,
  runFix: (fix: AgentFix) => void,
  onSwitchAgent?: () => void,
): BannerCopy {
  if (reachability === 'signIn' || reachability === 'offline')
    return reachabilityCopy(reachability, control, fix, runFix, onSwitchAgent)
  const computer = sharedComputerLabel(control)
  // A new chat has nothing to wait for: it just starts on another agent.
  const switchAgent = onSwitchAgent && { label: t('Switch runtime'), run: onSwitchAgent }

  return reachability === 'waiting'
    ? { text: shareApprovalText('pending', computer), action: null }
    : { text: shareApprovalText('denied', computer), action: switchAgent ?? null }
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
  // A teammate's computer that asks its owner first: this conversation waits, or was declined.
  const shareApproval = useShareApprovalWait(control, control.sessionId)
  const unreachable = reachability === 'signIn' || reachability === 'offline' ? reachability : null
  // Reachability comes first: an offline computer cannot run it even once approved.
  const blocked: BannerKind | null =
    unreachable ??
    (shareApproval === 'pending' ? 'waiting' : shareApproval === 'denied' ? 'declined' : null)
  // The words stay while the banner leaves, so it closes on what it said.
  const [shown, setShown] = useState(blocked)
  const selected = control.options?.find((instance) => instance.id === control.value?.id)
  // The same fix the picker offers for this agent, so the two never disagree.
  const { fixes, dialogs } = usePickerFixes({
    teamId: control.teamId,
    isTeamAdmin: Boolean(control.canUpdateTeamAgents),
    open: unreachable !== null,
    onSettings: control.onSettings,
  })
  const fix =
    unreachable && selected ? agentProblem(selected, undefined, fixes.viewer)?.fix : undefined

  if (blocked && blocked !== shown) setShown(blocked)
  const variant = shown ? BANNER[shown] : null
  const { text, action } = shown
    ? bannerCopy(shown, control, fix, fixes.run, onSwitchAgent)
    : { text: '', action: null }

  return (
    <>
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
      {dialogs}
    </>
  )
}
