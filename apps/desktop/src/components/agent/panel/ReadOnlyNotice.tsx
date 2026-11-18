import { faSlack } from '@fortawesome/free-brands-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'
import {
  Ban,
  ExternalLink,
  HardDrive,
  Hourglass,
  KeyRound,
  Loader2,
  RefreshCw,
  WifiOff,
} from 'lucide-react'
import { useCallback, useState } from 'react'

import { api } from '../../../api'
import { t } from '../../../i18n'
import { conversationReadOnlyLabel } from '../../../lib/conversationActivityBadges'
import { Button } from '../../ui/button'
import { toast } from '../../ui/toast'

import { diskFullCopy, outdatedCopy, reachabilityCopy } from './agentBannerCopy'
import { agentProblem } from './agentRowFix'
import { ConversationActivityBadges } from './historyRows'
import { sharedComputerLabel, shareApprovalText } from './queuedShareApproval'
import { runtimeGone, runtimeGoneText, selectedAgentReachability } from './runtimeControlSignOut'
import { useAskedName } from './signInAsks'
import { useComputerNotice } from './useComputerNotice'
import { slackThreadFallbackUrl } from './slackThreadUrl'
import { usePickerFixes } from './usePickerFixes'
import { useShareApprovalWait } from './useShareApprovalWait'

import type { BannerCopy, BannerFixes } from './agentBannerCopy'
import type { AgentFix } from './agentRowFix'
import type { RuntimeControl } from './RuntimeSelector'
import type { ComputerNotice } from './useComputerNotice'
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
  gone: { Icon: Ban, icon: 'text-error', border: 'border-error/35', tint: 'bg-error/10' },
  disk: {
    Icon: HardDrive,
    icon: 'text-warning',
    border: 'border-warning/35',
    tint: 'bg-warning/10',
  },
  outdated: {
    Icon: RefreshCw,
    icon: 'text-warning',
    border: 'border-warning/35',
    tint: 'bg-warning/10',
  },
} as const

type BannerKind = keyof typeof BANNER
/** The agent cannot take a message; the other kinds only warn about its computer. */
type BlockedKind = Exclude<BannerKind, ComputerNotice['kind']>

function bannerCopy(
  reachability: BlockedKind,
  control: RuntimeControl,
  fix: AgentFix | undefined,
  fixes: BannerFixes,
  onSwitchAgent?: () => void,
): BannerCopy {
  if (reachability === 'gone')
    return {
      text: runtimeGoneText(control),
      // Moving needs the conversation's manager; anyone else just reads why.
      action:
        onSwitchAgent && control.onSelect
          ? { label: t('Switch runtime'), run: onSwitchAgent }
          : null,
    }
  if (reachability === 'signIn' || reachability === 'offline')
    return reachabilityCopy(reachability, control, fix, fixes, onSwitchAgent)
  const computer = sharedComputerLabel(control)
  // A new chat has nothing to wait for: it just starts on another agent.
  const switchAgent = onSwitchAgent && { label: t('Switch runtime'), run: onSwitchAgent }

  return reachability === 'waiting'
    ? { text: shareApprovalText('pending', computer), action: null }
    : { text: shareApprovalText('denied', computer), action: switchAgent ?? null }
}

function noticeCopy(notice: ComputerNotice | null, onSettings?: () => void): BannerCopy {
  if (!notice) return { text: '', action: null }

  return notice.kind === 'disk'
    ? diskFullCopy(notice, onSettings)
    : outdatedCopy(notice.label, onSettings)
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
  offlineAgent,
}: {
  control: RuntimeControl
  /** The new-chat card: wider corners to clear. */
  hero?: boolean
  /** Set for a new chat, a gone agent, or an offline computer the conversation may leave: the fix is picking another. */
  onSwitchAgent?: () => void
  /** A group chat's member Bot whose computer is offline, named on the strip (#3308). */
  offlineAgent?: string
}) {
  const reachability = selectedAgentReachability(control)
  // A teammate's computer that asks its owner first: this conversation waits, or was declined.
  const shareApproval = useShareApprovalWait(control, control.sessionId)
  const unreachable = reachability === 'signIn' || reachability === 'offline' ? reachability : null
  // Reachability comes first: an offline computer cannot run it even once approved.
  // Its agent is gone: nothing else about it matters until the conversation moves.
  const blocked: BlockedKind | null =
    (runtimeGone(control) ? 'gone' : null) ??
    unreachable ??
    (offlineAgent ? 'offline' : null) ??
    (shareApproval === 'pending' ? 'waiting' : shareApproval === 'denied' ? 'declined' : null)
  // An agent that can take the message, on a computer about to fail it: said, without blocking.
  const notice = useComputerNotice(control)
  const [noticed, setNoticed] = useState(notice)
  const active: BannerKind | null = blocked ?? notice?.kind ?? null
  // The words stay while the banner leaves, so it closes on what it said.
  const [shown, setShown] = useState(active)
  const selected = control.options?.find((instance) => instance.id === control.value?.id)
  // The same fix the picker offers for this agent, so the two never disagree.
  const { fixes, dialogs } = usePickerFixes({
    teamId: control.teamId,
    isTeamAdmin: Boolean(control.canUpdateTeamAgents),
    open: unreachable !== null,
    onSettings: control.onSettings,
    sessionId: control.sessionId,
  })
  const askedName = useAskedName(control.sessionId, selected?.id)
  const fix =
    unreachable && selected ? agentProblem(selected, undefined, fixes.viewer)?.fix : undefined

  if (active && active !== shown) setShown(active)
  if (notice && JSON.stringify(notice) !== JSON.stringify(noticed)) setNoticed(notice)
  const variant = shown ? BANNER[shown] : null
  let copy: BannerCopy = { text: '', action: null }

  if (shown === 'disk' || shown === 'outdated') copy = noticeCopy(noticed, control.onSettings)
  else if (shown)
    copy = bannerCopy(
      shown,
      control,
      fix,
      { ...fixes, ...(askedName && { askedName }) },
      onSwitchAgent,
    )
  if (shown === 'offline' && !unreachable && offlineAgent)
    copy = { text: t('{name}’s computer is offline.', { name: offlineAgent }), action: null }
  const { text, action } = copy

  return (
    <>
      <div
        role="status"
        aria-hidden={!active}
        // Leaving, it keeps its words for the exit animation but takes no focus or clicks.
        inert={!active}
        className={clsx(
          't-toast absolute bottom-full',
          hero ? 'inset-x-6' : 'inset-x-4',
          active ? 'is-open' : 'pointer-events-none',
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
            {/* A long reason wraps and the tab grows upward, never under the input. */}
            <div className="relative flex min-h-8 min-w-0 items-center gap-2 px-3 py-1 text-[12.5px] leading-snug text-secondary">
              <variant.Icon aria-hidden className={clsx('h-3.5 w-3.5 shrink-0', variant.icon)} />
              <span className="min-w-0 flex-1">{text}</span>
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
