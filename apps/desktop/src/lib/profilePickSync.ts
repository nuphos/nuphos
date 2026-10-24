import { BADGE_STATS } from './badgeStat.ts'
import { PROFILE_CHARACTERS } from './profileCharacter.ts'

import type { BadgeStat, ProfileCharacter, ProfileSaveResult, UserInfo } from '../types/team.ts'

/** Where a pick waits on this computer until the server takes it. */
export type PickStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

/** One thing the person picks for their own sidebar, saved on their account. */
export type PickSlot<T extends string> = { name: string; values: readonly T[] }

/** A character, or `photo` for none: the person's own photo (or initials) again. */
export type PictureChoice = ProfileCharacter | 'photo'

export const CHARACTER_SLOT: PickSlot<PictureChoice> = {
  name: 'profileCharacter',
  values: [...PROFILE_CHARACTERS, 'photo'],
}

export const BADGE_STAT_SLOT: PickSlot<BadgeStat> = { name: 'badgeStat', values: BADGE_STATS }

export function pendingKey(slot: PickSlot<string>, userId: string): string {
  return `nuphos.${slot.name}.pending.${userId}`
}

/** The pick this computer still has to save, if it is one this build knows. */
export function pendingValue<T extends string>(
  slot: PickSlot<T>,
  storage: PickStorage,
  userId: string,
): T | undefined {
  const value = storage.getItem(pendingKey(slot, userId))

  return slot.values.find((known) => known === value)
}

export function pendingPickKey(userId: string): string {
  return pendingKey(CHARACTER_SLOT, userId)
}

export function pendingPick(storage: PickStorage, userId: string): PictureChoice | undefined {
  return pendingValue(CHARACTER_SLOT, storage, userId)
}

/** The character to show: a pick still waiting on this computer, else the saved one. */
export function shownCharacter(
  user: UserInfo,
  pending: PictureChoice | undefined,
): ProfileCharacter | undefined {
  if (pending === 'photo') return undefined

  return pending ?? user.character
}

export type SaveOutcome =
  | { kind: 'saved'; user: UserInfo }
  /** The server has no route for it yet; the pick stays on this computer and syncs later. */
  | { kind: 'kept-here' }
  | { kind: 'failed'; message: string }

/**
 * Keeps the pick on this computer first, so it shows at once and survives a failed save,
 * then sends it. Only a save the server accepted clears the local copy.
 */
export async function saveValue<T extends string>(
  slot: PickSlot<T>,
  value: T,
  userId: string,
  deps: { storage: PickStorage; send: (value: T) => Promise<ProfileSaveResult> },
): Promise<SaveOutcome> {
  deps.storage.setItem(pendingKey(slot, userId), value)
  try {
    const result = await deps.send(value)

    if ('unsupported' in result) return { kind: 'kept-here' }
    // A newer pick made while this one was in flight stays pending for its own save.
    if (pendingValue(slot, deps.storage, userId) === value)
      deps.storage.removeItem(pendingKey(slot, userId))

    return { kind: 'saved', user: result.user }
  } catch (err) {
    return { kind: 'failed', message: err instanceof Error ? err.message : String(err) }
  }
}

/** Saves a character, or `photo` to clear it, which the server takes as null. */
export function savePick(
  choice: PictureChoice,
  userId: string,
  deps: {
    storage: PickStorage
    send: (character: ProfileCharacter | null) => Promise<ProfileSaveResult>
  },
): Promise<SaveOutcome> {
  return saveValue(CHARACTER_SLOT, choice, userId, {
    storage: deps.storage,
    send: (value) => deps.send(value === 'photo' ? null : value),
  })
}
