import { parseAtlasError } from '../../api/errors.ts'
import { t } from '../../i18n/index.ts'

import type { LocalShareInput } from '../../api/device-types.ts'

/** What one teammate may do with someone's computer: managing includes using it. */
export type AccessRole = 'none' | 'use' | 'manage'

export const ACCESS_ROLE_LABEL: Record<AccessRole, string> = {
  none: t('No access'),
  use: t('Use'),
  manage: t('Manage'),
}

/** Each teammate's role as stored: managers first, then those who may use it. */
export function initialRoles(
  share: Pick<LocalShareInput, 'userIds'>,
  managerIds: readonly string[] = [],
): Map<string, AccessRole> {
  const roles = new Map<string, AccessRole>(share.userIds.map((id) => [id, 'use']))

  for (const id of managerIds) roles.set(id, 'manage')

  return roles
}

/** A teammate's role as shown: with everyone allowed, no one reads as having no access. */
export function shownRole(role: AccessRole | undefined, everyone: boolean): AccessRole {
  if (role && role !== 'none') return role

  return everyone ? 'use' : 'none'
}

/** The roles the viewer may pick: only the owner names managers. */
export function roleOptions(everyone: boolean, owner: boolean): AccessRole[] {
  return [...(everyone ? [] : ['none' as const]), 'use', ...(owner ? ['manage' as const] : [])]
}

/**
 * The request that saves these roles. Managers are in the use list too, so an older backend
 * still lets them use it; only the owner sends managers, so a manager's save keeps them.
 */
export function shareRequest(
  roles: ReadonlyMap<string, AccessRole>,
  everyone: boolean,
  owner: boolean,
): LocalShareInput {
  const userIds = [...roles].filter(([, role]) => role !== 'none').map(([id]) => id)
  const managerIds = [...roles].filter(([, role]) => role === 'manage').map(([id]) => id)

  return {
    level: everyone || userIds.length > 0 ? 'full' : 'off',
    everyone,
    userIds,
    ...(owner ? { managerIds } : {}),
  }
}

/** Someone changed who may use or manage it since the dialog loaded; saving would undo that. */
export function accessChanged(error: unknown): boolean {
  return parseAtlasError(error).code === 'access_changed'
}
