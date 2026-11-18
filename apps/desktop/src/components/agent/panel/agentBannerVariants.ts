import { Ban, HardDrive, Hourglass, KeyRound, Pause, RefreshCw, WifiOff } from 'lucide-react'

import { t } from '../../../i18n'

import { diskFullCopy, outdatedCopy, pausedCopy, reachabilityCopy } from './agentBannerCopy'
import { sharedComputerLabel, shareApprovalText } from './queuedShareApproval'
import { runtimeGoneText } from './runtimeControlSignOut'

import type { BannerCopy, BannerFixes } from './agentBannerCopy'
import type { AgentFix } from './agentRowFix'
import type { RuntimeControl } from './RuntimeSelector'
import type { ComputerNotice } from './useComputerNotice'

/** How each state of the agent's computer looks on the composer's top edge. */
export const BANNER = {
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
  // A paused Box takes the message: nothing is wrong and nothing to press, so this is the
  // quietest the banner gets.
  paused: {
    Icon: Pause,
    icon: 'text-tertiary',
    border: 'border-line-control',
    tint: 'bg-state-hover',
  },
} as const

export type BannerKind = keyof typeof BANNER
/** The agent cannot take a message; the other kinds only say something about its computer. */
export type BlockedKind = Exclude<BannerKind, ComputerNotice['kind']>

export function bannerCopy(
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

export function noticeCopy(notice: ComputerNotice | null, onSettings?: () => void): BannerCopy {
  if (!notice) return { text: '', action: null }
  if (notice.kind === 'disk') return diskFullCopy(notice, onSettings)

  return notice.kind === 'paused'
    ? pausedCopy(notice.label)
    : outdatedCopy(notice.label, onSettings)
}
