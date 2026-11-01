import { t } from '../../i18n/index.ts'

import type { LocalShareInput, LocalShareLevel } from '../../api/device-types'

export const SHARE_LEVELS: readonly LocalShareLevel[] = ['off', 'approve', 'full']

export const SHARE_LEVEL_LABEL: Record<LocalShareLevel, string> = {
  off: t('Not shared'),
  approve: t('Ask me first'),
  full: t('Full access'),
}

export const SHARE_LEVEL_DESCRIPTION: Record<LocalShareLevel, string> = {
  off: t('Only you can run agents on this computer.'),
  approve: t(
    'Teammates you pick can run their own agents here. You approve each agent before it starts.',
  ),
  full: t(
    'Teammates you pick can run their own agents here without asking. Use this for a machine set aside for it.',
  ),
}

/** What a teammate's agent can reach here, whatever the level: said wherever sharing is turned on. */
export const SHARE_RISK = t(
  'Their agents run as your user on this computer, with every sign-in on it: SSH keys, GitHub and cloud CLIs, and your files. Agents from Slack, Discord or triggers never run here.',
)

export const CEILING_DESCRIPTION: Record<LocalShareLevel, string> = {
  off: t('Members cannot share their own computer.'),
  approve: t('Members can share their own computer, approving each teammate’s agent.'),
  full: t('Members can also let teammates run agents on their computer without asking.'),
}

const rank = (level: LocalShareLevel) => SHARE_LEVELS.indexOf(level)

/** The levels an owner may pick under the team's ceiling. */
export function allowedLevels(ceiling: LocalShareLevel): LocalShareLevel[] {
  return SHARE_LEVELS.filter((level) => rank(level) <= rank(ceiling))
}

/** The share as it applies now: an owner's level, lowered to the team's ceiling. */
export function effectiveShare(share: LocalShareInput, ceiling: LocalShareLevel): LocalShareInput {
  return rank(share.level) <= rank(ceiling) ? share : { ...share, level: ceiling }
}

/** One line for the card: how far this computer is shared, and with whom. */
export function shareSummary(share: LocalShareInput, memberCount?: number): string {
  const level = SHARE_LEVEL_LABEL[share.level]

  if (share.level === 'off') return level
  if (share.everyone) {
    const everyone = memberCount
      ? t('everyone in this team ({n})', { n: memberCount })
      : t('everyone in this team')

    return `${level} · ${everyone}`
  }
  if (share.userIds.length === 0) return `${level} · ${t('no one picked yet')}`
  const people =
    share.userIds.length === 1 ? t('1 person') : t('{n} people', { n: share.userIds.length })

  return `${level} · ${people}`
}
