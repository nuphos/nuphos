import { t } from '../../i18n/index.ts'
import { SHARED_COMPUTER_ACCESS } from '../../lib/sharedComputerDisclosure.ts'

import type { LocalShareInput, LocalShareLevel } from '../../api/device-types'

export const SHARE_LEVELS: readonly LocalShareLevel[] = ['off', 'approve', 'full']

export const SHARE_LEVEL_LABEL: Record<LocalShareLevel, string> = {
  off: t('Not shared'),
  approve: t('Ask me first'),
  full: t('Full access'),
}

/** What a teammate's agent can reach here, whatever the level: said wherever sharing is turned on. */
export const SHARE_RISK = SHARED_COMPUTER_ACCESS

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
