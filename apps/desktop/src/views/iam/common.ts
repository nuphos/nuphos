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
  if (!expiresOn) return 'Never'
  const ms = new Date(expiresOn).getTime() - Date.now()

  if (Number.isNaN(ms)) return expiresOn
  if (ms <= 0) return `Expired ${formatAge(expiresOn)} ago`
  const seconds = Math.floor(ms / 1000)

  if (seconds < 60) return `${String(seconds)}s from now`
  const minutes = Math.floor(seconds / 60)

  if (minutes < 60) return `${String(minutes)}m from now`
  const hours = Math.floor(minutes / 60)

  if (hours < 24) return `${String(hours)}h from now`
  const days = Math.floor(hours / 24)

  return `${String(days)}d from now`
}
