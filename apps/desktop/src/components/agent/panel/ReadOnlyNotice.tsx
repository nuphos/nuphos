import { faSlack } from '@fortawesome/free-brands-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'
import { Ban, ExternalLink, Hourglass, KeyRound, Loader2, WifiOff } from 'lucide-react'
import { useCallback, useState } from 'react'

import { api } from '../../../api'
import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { RUNTIME_INSTANCES_CHANGED } from '../../../hooks/useRuntimeInstances'
import { useThisComputer } from '../../../hooks/useThisComputer'
import { t } from '../../../i18n'
import { agentTier } from '../../../lib/agentName'
import { conversationReadOnlyLabel } from '../../../lib/conversationActivityBadges'
import { boxRestarts } from '../../../views/settings/boxRestartStore'
import { RuntimeLoginDialog } from '../../../views/settings/RuntimeLoginDialog'
import { Button } from '../../ui/button'
import { toast } from '../../ui/toast'

import { ConversationActivityBadges } from './historyRows'
import { sharedComputerLabel, shareApprovalText } from './queuedShareApproval'
import { selectedAgentReachability } from './runtimeControlSignOut'
import { slackThreadFallbackUrl } from './slackThreadUrl'
import { useShareApprovalWait } from './useShareApprovalWait'

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

/** What the viewer can do about the agent from here, worked out by the banner. */
type BannerFix = { signIn?: () => void; resume?: () => void; ownerComputer?: string }

async function resumeBox(deviceId: string, teamId: string) {
  try {
    await api.boxResume(deviceId, teamId)
    boxRestarts.start(deviceId, teamId, 'resume')
  } catch (error) {
    toast.apiError(t('Could not resume computer'), error)
  }
}

function bannerCopy(
  reachability: BannerKind,
  control: RuntimeControl,
  onSwitchAgent?: () => void,
  fix: BannerFix = {},
): { text: string; action: { label: string; run: () => void } | null } {
  const { value, options, canUpdateTeamAgents: isTeamAdmin, onSettings } = control
  const name = value?.label ?? t('The runtime')
  // A new chat has nothing to retry or reconnect yet: it just starts on another agent.
  const switchAgent = onSwitchAgent && { label: t('Switch runtime'), run: onSwitchAgent }

  if (reachability === 'waiting' || reachability === 'declined') {
    const computer = sharedComputerLabel(control)

    return reachability === 'waiting'
      ? { text: shareApprovalText('pending', computer), action: null }
      : { text: shareApprovalText('denied', computer), action: switchAgent ?? null }
  }
  if (reachability === 'offline') {
    const box = options?.find((instance) => instance.id === value?.id)?.local?.deviceLabel

    return {
      text: box ? t('{box} is offline.', { box }) : t('Its computer is offline.'),
      action: (fix.resume && { label: t('Resume'), run: fix.resume }) ??
        switchAgent ?? {
          label: t('Retry'),
          run: () => window.dispatchEvent(new Event(RUNTIME_INSTANCES_CHANGED)),
        },
    }
  }
  if (switchAgent) return { text: t('{name} is signed out.', { name }), action: switchAgent }
  if (fix.signIn)
    return {
      text: t('{name} is signed out. Sign it in to send messages.', { name }),
      action: { label: t('Sign in'), run: fix.signIn },
    }
  // A teammate's computer: only its owner can sign it in, administrators included.
  if (fix.ownerComputer)
    return {
      text: t('{name} is signed out. Ask the owner of {computer} to sign it in.', {
        name,
        computer: fix.ownerComputer,
      }),
      action: null,
    }
  // Only an administrator can sign a team agent back in.
  if (isTeamAdmin && onSettings)
    return {
      text: t('{name} is signed out. Sign it in to send messages.', { name }),
      action: { label: t('Runtime settings'), run: onSettings },
    }

  return {
    text: t('{name} is signed out. Ask a workspace administrator to reconnect this runtime.', {
      name,
    }),
    action: null,
  }
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
  const [signingIn, setSigningIn] = useState(false)
  const viewerId = useCurrentUser()?.id
  const thisComputer = useThisComputer()
  const selected = control.options?.find((instance) => instance.id === control.value?.id)
  // Your own Box or other computer signs in from here; this computer's agent uses its CLI.
  const ownSignIn =
    reachability === 'signIn' &&
    control.teamId &&
    viewerId &&
    selected?.local?.ownerUserId === viewerId &&
    agentTier(selected, thisComputer) === 'remote'
      ? { teamId: control.teamId, instance: selected }
      : null
  const local = selected?.local
  const teamId = control.teamId
  const fix: BannerFix = {
    ...(ownSignIn && { signIn: () => setSigningIn(true) }),
    ...(reachability === 'signIn' &&
      local &&
      local.ownerUserId !== viewerId && { ownerComputer: local.deviceLabel }),
    // Your own paused Box wakes from here instead of Retry.
    ...(reachability === 'offline' &&
      teamId &&
      local?.box?.state === 'paused' &&
      local.ownerUserId === viewerId && { resume: () => void resumeBox(local.deviceId, teamId) }),
  }

  if (blocked && blocked !== shown) setShown(blocked)
  const variant = shown ? BANNER[shown] : null
  const { text, action } = shown
    ? bannerCopy(shown, control, onSwitchAgent, fix)
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
      {signingIn && ownSignIn && (
        <RuntimeLoginDialog
          teamId={ownSignIn.teamId}
          instance={ownSignIn.instance}
          onClose={() => setSigningIn(false)}
        />
      )}
    </>
  )
}
