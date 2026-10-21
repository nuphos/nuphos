import type { BoxAccess } from '../../api/device-types'

export type AccessMode = 'admins' | 'everyone' | 'members'

/** How a Box's access reads: everyone, named members, or (with no one named) its admins only. */
export function accessMode(access: BoxAccess | undefined, nonAdminIds?: Set<string>): AccessMode {
  if (access?.everyone) return 'everyone'
  const named = (access?.userIds ?? []).filter((id) => !nonAdminIds || nonAdminIds.has(id))

  return named.length > 0 ? 'members' : 'admins'
}

/** What the backend stores for a mode: admins are never listed, they always have access. */
export function accessFor(mode: AccessMode, chosen: Iterable<string>): BoxAccess {
  if (mode === 'everyone') return { everyone: true, userIds: [] }
  if (mode === 'admins') return { everyone: false, userIds: [] }

  return { everyone: false, userIds: [...chosen] }
}
