import { t } from '../../i18n'

import type { IntegrationPlatformRow } from './team-home-bind'

export function connectionOwnership(
  rows: IntegrationPlatformRow[],
  sharing: Record<string, { owned: boolean; shared: boolean }> | undefined,
): string | undefined {
  if (!sharing || rows.some((row) => !sharing[row.key])) return undefined
  const mine = rows.filter((row) => sharing[row.key].owned).length
  const shared = rows.filter((row) => sharing[row.key].shared).length
  const parts: string[] = []

  if (mine) parts.push(`${t('My connections')}: ${String(mine)}`)
  if (shared) parts.push(`${t('Shared with the team')}: ${String(shared)}`)

  return parts.join(' · ') || undefined
}
