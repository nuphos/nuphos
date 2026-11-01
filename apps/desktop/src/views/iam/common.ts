import { t } from '../../i18n/index.ts'
import { allowListIsAll, normalizeAllowList } from '../../lib/bindingAccess'
import { formatAge } from '../../utils'

import type { TeamMember } from '../../types'

export type CommonProps = {
  teamId: string
  refreshKey: number
  onLoading?: (loading: boolean) => void
}

export function awsRoleName(roleArn: string): string {
  return roleArn.split('/').pop() || roleArn
}

export function accessSortValue(list: string[] | undefined, members: TeamMember[]): number {
  const normalized = normalizeAllowList(list)

  if (allowListIsAll(normalized)) return members.length || Number.MAX_SAFE_INTEGER

  return normalized.length
}

export function formatExpiry(expiresOn: string | null | undefined): string {
  if (!expiresOn) return t('Never')
  const ms = new Date(expiresOn).getTime() - Date.now()

  if (Number.isNaN(ms)) return expiresOn
  if (ms <= 0) return t('Expired {age} ago', { age: formatAge(expiresOn) })
  const seconds = Math.floor(ms / 1000)

  if (seconds < 60) return t('{count}s from now', { count: String(seconds) })
  const minutes = Math.floor(seconds / 60)

  if (minutes < 60) return t('{count}m from now', { count: String(minutes) })
  const hours = Math.floor(minutes / 60)

  if (hours < 24) return t('{count}h from now', { count: String(hours) })
  const days = Math.floor(hours / 24)

  return t('{count}d from now', { count: String(days) })
}
