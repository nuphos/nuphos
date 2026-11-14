import type { BoxAccess } from '../../api/device-types'

export type AccessMode = 'private' | 'everyone' | 'members'

/** How a Box's access reads: everyone, named members, or (with no one named) private. */
export function accessMode(access: BoxAccess | undefined): AccessMode {
  if (access?.everyone) return 'everyone'

  return access?.userIds.length ? 'members' : 'private'
}

/** What the backend stores for a mode: the owner and managers are never listed, they always have access. */
export function accessFor(mode: AccessMode, chosen: Iterable<string>): BoxAccess {
  if (mode === 'everyone') return { everyone: true, userIds: [] }
  if (mode === 'private') return { everyone: false, userIds: [] }

  return { everyone: false, userIds: [...chosen] }
}
