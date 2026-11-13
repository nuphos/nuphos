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
