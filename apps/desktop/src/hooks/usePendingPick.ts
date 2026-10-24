import { useSyncExternalStore } from 'react'

import { CHARACTER_SLOT, pendingValue } from '../lib/profilePickSync'

import type { PickSlot, PictureChoice } from '../lib/profilePickSync'

const listeners = new Set<() => void>()

/** Tells every view showing the person's picks that this computer's pending picks changed. */
export function notifyPendingPick(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith('nuphos.')) listener()
  }

  listeners.add(listener)
  window.addEventListener('storage', onStorage)

  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

/** A pick this computer still has to save for `userId`, kept in step across views and windows. */
export function usePendingValue<T extends string>(
  slot: PickSlot<T>,
  userId: string,
): T | undefined {
  return useSyncExternalStore(subscribe, () => pendingValue(slot, localStorage, userId))
}

export function usePendingPick(userId: string): PictureChoice | undefined {
  return usePendingValue(CHARACTER_SLOT, userId)
}
