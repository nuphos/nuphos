import { faSlack } from '@fortawesome/free-brands-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'
import { CircleAlert, ExternalLink, Loader2, X } from 'lucide-react'
import { useCallback, useState } from 'react'

import { api } from '../../../api'
import { t } from '../../../i18n'
import { conversationReadOnlyLabel } from '../../../lib/conversationActivityBadges'
import { Button } from '../../ui/button'
import { toast } from '../../ui/toast'

import { noticeCopy } from './agentBannerCopy'
import { BANNER, bannerCopy } from './agentBannerVariants'
import { agentProblem } from './agentRowFix'
import { dismissDisk } from './diskSnooze'
import { ConversationActivityBadges } from './historyRows'
import { runtimeGone, selectedAgentReachability } from './runtimeControlSignOut'
import { useAskedName } from './signInAsks'
import { slackThreadFallbackUrl } from './slackThreadUrl'
import { useClearCachesFix } from './useClearCachesFix'
import { useComputerNotice } from './useComputerNotice'
import { useOutdatedFix } from './useOutdatedFix'
import { usePickerFixes } from './usePickerFixes'
import { useShareApprovalWait } from './useShareApprovalWait'

import type { BannerCopy } from './agentBannerCopy'
import type { BannerKind, BlockedKind } from './agentBannerVariants'
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
  /** Set for a new chat, a gone agent, or an offline computer the conversation may leave: the fix is picking another. */
  onSwitchAgent?: () => void
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
    (control.offlineAgent ? 'offline' : null) ??
    (shareApproval === 'pending' ? 'waiting' : shareApproval === 'denied' ? 'declined' : null)
  // An agent that can take the message, on a computer about to fail it: said, without blocking.
  const { notice, device, reload } = useComputerNotice(control)
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
  const outdatedFix = useOutdatedFix(control.teamId ?? '', device, selected?.id, reload)
  const clearFix = useClearCachesFix(control.teamId ?? '', device)
  const fix =
    unreachable && selected ? agentProblem(selected, undefined, fixes.viewer)?.fix : undefined

  if (active && active !== shown) setShown(active)
  if (notice && JSON.stringify(notice) !== JSON.stringify(noticed)) setNoticed(notice)
  const variant = shown ? BANNER[shown] : null
  let copy: BannerCopy = { text: '', action: null }

  if (shown === 'disk' || shown === 'outdated' || shown === 'paused')
    copy = noticeCopy(noticed, { ...outdatedFix, clear: clearFix.clear })
  else if (shown)
    copy = bannerCopy(
      shown,
      control,
      fix,
      { ...fixes, ...(askedName && { askedName }) },
      onSwitchAgent,
    )
  if (shown === 'offline' && !unreachable && control.offlineAgent)
    copy = {
      text: t('{name}’s computer is offline.', { name: control.offlineAgent }),
      action: null,
    }
  const { text, action } = copy
  const Icon = shown === 'signIn' && selected?.local?.probeError ? CircleAlert : variant?.Icon
  // Only the disk warning is the person's to put away: the rest block the message they are sending.
  const putAway =
    shown === 'disk' && noticed?.kind === 'disk'
      ? () => dismissDisk(noticed.deviceId, noticed.percent)
      : null

  return (
    <>
      <div
        data-composer-overlay=""
        role="status"
        aria-hidden={!active}
        // Leaving, it keeps its words for the exit animation but takes no focus or clicks.
        inert={!active}
        className={clsx(
          't-toast',
          active ? 'relative' : 'absolute bottom-0',
          active ? (hero ? 'mx-6' : 'mx-4') : hero ? 'inset-x-6' : 'inset-x-4',
          active ? 'is-open' : 'pointer-events-none',
        )}
      >
        {variant && Icon && (
          <div
            className={clsx(
              'relative overflow-hidden rounded-t-[10px] border border-b-0 bg-composer',
              variant.border,
            )}
          >
            <span aria-hidden className={clsx('absolute inset-0', variant.tint)} />
            {/* A long reason wraps and the tab grows upward, never under the input. */}
            <div className="relative flex min-h-8 min-w-0 items-center gap-2 px-3 py-1 text-[12.5px] leading-snug text-secondary">
              <Icon aria-hidden className={clsx('h-3.5 w-3.5 shrink-0', variant.icon)} />
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
              {putAway && (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="shrink-0"
                  title={t('Dismiss for today')}
                  aria-label={t('Dismiss for today')}
                  data-testid="disk-notice-dismiss"
                  onClick={putAway}
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
      {dialogs}
      {outdatedFix.dialog}
      {clearFix.dialog}
    </>
  )
}
