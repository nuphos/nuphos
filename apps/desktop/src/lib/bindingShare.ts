/** Who connected the binding: its recorded owner, or the one member of an older private list. */
export function bindingOwner(
  memberAllowList: string[],
  ownerUserId: string | null | undefined,
): string | undefined {
  if (ownerUserId) return ownerUserId

  return memberAllowList.length === 1 && memberAllowList[0] !== '*' ? memberAllowList[0] : undefined
}

/**
 * Mirrors the backend: its owner may always change who a binding is shared
 * with, an admin only while it is shared.
 */
export function canEditBindingAccess(
  memberAllowList: string[],
  ownerUserId: string | null | undefined,
  userId: string | undefined,
  isAdmin: boolean,
): boolean {
  const owner = bindingOwner(memberAllowList, ownerUserId)

  if (userId && owner === userId) return true
  if (!isAdmin) return false
  // A list emptied before owners were kept is nobody's to protect.
  if (!owner && memberAllowList.length === 0) return true

  return bindingShareStatus(memberAllowList, ownerUserId) !== 'private'
}
/** The team setting for bindings members connect from now on; absent is private. */
export type TeamShareDefault = { bindingShareDefault?: 'private' | 'team' }

/** Who the member connecting a binding shares it with, as the bind request sends it. */
export type BindingShare = { mode: 'private' | 'team' | 'members'; memberIds: string[] }

/** The bind request's share for the members picked in the connect dialog. */
export function shareFromAllowList(list: string[]): BindingShare {
  return list.includes('*')
    ? { mode: 'team', memberIds: [] }
    : { mode: 'members', memberIds: list.filter((id) => id !== '*') }
}

/** Who a binding is shared with, as the access editor names it. */
export type BindingShareStatus = 'private' | 'team' | 'members'

/**
 * Mirrors the backend's private test: a list of only the owner is private,
 * and without a recorded owner so is a list of at most one member.
 */
export function bindingShareStatus(
  memberAllowList: string[],
  ownerUserId: string | null | undefined,
): BindingShareStatus {
  if (memberAllowList.includes('*')) return 'team'
  const isPrivate = ownerUserId
    ? memberAllowList.every((id) => id === ownerUserId)
    : memberAllowList.length <= 1

  return isPrivate ? 'private' : 'members'
}
