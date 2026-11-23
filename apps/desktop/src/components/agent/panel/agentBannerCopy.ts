import { t } from '../../../i18n/index.ts'

import { agentFixLabel } from './agentRowFix.ts'
import { selectedAgentName } from './runtimeControlSignOut.ts'

import type { AgentFix } from './agentRowFix.ts'
import type { ComputerNotice } from './useComputerNotice'
import type { RuntimeControl } from './RuntimeSelector'

export type BannerCopy = { text: string; action: { label: string; run: () => void } | null }

/** What the banner can start: the picker's fixes, and the sign-in this conversation already asked for. */
export type BannerFixes = {
  run: (fix: AgentFix) => void
  canAsk: (fix: AgentFix) => boolean
  /** Who this window asked to sign the agent in, once it has. */
  askedName?: string
}

/**
 * The banner's words for an agent that cannot take a message, and the one thing to do
 * about it: the same fix the picker offers for that agent.
 */
export function reachabilityCopy(
  reachability: 'signIn' | 'offline',
  control: Pick<RuntimeControl, 'value' | 'options' | 'onSettings'>,
  fix: AgentFix | undefined,
  fixes: BannerFixes,
  onSwitchAgent?: () => void,
): BannerCopy {
  const copy = signedOutOrOfflineCopy(reachability, control, fix, fixes, onSwitchAgent)
  const problem = control.options?.find((instance) => instance.id === control.value?.id)?.local
    ?.probeError

  return reachability === 'signIn' && problem ? { text: problem, action: null } : copy
}

function signedOutOrOfflineCopy(
  reachability: 'signIn' | 'offline',
  control: Pick<RuntimeControl, 'value' | 'options' | 'onSettings'>,
  fix: AgentFix | undefined,
  fixes: BannerFixes,
  onSwitchAgent?: () => void,
): BannerCopy {
  const runFix = fixes.run
  const name = selectedAgentName(control)
  // A new chat has nothing to retry or reconnect yet: it just starts on another agent.
  const switchAgent = onSwitchAgent && { label: t('Switch runtime'), run: onSwitchAgent }

  if (reachability === 'offline') {
    const box = control.options?.find((instance) => instance.id === control.value?.id)?.local
      ?.deviceLabel

    return {
      text: box ? t('{box} is offline.', { box }) : t('Its computer is offline.'),
      // A paused Box never reads offline (runtimeControlSignOut): it resumes on the send.
      action: switchAgent ?? fixAction({ kind: 'retry' }, runFix),
    }
  }
  if (switchAgent) return { text: t('{name} is signed out.', { name }), action: switchAgent }
  // A teammate's computer: only its owner can sign it in, administrators included.
  if (fix?.kind === 'ask') return askCopy(fix, fixes, name)
  // This computer's CLI, a runtime sign-in, or settings.
  if (fix && (fix.kind !== 'settings' || control.onSettings))
    return {
      text: t('{name} is signed out. Sign it in to send messages.', { name }),
      action: fixAction(fix, runFix),
    }

  return {
    text: t('{name} is signed out. Ask a team administrator to reconnect this runtime.', {
      name,
    }),
    action: null,
  }
}

function askCopy(
  fix: Extract<AgentFix, { kind: 'ask' }>,
  fixes: BannerFixes,
  name: string,
): BannerCopy {
  if (fixes.askedName)
    return {
      text: t('Asked {name}. You can send once they sign it in.', { name: fixes.askedName }),
      action: null,
    }
  const label = fix.name ? t('Ask {name} to sign in', { name: fix.name }) : t('Ask to sign in')

  return {
    text: t('{name} is signed out. Ask its owner to sign it in.', { name }),
    action: fixes.canAsk(fix) ? { label, run: () => fixes.run(fix) } : null,
  }
}

function fixAction(fix: AgentFix, runFix: (fix: AgentFix) => void) {
  const label = fix.kind === 'settings' ? t('Runtime settings') : agentFixLabel(fix)

  return label ? { label, run: () => runFix(fix) } : null
}

/**
 * A paused Box takes the message and wakes for it, so the banner says that and offers nothing:
 * the send is the resume. At the team's vCPU limit it comes back refused, with the limit's own
 * words (stream-errors.ts).
 */
export function pausedCopy(box: string): BannerCopy {
  return { text: t('{box} is paused. It resumes when you send.', { box }), action: null }
}

/**
 * A computer whose disk is almost full still takes the message; the banner says what is coming,
 * and Free space opens the Box card's own Clear caches in place.
 */
export function diskFullCopy(
  computer: { label: string; percent: number },
  clear?: () => void,
): BannerCopy {
  return {
    text: t('{box}’s disk is almost full ({percent}%). Bots and tasks on it may fail.', {
      box: computer.label,
      percent: String(computer.percent),
    }),
    action: clear ? { label: t('Free space'), run: clear } : null,
  }
}

/**
 * A computer whose Nuphos is older than supported: said before the message goes, not after it
 * fails. Update opens the computer card's own update in place; a viewer who cannot update it
 * reads the card's words for who can.
 */
export function outdatedCopy(box: string, fix: { update?: () => void; hint?: string }): BannerCopy {
  const text = t('Nuphos on {box} is out of date. Bots and tasks on it may fail.', { box })

  if (fix.update) return { text, action: { label: t('Update'), run: fix.update } }

  return { text: fix.hint ? `${text} ${fix.hint}` : text, action: null }
}

/** The banner for what is wrong with the agent's computer, which still takes the message. */
export function noticeCopy(
  notice: ComputerNotice | null,
  fix: Parameters<typeof outdatedCopy>[1] & { clear?: () => void },
): BannerCopy {
  if (!notice) return { text: '', action: null }
  if (notice.kind === 'paused') return pausedCopy(notice.label)

  return notice.kind === 'disk' ? diskFullCopy(notice, fix.clear) : outdatedCopy(notice.label, fix)
}
