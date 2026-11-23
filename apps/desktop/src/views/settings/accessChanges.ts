import { t } from '../../i18n/index.ts'

import type { AccessChange, AccessGrant } from '../../api/device-access-types.ts'

const NONE: AccessGrant = { everyone: false, userIds: [], managerIds: [] }

/** Through what the change was made, in a few words; null for the plain Share dialog. */
export function viaLabel(via: AccessChange['via']): string | null {
  switch (via) {
    case 'conversation_invite':
      return t('when inviting them to a chat')
    case 'conversation_move':
      return t('when moving a chat here')
    case 'team_leave':
      return t('they left the team')
    case 'team_removal':
      return t('removed from the team')
    case 'share':
    case 'box_access':
      return null
  }
}

/** Who the grant lets use the computer by name: managers use it too. Everyone is not a list. */
const users = (grant: AccessGrant) => new Set([...grant.userIds, ...grant.managerIds])

/**
 * What one change did, one line per kind of change, naming people with `name`. A grant that
 * stops existing reads as no one any more. Someone made a manager is not also told they can
 * now use it, and no one is said to gain or lose use while everyone in the team can use it.
 */
export function describeAccessChange(
  change: Pick<AccessChange, 'previous' | 'next' | 'owner'>,
  name: (userId: string) => string,
): string[] {
  const before = change.previous ?? NONE
  const after = change.next ?? NONE
  const lines: string[] = []
  const usedBefore = users(before)
  const usesAfter = users(after)

  if (change.owner) lines.push(t('{name} now owns it', { name: name(change.owner.to) }))
  if (!before.everyone && after.everyone) lines.push(t('Shared with everyone in the team'))
  if (before.everyone && !after.everyone) lines.push(t('Stopped sharing with everyone in the team'))
  for (const id of after.managerIds.filter((one) => !before.managerIds.includes(one)))
    lines.push(t('{name} can now manage it', { name: name(id) }))
  for (const id of before.managerIds.filter((one) => !after.managerIds.includes(one)))
    lines.push(t('{name} no longer manages it', { name: name(id) }))
  if (!before.everyone)
    for (const id of usesAfter)
      if (!usedBefore.has(id) && !after.managerIds.includes(id))
        lines.push(t('{name} can now use it', { name: name(id) }))
  if (!after.everyone)
    for (const id of usedBefore)
      if (!usesAfter.has(id)) lines.push(t('{name} can no longer use it', { name: name(id) }))
  if (lines.length === 0) lines.push(t('No change to who can use it'))

  return lines
}
