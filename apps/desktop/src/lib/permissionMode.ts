export type PermissionMode = 'auto' | 'bypass'

// The mode new conversations start in — follows the user's most recent pick in
// any composer. Nothing stored yet means Full Access; anything unreadable
// fails safe to Auto Mode.
export const PERMISSION_MODE_KEY = 'nuphos.agentPermissionMode'

type ModeStorage = Pick<Storage, 'getItem' | 'setItem'>

export function readDefaultPermissionMode(storage: ModeStorage): PermissionMode {
  try {
    const stored = storage.getItem(PERMISSION_MODE_KEY)

    if (stored === null) return 'bypass'

    return stored === 'bypass' ? 'bypass' : 'auto'
  } catch {
    return 'auto'
  }
}

export function writeDefaultPermissionMode(storage: ModeStorage, mode: PermissionMode): void {
  try {
    storage.setItem(PERMISSION_MODE_KEY, mode)
  } catch {
    // Best-effort; the in-memory choice still applies this session.
  }
}
